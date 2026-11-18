import { parseIntegerEnv } from '../utils/env';
import type { NewsArticle } from '../utils/types';

const DEFAULT_READER_TEXT_MAX_CHARS = 3000;

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

function getArticleTextLimit(articleCount: number) {
  const budget = parseIntegerEnv('AI_SUMMARY_PROMPT_TEXT_BUDGET_CHARS', 30000, { min: 10000, max: 240000 });
  return Math.max(1, Math.floor(budget / Math.max(1, Number(articleCount) || 1)));
}

function buildSummaryExcerpt(article: Partial<NewsArticle>, index: number, count: number) {
  const articleTextLimit = Math.min(
    Number(article.readerTextMaxChars) || DEFAULT_READER_TEXT_MAX_CHARS,
    getArticleTextLimit(count)
  );
  const readerText = truncateText(article.readerText || '', articleTextLimit);
  const rssText = String(article.content || '').length > String(article.description || '').length ? article.content : article.description;

  return {
    ref: index + 1,
    title: truncateText(article.title || '', 220),
    description: readerText || truncateText(rssText, articleTextLimit),
    contentType: readerText ? 'cached_reader_text' : 'rss_metadata',
    source: truncateText(article.source || article.rawSource || '', 120),
    publishedAt: article.pubDate || ''
  };
}

export default {
  buildSummaryExcerpt,
  getArticleTextLimit,
  truncateText
};
