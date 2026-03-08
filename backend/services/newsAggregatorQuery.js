const database = require('./database');
const newsSources = require('../config/newsSources');
const { getConfiguredSourceGroups } = require('../utils/sourceCatalog');
const {
  insertArticleIntoGroups,
  sortGroupsByPubDate
} = require('./newsAggregatorGrouping');

const MAX_SCAN_ARTICLES = parseInt(process.env.MAX_SCAN_ARTICLES || '600', 10);
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
  return [
    ...getConfiguredSourceGroups(),
    ...userSources.map((source) => ({
      id: source.id,
      name: source.name,
      language: source.language,
      type: 'rss',
      url: source.url
    }))
  ];
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
  const targetGroups = (page * pageSize) + 1;
  const batchSize = Math.max(pageSize * 4, 40);

  let articleOffset = 0;
  let exhausted = false;
  let scannedArticles = 0;
  let groupedResults = [];

  while (!exhausted && articleOffset < MAX_SCAN_ARTICLES && groupedResults.length < targetGroups) {
    const batch = database.getArticles({
      search: filters.search,
      sourceIds: filters.sourceIds,
      topics: filters.topics,
      recentHours: filters.recentHours,
      limit: batchSize,
      offset: articleOffset
    }, queryOptions);

    if (batch.length === 0) {
      exhausted = true;
      break;
    }

    scannedArticles += batch.length;
    batch.forEach((article) => {
      insertArticleIntoGroups(groupedResults, article);
    });
    sortGroupsByPubDate(groupedResults);
    articleOffset += batch.length;

    if (batch.length < batchSize) {
      exhausted = true;
    }
  }

  const startIndex = (page - 1) * pageSize;
  const pagedItems = groupedResults.slice(startIndex, startIndex + pageSize);
  const latestIngestion = database.getLatestIngestionRun();

  return {
    items: pagedItems,
    meta: {
      page,
      pageSize,
      hasMore: groupedResults.length > (startIndex + pageSize) || !exhausted,
      totalGroups: exhausted ? groupedResults.length : null,
      scannedArticles,
      lastRefreshAt: getLastRefreshAt(),
      ingestion: latestIngestion
    },
    filters: {
      sources: database.getSourceStats(availableSources, queryOptions),
      sourceCatalog: availableSources.map((source) => ({
        id: source.id,
        name: source.name,
        language: source.language || null,
        subSources: Array.isArray(source.subSources) ? source.subSources : []
      })),
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
