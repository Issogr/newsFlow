const { createError } = require('./errorHandler');

const MAX_NEWS_PAGE = 20;
const MAX_RECENT_HOURS = 24;
const MAX_SOURCE_FILTERS = 80;
const MAX_TOPIC_FILTERS = 40;
const MAX_FILTER_VALUE_LENGTH = 120;

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

function parseBoundedCsvParam(value, { limit, name }) {
  const items = [...new Set(parseCsvParam(value))];
  if (items.length > limit) {
    throw createError(400, `${name} can include at most ${limit} values.`, 'INVALID_NEWS_QUERY');
  }

  const invalidItem = items.find((item) => item.length > MAX_FILTER_VALUE_LENGTH);
  if (invalidItem) {
    throw createError(400, `${name} values must be ${MAX_FILTER_VALUE_LENGTH} characters or fewer.`, 'INVALID_NEWS_QUERY');
  }

  return items;
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
    sourceIds: parseBoundedCsvParam(query.sources, { limit: MAX_SOURCE_FILTERS, name: 'sources' }),
    topics: parseBoundedCsvParam(query.topics, { limit: MAX_TOPIC_FILTERS, name: 'topics' }),
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
  MAX_SOURCE_FILTERS,
  MAX_TOPIC_FILTERS,
  parseNewsQuery,
};
