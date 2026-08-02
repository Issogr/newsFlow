const { parseIntegerEnv } = require('../utils/env');
import type { NewsArticle } from '../utils/types';

const DEFAULT_READER_TEXT_MAX_CHARS = 3000;
const DEFAULT_RSS_METADATA_MAX_CHARS = 520;

function truncateText(value: unknown, maxLength: number) {
  const limit = Math.max(0, Number(maxLength) || 0);
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!limit || normalized.length <= limit) {
    return normalized;
  }

  if (limit <= 3) {
    return normalized.slice(0, limit).trim();
  }

  return `${normalized.slice(0, limit - 3).trim()}...`;
}

function getArticleTextLimit(articleCount: number, options: { envName: string; defaultBudgetChars: number }) {
  const budget = parseIntegerEnv(options.envName, options.defaultBudgetChars, { min: 10000, max: 240000 });
  return Math.max(1, Math.floor(budget / Math.max(1, Number(articleCount) || 1)));
}

function buildArticlePayload(
  article: Partial<NewsArticle> & { readerText?: string; readerTextMaxChars?: number } = {},
  index = 0,
  options: { articleTextLimit?: number; rssMetadataMaxChars?: number } = {}
) {
  const articleTextLimit = Math.min(
    Number(article.readerTextMaxChars) || DEFAULT_READER_TEXT_MAX_CHARS,
    Number(options.articleTextLimit) || DEFAULT_READER_TEXT_MAX_CHARS
  );
  const readerText = truncateText(article.readerText || '', articleTextLimit);
  const fallbackText = truncateText(
    article.description || article.content || '',
    Math.min(options.rssMetadataMaxChars || DEFAULT_RSS_METADATA_MAX_CHARS, articleTextLimit)
  );

  return {
    ref: index + 1,
    title: truncateText(article.title || '', 220),
    description: readerText || fallbackText,
    contentType: readerText ? 'cached_reader_text' : 'rss_metadata',
    source: truncateText(article.source || article.rawSource || '', 120),
    publishedAt: article.pubDate || ''
  };
}

export = {
  buildArticlePayload,
  getArticleTextLimit,
  truncateText
};
