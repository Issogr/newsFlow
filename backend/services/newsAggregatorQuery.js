const database = require('./database');
const newsSources = require('../config/newsSources');
const { buildDomainSourceGroups, getConfiguredSourceGroups } = require('../utils/sourceCatalog');
const { createStandaloneGroup } = require('./newsAggregatorGrouping');
const ARTICLE_RETENTION_HOURS = parseInt(process.env.ARTICLE_RETENTION_HOURS || '24', 10);

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

function getAvailableSources(userContext = {}) {
  const userSources = userContext.userId ? database.listUserSources(userContext.userId) : [];
  const availableSources = new Map(getConfiguredSourceGroups().map((group) => [group.id, { ...group, subSources: [...group.subSources] }]));
  const customGroups = buildDomainSourceGroups(userSources);

  customGroups.forEach((group) => {
    const existingGroup = availableSources.get(group.id);

    if (!existingGroup) {
      availableSources.set(group.id, {
        id: group.id,
        name: group.name,
        language: group.language,
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

function buildNextCursor(items = []) {
  const lastItem = items[items.length - 1];
  if (!lastItem?.pubDate || !lastItem?.id) {
    return null;
  }

  return {
    beforePubDate: lastItem.pubDate,
    beforeId: lastItem.id
  };
}

function buildSourceCatalogResponse(availableSources = []) {
  return availableSources.map((source) => ({
    id: source.id,
    name: source.name,
    language: source.language || null,
    subSources: Array.isArray(source.subSources) ? source.subSources : []
  }));
}

async function getNewsFeed(filters = {}, userContext = {}, runtime = {}) {
  const {
    ensureSeedData = async () => {},
    getLastRefreshAt = () => null
  } = runtime;

  await ensureSeedData();

  const queryOptions = getQueryOptions(userContext);
  const availableSources = getAvailableSources(userContext);

  const page = Math.max(1, Number(filters.page) || 1);
  const pageSize = Math.max(1, Math.min(Number(filters.pageSize) || 12, 30));
  const articles = database.getArticles({
    search: filters.search,
    sourceIds: filters.sourceIds,
    topics: filters.topics,
    recentHours: filters.recentHours,
    beforePubDate: filters.beforePubDate,
    beforeId: filters.beforeId,
    limit: pageSize + 1,
    offset: 0
  }, queryOptions);
  const hasMore = articles.length > pageSize;
  const pageArticles = hasMore ? articles.slice(0, pageSize) : articles;
  const latestIngestion = database.getLatestIngestionRun();

  return {
    items: pageArticles.map((article) => createStandaloneGroup(article)),
    meta: {
      page,
      pageSize,
      hasMore,
      nextCursor: hasMore ? buildNextCursor(pageArticles) : null,
      totalGroups: !hasMore && !filters.beforePubDate && !filters.beforeId ? pageArticles.length : null,
      scannedArticles: articles.length,
      lastRefreshAt: getLastRefreshAt(),
      ingestion: latestIngestion
    },
    filters: {
      sources: database.getSourceStats(availableSources, queryOptions),
      sourceCatalog: buildSourceCatalogResponse(availableSources),
      topics: database.getTopicStatsByFilters({
        search: filters.search,
        sourceIds: filters.sourceIds,
        recentHours: filters.recentHours
      }, 18, queryOptions)
    }
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
