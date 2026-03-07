const axios = require('axios');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const database = require('./database');
const logger = require('../utils/logger');
const { createError } = require('../utils/errorHandler');

const READER_TIMEOUT = parseInt(process.env.READER_TIMEOUT || '12000', 10);
const READER_CACHE_TTL_MS = parseInt(process.env.READER_CACHE_TTL_MS || String(24 * 60 * 60 * 1000), 10);

function normalizeText(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitParagraphs(text) {
  return normalizeText(text)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

function calculateMinutesToRead(text) {
  const words = normalizeText(text).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 220));
}

function cleanupReadableDocument(document) {
  document.querySelectorAll('img, picture, source, figure, iframe, video, audio, script, style, noscript, svg, form').forEach((node) => {
    node.remove();
  });
}

function buildPayload(article, data, cached = false) {
  const contentText = normalizeText(data.contentText);
  const paragraphs = splitParagraphs(contentText);

  return {
    articleId: article.id,
    url: data.url || article.url || '',
    title: data.title || article.title,
    siteName: data.siteName || article.source,
    byline: data.byline || article.author || '',
    language: data.language || article.language || 'it',
    excerpt: data.excerpt || article.description || '',
    contentText,
    paragraphs,
    minutesToRead: data.minutesToRead || calculateMinutesToRead(contentText),
    fetchedAt: data.fetchedAt || new Date().toISOString(),
    cached
  };
}

function buildFallbackPayload(article) {
  const fallbackText = normalizeText([article.description, article.content].filter(Boolean).join('\n\n'));

  if (!fallbackText) {
    throw createError(404, 'No readable content available for this article.', 'READER_NOT_AVAILABLE');
  }

  return buildPayload(article, {
    url: article.url,
    title: article.title,
    siteName: article.source,
    byline: article.author,
    language: article.language,
    excerpt: article.description,
    contentText: fallbackText,
    fetchedAt: new Date().toISOString()
  });
}

async function fetchReaderPayload(article) {
  const response = await axios.get(article.url, {
    timeout: READER_TIMEOUT,
    responseType: 'text',
    headers: {
      'User-Agent': 'news-aggregator-reader/1.0 (+https://localhost)',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    transformResponse: [(data) => data]
  });

  const dom = new JSDOM(response.data, { url: article.url });
  cleanupReadableDocument(dom.window.document);

  const readability = new Readability(dom.window.document, {
    charThreshold: 200,
    keepClasses: false
  });

  const parsed = readability.parse();
  if (!parsed?.textContent) {
    throw new Error('Readable content extraction failed');
  }

  return buildPayload(article, {
    url: article.url,
    title: parsed.title,
    siteName: parsed.siteName,
    byline: parsed.byline,
    language: parsed.lang || article.language,
    excerpt: parsed.excerpt || article.description,
    contentText: parsed.textContent,
    minutesToRead: calculateMinutesToRead(parsed.textContent),
    fetchedAt: new Date().toISOString()
  });
}

async function getReaderArticle(articleId, options = {}) {
  const article = database.getArticleById(articleId);
  if (!article) {
    throw createError(404, 'Article not found.', 'RESOURCE_NOT_FOUND');
  }

  if (!options.forceRefresh) {
    const cached = database.getReaderCache(articleId, READER_CACHE_TTL_MS);
    if (cached?.contentText) {
      return buildPayload(article, cached, true);
    }
  }

  try {
    const payload = await fetchReaderPayload(article);
    database.upsertReaderCache(articleId, payload);
    return payload;
  } catch (error) {
    logger.warn(`Reader mode extraction failed for ${article.url}: ${error.message}`);

    const fallbackPayload = buildFallbackPayload(article);
    database.upsertReaderCache(articleId, fallbackPayload);
    return {
      ...fallbackPayload,
      cached: false,
      fallback: true
    };
  }
}

module.exports = {
  getReaderArticle,
  _normalizeText: normalizeText,
  _splitParagraphs: splitParagraphs,
  _calculateMinutesToRead: calculateMinutesToRead
};
