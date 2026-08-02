const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const database = require('./database');
const logger = require('../utils/logger');
const summarizeErrorMessage = require('../utils/summarizeError');
const { createError } = require('../utils/errorHandler');
const { fetchSafeTextUrl } = require('../utils/urlSafety');
const { parseIntegerEnv } = require('../utils/env');
import type { DynamicRecord, NewsArticle } from '../utils/types';

interface ReaderBlock {
  items?: string[];
  level?: number;
  text?: string;
  type: string;
}

interface ReaderQueueEntry {
  reject: (reason?: unknown) => void;
  resolve: (value: DynamicRecord) => void;
  task: () => DynamicRecord | Promise<DynamicRecord>;
  userKey: string;
}

type ReaderArticle = Partial<NewsArticle> & DynamicRecord;

const READER_TIMEOUT = parseIntegerEnv('READER_TIMEOUT', 12000, { min: 1 });
const READER_CACHE_TTL_MS = parseIntegerEnv('READER_CACHE_TTL_MS', 24 * 60 * 60 * 1000, { min: 0 });
const READER_FALLBACK_CACHE_TTL_MS = parseIntegerEnv('READER_FALLBACK_CACHE_TTL_MS', 15 * 60 * 1000, { min: 0 });
const READER_FALLBACK_CACHE_PRUNE_INTERVAL_MS = parseIntegerEnv(
  'READER_FALLBACK_CACHE_PRUNE_INTERVAL_MS',
  Math.min(Math.max(READER_FALLBACK_CACHE_TTL_MS || 60 * 1000, 1000), 60 * 1000),
  { min: 1000 }
);
const READER_MAX_RESPONSE_BYTES = parseIntegerEnv('READER_MAX_RESPONSE_BYTES', 2097152, { min: 1 });
const READER_EXTRACTION_CONCURRENCY = parseIntegerEnv('READER_EXTRACTION_CONCURRENCY', 3, { min: 1 });
const READER_EXTRACTION_MAX_PENDING = parseIntegerEnv('READER_EXTRACTION_MAX_PENDING', 60, { min: READER_EXTRACTION_CONCURRENCY });
const READER_EXTRACTION_MAX_PENDING_PER_USER = parseIntegerEnv('READER_EXTRACTION_MAX_PENDING_PER_USER', 20, { min: 1 });
const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'UL', 'OL', 'PRE']);
const CONTAINER_TAGS = new Set(['ARTICLE', 'SECTION', 'DIV', 'MAIN']);
const readerExtractionPromises = new Map<string, Promise<DynamicRecord>>();
const readerFallbackCache = new Map<string, { expiresAt: number; payload: DynamicRecord }>();
const readerExtractionQueue: ReaderQueueEntry[] = [];
const readerExtractionsByUser = new Map<string, number>();
let readerFallbackPruneHandle: NodeJS.Timeout | null = null;
let activeReaderExtractions = 0;

function getReaderExtractionUserKey(userId: unknown = '') {
  return String(userId || 'anonymous').trim() || 'anonymous';
}

function incrementReaderExtractionUserCount(userKey: string) {
  readerExtractionsByUser.set(userKey, (readerExtractionsByUser.get(userKey) || 0) + 1);
}

function decrementReaderExtractionUserCount(userKey: string) {
  const currentCount = readerExtractionsByUser.get(userKey) || 0;
  if (currentCount <= 1) {
    readerExtractionsByUser.delete(userKey);
    return;
  }

  readerExtractionsByUser.set(userKey, currentCount - 1);
}

function getPendingReaderExtractionCount() {
  return activeReaderExtractions + readerExtractionQueue.length;
}

function assertReaderExtractionCapacity(userKey: string) {
  if (getPendingReaderExtractionCount() >= READER_EXTRACTION_MAX_PENDING) {
    throw createError(429, 'Reader extraction is busy. Please try again shortly.', 'READER_EXTRACTION_BUSY');
  }

  if ((readerExtractionsByUser.get(userKey) || 0) >= READER_EXTRACTION_MAX_PENDING_PER_USER) {
    throw createError(429, 'Too many reader extraction requests. Please wait for the current requests to finish.', 'READER_EXTRACTION_BUSY');
  }
}

function drainReaderExtractionQueue() {
  while (activeReaderExtractions < READER_EXTRACTION_CONCURRENCY && readerExtractionQueue.length > 0) {
    const queued = readerExtractionQueue.shift()!;
    activeReaderExtractions += 1;
    Promise.resolve()
      .then(queued.task)
      .then(queued.resolve, queued.reject)
      .finally(() => {
        activeReaderExtractions = Math.max(0, activeReaderExtractions - 1);
        decrementReaderExtractionUserCount(queued.userKey);
        drainReaderExtractionQueue();
      });
  }
}

function runWithReaderExtractionConcurrency(task: () => DynamicRecord | Promise<DynamicRecord>, options: DynamicRecord = {}): Promise<DynamicRecord> {
  const userKey = getReaderExtractionUserKey(options.userId);

  try {
    assertReaderExtractionCapacity(userKey);
  } catch (error) {
    return Promise.reject(error);
  }

  incrementReaderExtractionUserCount(userKey);

  return new Promise<DynamicRecord>((resolve, reject) => {
    readerExtractionQueue.push({ task, resolve, reject, userKey });
    drainReaderExtractionQueue();
  });
}

function normalizeText(text: unknown) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitParagraphs(text: unknown) {
  return normalizeText(text)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

function calculateMinutesToRead(text: unknown) {
  const words = normalizeText(text).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 220));
}

function cleanupReadableDocument(document: Document) {
  document.querySelectorAll('img, picture, source, figure, iframe, video, audio, script, style, noscript, svg, form').forEach((node) => {
    node.remove();
  });
}

function extractTextFromNode(node: Node | null | undefined) {
  if (!node) {
    return '';
  }

  return normalizeText(node.textContent || '');
}

function extractListItems(listNode: Element) {
  return [...listNode.querySelectorAll(':scope > li')]
    .map((item) => extractTextFromNode(item))
    .filter(Boolean);
}

function createTextBlock(type: string, text: unknown, level?: number): ReaderBlock | null {
  const normalized = normalizeText(text);
  if (!normalized) {
    return null;
  }

  return level ? { type, text: normalized, level } : { type, text: normalized };
}

function extractBlocksFromElement(element: Element | null, blocks: ReaderBlock[] = []) {
  if (!element) {
    return blocks;
  }

  [...element.childNodes].forEach((node) => {
    if (node.nodeType === node.TEXT_NODE) {
      const paragraphBlock = createTextBlock('paragraph', node.textContent);
      if (paragraphBlock) {
        blocks.push(paragraphBlock);
      }
      return;
    }

    if (node.nodeType !== node.ELEMENT_NODE) {
      return;
    }

    const childElement = node as Element;
    const tagName = childElement.tagName.toUpperCase();

    if (tagName === 'UL' || tagName === 'OL') {
      const items = extractListItems(childElement);
      if (items.length > 0) {
        blocks.push({
          type: tagName === 'UL' ? 'unordered-list' : 'ordered-list',
          items
        });
      }
      return;
    }

    if (tagName === 'BLOCKQUOTE') {
      const quoteBlock = createTextBlock('blockquote', extractTextFromNode(childElement));
      if (quoteBlock) {
        blocks.push(quoteBlock);
      }
      return;
    }

    if (tagName === 'PRE') {
      const preformattedBlock = createTextBlock('preformatted', node.textContent || '');
      if (preformattedBlock) {
        blocks.push(preformattedBlock);
      }
      return;
    }

    if (/^H[1-6]$/.test(tagName)) {
      const headingBlock = createTextBlock('heading', extractTextFromNode(node), Number(tagName.slice(1)));
      if (headingBlock) {
        blocks.push(headingBlock);
      }
      return;
    }

    if (tagName === 'P') {
      const paragraphBlock = createTextBlock('paragraph', extractTextFromNode(childElement));
      if (paragraphBlock) {
        blocks.push(paragraphBlock);
      }
      return;
    }

    if (CONTAINER_TAGS.has(tagName)) {
      extractBlocksFromElement(childElement, blocks);
      return;
    }

    if (!BLOCK_TAGS.has(tagName)) {
      const fallbackBlock = createTextBlock('paragraph', extractTextFromNode(childElement));
      if (fallbackBlock) {
        blocks.push(fallbackBlock);
      }
    }
  });

  return blocks;
}

function dedupeAdjacentBlocks(blocks: ReaderBlock[] = []) {
  return blocks.reduce<ReaderBlock[]>((result, block) => {
    const previousBlock = result[result.length - 1];

    if (!block) {
      return result;
    }

    if (
      previousBlock
      && previousBlock.type === block.type
      && previousBlock.text
      && block.text
      && previousBlock.text === block.text
      && previousBlock.level === block.level
    ) {
      return result;
    }

    result.push(block);
    return result;
  }, []);
}

function buildBlocksFromHtml(html: string) {
  if (!html) {
    return [];
  }

  const dom = new JSDOM(`<article>${html}</article>`);
  cleanupReadableDocument(dom.window.document);
  const articleNode = dom.window.document.querySelector('article');

  if (!articleNode) {
    return [];
  }

  return dedupeAdjacentBlocks(extractBlocksFromElement(articleNode, []));
}

function buildBlocksFromPlainText(text: unknown): ReaderBlock[] {
  return splitParagraphs(text).map((paragraph) => ({
    type: 'paragraph',
    text: paragraph
  }));
}

function blocksToText(blocks: ReaderBlock[] = []) {
  return normalizeText(blocks.map((block) => {
    if (Array.isArray(block.items)) {
      return block.items.map((item, index) => {
        const prefix = block.type === 'ordered-list' ? `${index + 1}. ` : '- ';
        return `${prefix}${item}`;
      }).join('\n');
    }

    return block.text || '';
  }).filter(Boolean).join('\n\n'));
}

function buildPayload(article: ReaderArticle, data: DynamicRecord, cached = false): DynamicRecord {
  const contentBlocks = Array.isArray(data.contentBlocks) && data.contentBlocks.length > 0
    ? data.contentBlocks
    : buildBlocksFromPlainText(data.contentText);
  const contentText = normalizeText(data.contentText || blocksToText(contentBlocks));
  const paragraphs = contentBlocks
    .filter((block) => block.type === 'paragraph' || block.type === 'blockquote')
    .map((block) => block.text)
    .filter(Boolean);

  return {
    articleId: article.id,
    url: data.url || article.url || '',
    title: data.title || article.title,
    siteName: data.siteName || article.source,
    byline: data.byline || article.author || '',
    language: data.language || article.language || 'it',
    excerpt: data.excerpt || article.description || '',
    contentText,
    contentBlocks,
    paragraphs,
    minutesToRead: data.minutesToRead || calculateMinutesToRead(contentText),
    fetchedAt: data.fetchedAt || new Date().toISOString(),
    cached
  }; 
}

function buildFallbackPayload(article: ReaderArticle) {
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
    contentBlocks: buildBlocksFromPlainText(fallbackText),
    fetchedAt: new Date().toISOString()
  });
}

async function fetchReaderPayload(article: ReaderArticle) {
  const response = await fetchSafeTextUrl(article.url, {
    timeout: READER_TIMEOUT,
    maxResponseBytes: READER_MAX_RESPONSE_BYTES,
    headers: {
      'User-Agent': 'newsflow-reader/1.0 (+https://localhost)',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
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

  const contentBlocks = buildBlocksFromHtml(parsed.content);
  const contentText = blocksToText(contentBlocks.length > 0 ? contentBlocks : buildBlocksFromPlainText(parsed.textContent));

  return buildPayload(article, {
    url: article.url,
    title: parsed.title,
    siteName: parsed.siteName,
    byline: parsed.byline,
    language: parsed.lang || article.language,
    excerpt: parsed.excerpt || article.description,
    contentText,
    contentBlocks,
    minutesToRead: calculateMinutesToRead(contentText),
    fetchedAt: new Date().toISOString()
  });
}

function getCachedFallbackPayload(articleId: string) {
  const cached = readerFallbackCache.get(articleId);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    readerFallbackCache.delete(articleId);
    return null;
  }

  return { ...cached.payload };
}

function pruneExpiredFallbackCache(now = Date.now()) {
  let removedCount = 0;

  readerFallbackCache.forEach((cached, articleId) => {
    if (!cached || cached.expiresAt <= now) {
      readerFallbackCache.delete(articleId);
      removedCount += 1;
    }
  });

  return removedCount;
}

function stopFallbackCachePruneInterval() {
  if (readerFallbackPruneHandle) {
    clearInterval(readerFallbackPruneHandle);
    readerFallbackPruneHandle = null;
  }
}

function ensureFallbackCachePruneInterval() {
  if (readerFallbackPruneHandle || READER_FALLBACK_CACHE_TTL_MS <= 0) {
    return;
  }

  readerFallbackPruneHandle = setInterval(() => {
    pruneExpiredFallbackCache();
    if (readerFallbackCache.size === 0) {
      stopFallbackCachePruneInterval();
    }
  }, READER_FALLBACK_CACHE_PRUNE_INTERVAL_MS);
  readerFallbackPruneHandle.unref?.();
}

function setCachedFallbackPayload(articleId: string, payload: DynamicRecord) {
  if (READER_FALLBACK_CACHE_TTL_MS <= 0) {
    return;
  }

  pruneExpiredFallbackCache();
  readerFallbackCache.set(articleId, {
    expiresAt: Date.now() + READER_FALLBACK_CACHE_TTL_MS,
    payload: { ...payload }
  });
  ensureFallbackCachePruneInterval();
}

async function loadFreshReaderPayload(articleId: string, article: ReaderArticle) {
  try {
    const payload = await fetchReaderPayload(article);
    database.upsertReaderCache(articleId, payload);
    readerFallbackCache.delete(articleId);
    return payload;
  } catch (error) {
    logger.debug(`Reader mode extraction fell back for ${article.url}: ${summarizeErrorMessage(error)}`);

    const fallbackPayload = {
      ...buildFallbackPayload(article),
      cached: false,
      fallback: true
    };
    setCachedFallbackPayload(articleId, fallbackPayload);
    return fallbackPayload;
  }
}

function getOrCreateReaderExtractionPromise(articleId: string, article: ReaderArticle, options: DynamicRecord = {}) {
  if (readerExtractionPromises.has(articleId)) {
    return readerExtractionPromises.get(articleId);
  }

  const extractionPromise = runWithReaderExtractionConcurrency(() => loadFreshReaderPayload(articleId, article), {
    userId: options.userId
  })
    .finally(() => {
      if (readerExtractionPromises.get(articleId) === extractionPromise) {
        readerExtractionPromises.delete(articleId);
      }
    });
  readerExtractionPromises.set(articleId, extractionPromise);
  return extractionPromise;
}

function clearRuntimeState() {
  readerExtractionPromises.clear();
  readerExtractionQueue.splice(0).forEach((queued) => {
    decrementReaderExtractionUserCount(queued.userKey);
    queued.reject(new Error('Reader extraction queue cleared'));
  });
  activeReaderExtractions = 0;
  readerExtractionsByUser.clear();
  readerFallbackCache.clear();
  stopFallbackCachePruneInterval();
}

async function getReaderArticle(articleId: string, options: DynamicRecord = {}) {
  const queryOptions = {
    userId: options.userId || null,
    maxArticleAgeHours: options.maxArticleAgeHours || null
  };
  const article = database.getArticleById(articleId, queryOptions);
  if (!article) {
    throw createError(404, 'Article not found.', 'RESOURCE_NOT_FOUND');
  }

  if (!options.forceRefresh) {
    const cached = database.getReaderCache(articleId, READER_CACHE_TTL_MS);
    if (cached?.contentText) {
      return buildPayload(article, cached, true);
    }

    const cachedFallback = getCachedFallbackPayload(articleId);
    if (cachedFallback) {
      return cachedFallback;
    }
  }

  return getOrCreateReaderExtractionPromise(articleId, article, {
    userId: options.userId
  });
}

module.exports = {
  getReaderArticle,
  _clearRuntimeState: clearRuntimeState,
  _getFallbackCacheSize: () => readerFallbackCache.size,
  _pruneExpiredFallbackCache: pruneExpiredFallbackCache,
  _getReaderExtractionStats: () => ({
    active: activeReaderExtractions,
    queued: readerExtractionQueue.length,
    pending: getPendingReaderExtractionCount(),
    users: new Map(readerExtractionsByUser)
  })
};
