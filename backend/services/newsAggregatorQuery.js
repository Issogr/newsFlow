const database = require('./database');
const newsSources = require('../config/newsSources');
const { buildDomainSourceGroups, getConfiguredSourceGroups } = require('../utils/sourceCatalog');
const { MAX_NEWS_PAGE } = require('../utils/newsQuery');
const { TITLE_GROUP_WINDOW_MS, groupSimilarNews } = require('./newsAggregatorGrouping');
const { parseIntegerEnv } = require('../utils/env');

const ARTICLE_RETENTION_HOURS = parseIntegerEnv('ARTICLE_RETENTION_HOURS', 24);
const GROUP_PAGINATION_ARTICLE_BATCH_SIZE = 250;
const READ_LATER_PAGINATION_ARTICLE_BATCH_SIZE = 250;

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

function collectGroupArticleIds(groups = []) {
  return groups.flatMap((group) => (group.items || []).map((item) => item.id).filter(Boolean));
}

function buildNextCursor(groups = [], existingExcludeArticleIds = []) {
  const lastItem = groups[groups.length - 1];
  if (!lastItem?.pubDate || !lastItem?.cursorId) {
    return null;
  }

  const excludeArticleIds = [...new Set([
    ...(Array.isArray(existingExcludeArticleIds) ? existingExcludeArticleIds : []),
    ...collectGroupArticleIds(groups)
  ])].slice(-300);

  return {
    beforePubDate: lastItem.pubDate,
    beforeId: lastItem.cursorId,
    excludeArticleIds
  };
}

function compareFeedPosition(left = {}, right = {}) {
  const pubDateComparison = String(right.pubDate || '').localeCompare(String(left.pubDate || ''));
  return pubDateComparison || String(right.id || '').localeCompare(String(left.id || ''));
}

function annotateReadLaterGroups(groups = [], userId = null) {
  if (!userId || groups.length === 0) {
    return groups.map((group) => ({
      ...group,
      readLater: false,
      readLaterArticleIds: []
    }));
  }

  const articleIds = groups.flatMap((group) => (group.items || []).map((item) => item.id).filter(Boolean));
  const readLaterArticleIds = database.getReadLaterArticleIdSet(userId, articleIds);

  return groups.map((group) => {
    const groupReadLaterArticleIds = (group.items || [])
      .map((item) => item.id)
      .filter((articleId) => readLaterArticleIds.has(articleId));

    return {
      ...group,
      readLater: groupReadLaterArticleIds.length > 0,
      readLaterArticleIds: groupReadLaterArticleIds
    };
  });
}

function compareReadLaterPosition(left = {}, right = {}) {
  const savedComparison = String(right.readLaterSavedAt || '').localeCompare(String(left.readLaterSavedAt || ''));
  return savedComparison || compareFeedPosition(left, right);
}

function buildReadLaterGroup(group = {}) {
  const savedAt = (group.items || []).reduce((latest, item) => {
    const itemSavedAt = String(item?.readLaterSavedAt || '');
    return itemSavedAt > latest ? itemSavedAt : latest;
  }, '');

  return {
    ...group,
    readLater: true,
    readLaterArticleIds: (group.items || []).map((item) => item.id).filter(Boolean),
    readLaterSavedAt: savedAt
  };
}

function fetchGroupedReadLaterPage(filters = {}, queryOptions = {}, page = 1, pageSize = 12) {
  const articles = [];
  let offset = 0;
  let hasMoreArticles = true;
  let groups = [];
  const pageStart = (page - 1) * pageSize;
  const requiredGroups = pageStart + pageSize + 1;

  while (hasMoreArticles) {
    const batch = database.getReadLaterArticles(queryOptions.userId, {
      search: filters.search,
      sourceIds: filters.sourceIds,
      topics: filters.topics,
      limit: READ_LATER_PAGINATION_ARTICLE_BATCH_SIZE + 1,
      offset
    }, queryOptions);

    const pageArticles = batch.length > READ_LATER_PAGINATION_ARTICLE_BATCH_SIZE
      ? batch.slice(0, READ_LATER_PAGINATION_ARTICLE_BATCH_SIZE)
      : batch;

    articles.push(...pageArticles);
    hasMoreArticles = batch.length > READ_LATER_PAGINATION_ARTICLE_BATCH_SIZE;
    groups = groupSimilarNews(articles)
      .map(buildReadLaterGroup)
      .sort(compareReadLaterPosition);

    if (!hasMoreArticles || groups.length >= requiredGroups) {
      break;
    }

    offset += pageArticles.length;
    if (pageArticles.length === 0) {
      break;
    }
  }

  const pageGroups = groups.slice(pageStart, pageStart + pageSize);

  return {
    articles,
    hasMore: groups.length > pageStart + pageSize || hasMoreArticles,
    pageGroups,
    totalGroups: hasMoreArticles ? null : groups.length
  };
}

function getArticleCursor(articles = []) {
  const lastArticle = articles[articles.length - 1];
  if (!lastArticle?.pubDate || !lastArticle?.id) {
    return null;
  }

  return {
    beforePubDate: lastArticle.pubDate,
    beforeId: lastArticle.id
  };
}

function getOldestReturnedGroupTimestamp(groups = [], pageStart = 0, pageSize = 12) {
  const returnedGroups = groups.slice(pageStart, pageStart + pageSize);
  if (returnedGroups.length === 0) {
    return null;
  }

  return returnedGroups.reduce((oldestTimestamp, group) => {
    const groupTimestamp = Date.parse(group.pubDate || '');
    if (!Number.isFinite(groupTimestamp)) {
      return oldestTimestamp;
    }

    return oldestTimestamp === null ? groupTimestamp : Math.min(oldestTimestamp, groupTimestamp);
  }, null);
}

function hasScannedGroupingWindow(articles = [], groups = [], pageStart = 0, pageSize = 12) {
  const oldestReturnedTimestamp = getOldestReturnedGroupTimestamp(groups, pageStart, pageSize);
  const lastFetchedArticle = articles[articles.length - 1];
  const lastFetchedTimestamp = Date.parse(lastFetchedArticle?.pubDate || '');

  if (!Number.isFinite(oldestReturnedTimestamp) || !Number.isFinite(lastFetchedTimestamp)) {
    return false;
  }

  return lastFetchedTimestamp < oldestReturnedTimestamp - TITLE_GROUP_WINDOW_MS;
}

function fetchGroupedNewsPage(filters = {}, queryOptions = {}, page = 1, pageSize = 12) {
  const articles = [];
  let cursor = {
    beforePubDate: filters.beforePubDate || '',
    beforeId: filters.beforeId || ''
  };
  let hasMoreArticles = true;
  let groups = [];
  const cursorMode = Boolean(filters.beforePubDate || filters.beforeId);
  const pageStart = cursorMode ? 0 : (page - 1) * pageSize;
  const requiredGroups = pageStart + pageSize + 1;

  while (hasMoreArticles) {
    const batch = database.getArticles({
      search: filters.search,
      sourceIds: filters.sourceIds,
      topics: filters.topics,
      recentHours: filters.recentHours,
      beforePubDate: cursor.beforePubDate,
      beforeId: cursor.beforeId,
      excludeArticleIds: filters.excludeArticleIds,
      limit: GROUP_PAGINATION_ARTICLE_BATCH_SIZE + 1,
      offset: 0
    }, queryOptions);
    const pageArticles = batch.length > GROUP_PAGINATION_ARTICLE_BATCH_SIZE
      ? batch.slice(0, GROUP_PAGINATION_ARTICLE_BATCH_SIZE)
      : batch;

    articles.push(...pageArticles);
    hasMoreArticles = batch.length > GROUP_PAGINATION_ARTICLE_BATCH_SIZE;
    groups = groupSimilarNews(articles).sort(compareFeedPosition);

    if (!hasMoreArticles) {
      break;
    }

    const hasEnoughGroups = groups.length >= requiredGroups;
    if (hasEnoughGroups && hasScannedGroupingWindow(articles, groups, pageStart, pageSize)) {
      break;
    }

    const nextCursor = getArticleCursor(pageArticles);
    if (!nextCursor) {
      break;
    }

    cursor = nextCursor;
  }

  const safePageStart = pageStart < 0 ? groups.length : pageStart;
  const pageGroups = groups.slice(safePageStart, safePageStart + pageSize);
  const hasMore = groups.length > safePageStart + pageSize || hasMoreArticles;

  return {
    articles,
    hasMore,
    pageGroups
  };
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
    getManualRefreshMeta = () => ({}),
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

  const page = Math.max(1, Math.min(Number(filters.page) || 1, MAX_NEWS_PAGE));
  const pageSize = Math.max(1, Math.min(Number(filters.pageSize) || 12, 30));
  const groupedPage = fetchGroupedNewsPage(filters, queryOptions, page, pageSize);
  const pageGroups = annotateReadLaterGroups(groupedPage.pageGroups, userContext.userId || null);
  const cursorMode = Boolean(filters.beforePubDate || filters.beforeId);
  const hasMore = !cursorMode && page >= MAX_NEWS_PAGE ? false : groupedPage.hasMore;
  const latestIngestion = database.getLatestIngestionRun();
  const includeFilters = filters.includeFilters !== false;
  const manualRefreshMeta = getManualRefreshMeta() || {};

  return {
    items: pageGroups,
    meta: {
      page,
      pageSize,
      hasMore,
      nextCursor: hasMore ? buildNextCursor(pageGroups, filters.excludeArticleIds) : null,
      returnedGroups: pageGroups.length,
      totalGroups: null,
      scannedArticles: groupedPage.articles.length,
      lastRefreshAt: getLastRefreshAt(),
      ingestion: latestIngestion,
      pendingUserRefresh: isUserRefreshPending(),
      ...manualRefreshMeta
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

async function getReadLaterFeed(filters = {}, userContext = {}) {
  const userId = userContext.userId || null;
  const userSources = userId ? database.listUserSources(userId) : [];
  const customSourceGroups = buildDomainSourceGroups(userSources);
  const queryOptions = {
    userId,
    customSourceGroups,
    sourceMetadataCache: new Map()
  };
  const availableSources = getAvailableSources(userContext, userSources);

  const page = Math.max(1, Math.min(Number(filters.page) || 1, MAX_NEWS_PAGE));
  const pageSize = Math.max(1, Math.min(Number(filters.pageSize) || 12, 30));
  const includeFilters = filters.includeFilters !== false;
  const groupedPage = fetchGroupedReadLaterPage(filters, queryOptions, page, pageSize);
  const hasMore = page >= MAX_NEWS_PAGE ? false : groupedPage.hasMore;

  return {
    items: groupedPage.pageGroups,
    meta: {
      page,
      pageSize,
      hasMore,
      nextCursor: null,
      returnedGroups: groupedPage.pageGroups.length,
      totalGroups: groupedPage.totalGroups,
      scannedArticles: groupedPage.articles.length,
      readLater: true
    },
    filters: includeFilters ? {
      sources: database.getSourceStats(availableSources, queryOptions),
      sourceCatalog: buildSourceCatalogResponse(availableSources),
      topics: database.getTopicStatsByFilters({
        search: filters.search,
        sourceIds: filters.sourceIds
      }, 18, queryOptions)
    } : null
  };
}

module.exports = {
  newsSources,
  expandConfiguredSources,
  expandUserSources,
  getNewsFeed,
  getReadLaterFeed,
  getQueryOptions,
  getAvailableSources
};
