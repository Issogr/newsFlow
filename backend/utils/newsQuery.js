const MAX_NEWS_PAGE = 20;
const MAX_RECENT_HOURS = 24;

function parseCsvParam(value) {
  if (!value) {
    return [];
  }

  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseLimitedCsvParam(value, limit) {
  return parseCsvParam(value).slice(0, limit);
}

function parseBoundedPositiveInteger(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.min(Math.floor(parsed), max));
}

function parseOptionalBoundedPositiveInteger(value, max) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.min(Math.floor(parsed), max);
}

function parseNewsQuery(query = {}) {
  return {
    search: query.search || '',
    sourceIds: parseCsvParam(query.sources),
    topics: parseCsvParam(query.topics),
    recentHours: parseOptionalBoundedPositiveInteger(query.recentHours, MAX_RECENT_HOURS),
    beforePubDate: query.beforePubDate || '',
    beforeId: query.beforeId || '',
    excludeArticleIds: parseLimitedCsvParam(query.excludeArticleIds, 300),
    page: parseBoundedPositiveInteger(query.page, 1, MAX_NEWS_PAGE),
    pageSize: parseBoundedPositiveInteger(query.pageSize, 12, 30),
    refresh: query.refresh === 'true',
    includeFilters: query.includeFilters === 'true',
  };
}

module.exports = {
  MAX_NEWS_PAGE,
  MAX_RECENT_HOURS,
  parseNewsQuery,
};
