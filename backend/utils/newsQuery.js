const MAX_NEWS_PAGE = 1000;

function parseCsvParam(value) {
  if (!value) {
    return [];
  }

  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBoundedPositiveInteger(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(1, Math.min(Math.floor(parsed), max));
}

function parseNewsQuery(query = {}) {
  return {
    search: query.search || '',
    sourceIds: parseCsvParam(query.sources),
    topics: parseCsvParam(query.topics),
    recentHours: query.recentHours ? Number(query.recentHours) : null,
    beforePubDate: query.beforePubDate || '',
    beforeId: query.beforeId || '',
    page: parseBoundedPositiveInteger(query.page, 1, MAX_NEWS_PAGE),
    pageSize: parseBoundedPositiveInteger(query.pageSize, 12, 30),
    refresh: query.refresh === 'true',
    includeFilters: query.includeFilters === 'true',
  };
}

module.exports = {
  MAX_NEWS_PAGE,
  parseCsvParam,
  parseBoundedPositiveInteger,
  parseNewsQuery,
};
