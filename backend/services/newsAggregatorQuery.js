const database = require('./database');
const newsSources = require('../config/newsSources');
const { buildDomainSourceGroups, getConfiguredSourceGroups } = require('../utils/sourceCatalog');
const { groupSimilarNews } = require('./newsAggregatorGrouping');
const { parseIntegerEnv } = require('../utils/env');

const ARTICLE_RETENTION_HOURS = parseIntegerEnv('ARTICLE_RETENTION_HOURS', 24);
const GROUP_PAGINATION_ARTICLE_BATCH_SIZE = 250;

function expandConfiguredSources() {
  return newsSources;
}

function expandUserSources(userSources = []) {
  return userSources
    .filter((source) => source?.isActive !== false)
    .map((source) => ({
      id: source.id,
      name: source.name,
      url: source.url,
      type: 'rss',
      language: source.language || 'it',
      ownerUserId: source.userId
    }));
}

function getAvailableSources(userContext = {}, userSources = null) {
  const resolvedUserSources = Array.isArray(userSources)
    ? userSources
    : (userContext.userId ? database.listUserSources(userContext.userId) : []);
  const availableSources = new Map(getConfiguredSourceGroups().map((group) => [group.id, { ...group, subSources: [...group.subSources] }]));
  const customGroups = buildDomainSourceGroups(resolvedUserSources);

  customGroups.forEach((group) => {
    const existingGroup = availableSources.get(group.id);

    if (!existingGroup) {
      availableSources.set(group.id, {
        id: group.id,
        name: group.name,
        language: group.language,
        iconUrl: group.iconUrl || '',
        subSources: group.subSources.map((subSource) => ({ ...subSource }))
      });
      return;
    }

    const mergedSubSources = new Map(existingGroup.subSources.map((subSource) => [subSource.id, subSource]));
    group.subSources.forEach((subSource) => {
      if (!mergedSubSources.has(subSource.id)) {
        mergedSubSources.set(subSource.id, { ...subSource });
      }
    });

    availableSources.set(group.id, {
      ...existingGroup,
      subSources: [...mergedSubSources.values()]
    });
  });

  return [...availableSources.values()];
}

function getQueryOptions(userContext = {}) {
  return {
    userId: userContext.userId || null,
    maxArticleAgeHours: Math.min(
      ARTICLE_RETENTION_HOURS,
      Number.isFinite(userContext.articleRetentionHours) ? userContext.articleRetentionHours : ARTICLE_RETENTION_HOURS
    ),
    excludedSourceIds: Array.isArray(userContext.excludedSourceIds) ? userContext.excludedSourceIds : [],
    excludedSubSourceIds: Array.isArray(userContext.excludedSubSourceIds) ? userContext.excludedSubSourceIds : []
  };
}

function buildNextCursor(groups = []) {
  const lastItem = groups[groups.length - 1];
  if (!lastItem?.pubDate || !lastItem?.id) {
    return null;
  }

  return {
    beforePubDate: lastItem.pubDate,
    beforeId: lastItem.id
  };
}

function compareFeedPosition(left = {}, right = {}) {
  const pubDateComparison = String(right.pubDate || '').localeCompare(String(left.pubDate || ''));
  return pubDateComparison || String(right.id || '').localeCompare(String(left.id || ''));
}

function isBeforeCursor(group = {}, cursor = {}) {
  if (!cursor.beforePubDate) {
    return true;
  }

  const groupPubDate = String(group.pubDate || '');
  const cursorPubDate = String(cursor.beforePubDate || '');
  if (groupPubDate < cursorPubDate) {
    return true;
  }

  if (groupPubDate > cursorPubDate) {
    return false;
  }

  return !cursor.beforeId || String(group.id || '') < String(cursor.beforeId || '');
}

function getGroupPageStart(groups = [], filters = {}, page = 1, pageSize = 12) {
  if (filters.beforePubDate || filters.beforeId) {
    return groups.findIndex((group) => isBeforeCursor(group, filters));
  }

  return (page - 1) * pageSize;
}

function fetchAllMatchingArticles(filters = {}, queryOptions = {}) {
  const articles = [];
  let cursor = {
    beforePubDate: '',
    beforeId: ''
  };
  let hasMoreArticles = true;

  while (hasMoreArticles) {
    const batch = database.getArticles({
      search: filters.search,
      sourceIds: filters.sourceIds,
      topics: filters.topics,
      recentHours: filters.recentHours,
      beforePubDate: cursor.beforePubDate,
      beforeId: cursor.beforeId,
      limit: GROUP_PAGINATION_ARTICLE_BATCH_SIZE + 1,
      offset: 0
    }, queryOptions);
    const pageArticles = batch.length > GROUP_PAGINATION_ARTICLE_BATCH_SIZE
      ? batch.slice(0, GROUP_PAGINATION_ARTICLE_BATCH_SIZE)
      : batch;

    articles.push(...pageArticles);
    hasMoreArticles = batch.length > GROUP_PAGINATION_ARTICLE_BATCH_SIZE;

    const nextCursor = buildNextCursor(pageArticles);
    if (!hasMoreArticles || !nextCursor) {
      break;
    }

    cursor = nextCursor;
  }

  return articles;
}

function buildSourceCatalogResponse(availableSources = []) {
  return availableSources.map((source) => ({
    id: source.id,
    name: source.name,
    language: source.language || null,
    iconUrl: source.iconUrl || '',
    subSources: Array.isArray(source.subSources) ? source.subSources : []
  }));
}

async function getNewsFeed(filters = {}, userContext = {}, runtime = {}) {
  const {
    ensureSeedData = async () => {},
    getLastRefreshAt = () => null,
    isUserRefreshPending = () => false
  } = runtime;

  await ensureSeedData();

  const userSources = userContext.userId ? database.listUserSources(userContext.userId) : [];
  const customSourceGroups = buildDomainSourceGroups(userSources);
  const queryOptions = {
    ...getQueryOptions(userContext),
    customSourceGroups,
    sourceMetadataCache: new Map()
  };
  const availableSources = getAvailableSources(userContext, userSources);

  const page = Math.max(1, Number(filters.page) || 1);
  const pageSize = Math.max(1, Math.min(Number(filters.pageSize) || 12, 30));
  const articles = fetchAllMatchingArticles(filters, queryOptions);
  const allGroups = groupSimilarNews(articles).sort(compareFeedPosition);
  const pageStart = getGroupPageStart(allGroups, filters, page, pageSize);
  const safePageStart = pageStart < 0 ? allGroups.length : pageStart;
  const pageGroups = allGroups.slice(safePageStart, safePageStart + pageSize);
  const hasMore = allGroups.length > safePageStart + pageSize;
  const latestIngestion = database.getLatestIngestionRun();
  const includeFilters = filters.includeFilters !== false;

  return {
    items: pageGroups,
    meta: {
      page,
      pageSize,
      hasMore,
      nextCursor: hasMore ? buildNextCursor(pageGroups) : null,
      returnedGroups: pageGroups.length,
      totalGroups: null,
      scannedArticles: articles.length,
      lastRefreshAt: getLastRefreshAt(),
      ingestion: latestIngestion,
      pendingUserRefresh: isUserRefreshPending()
    },
    filters: includeFilters ? {
      sources: database.getSourceStats(availableSources, queryOptions),
      sourceCatalog: buildSourceCatalogResponse(availableSources),
      topics: database.getTopicStatsByFilters({
        search: filters.search,
        sourceIds: filters.sourceIds,
        recentHours: filters.recentHours
      }, 18, queryOptions)
    } : null
  };
}

module.exports = {
  newsSources,
  expandConfiguredSources,
  expandUserSources,
  getNewsFeed,
  getQueryOptions,
  getAvailableSources
};
