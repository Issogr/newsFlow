const { parseIntegerEnv } = require('../utils/env');

const DEFAULT_ARTICLE_RETENTION_HOURS = 24;

function getArticleRetentionHours({ allowNegative = false }: { allowNegative?: boolean } = {}) {
  return parseIntegerEnv(
    'ARTICLE_RETENTION_HOURS',
    DEFAULT_ARTICLE_RETENTION_HOURS,
    allowNegative ? {} : { min: 0 }
  );
}

export = {
  getArticleRetentionHours
};
