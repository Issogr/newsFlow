const crypto = require('crypto');
const { setTimeout: wait } = require('node:timers/promises');
const { JSDOM } = require('jsdom');
const RSSParser = require('rss-parser');
const logger = require('../utils/logger');
const summarizeErrorMessage = require('../utils/summarizeError');
const { sanitizeHtml } = require('../utils/inputValidator');
const { normalizeArticleUrl, normalizeIdentityText } = require('../utils/articleIdentity');
const { normalizePublicationDate } = require('../utils/publicationDate');
const { fetchSafeTextUrl } = require('../utils/urlSafety');
const { parseIntegerEnv } = require('../utils/env');
const { redactUrlForLog } = require('../utils/logRedaction');
const { createConcurrencyLimiter } = require('../utils/concurrency');
import type { AppError, DynamicRecord, SourceDefinition } from '../utils/types';

interface RssSource extends SourceDefinition {
  ownerUserId?: string | null;
}

interface RssOptions {
  imageFallback?: boolean;
  maxRetries?: number;
  signal?: AbortSignal;
  throwOnError?: boolean;
  timeout?: number;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

interface DiscoveredFeed {
  title: string;
  url: string;
}

const MAX_ARTICLES_PER_SOURCE = parseIntegerEnv('MAX_ARTICLES_PER_SOURCE', 25, { min: 1 });
const RSS_MAX_RETRIES = parseIntegerEnv('RSS_MAX_RETRIES', 4, { min: 1 });
const RSS_RETRY_DELAY = parseIntegerEnv('RSS_RETRY_DELAY', 1500, { min: 0 });
const RSS_TIMEOUT = parseIntegerEnv('RSS_TIMEOUT', 15000, { min: 1 });
const RSS_VALIDATION_MAX_RETRIES = parseIntegerEnv('RSS_VALIDATION_MAX_RETRIES', 2, { min: 1 });
const RSS_VALIDATION_TIMEOUT = parseIntegerEnv('RSS_VALIDATION_TIMEOUT', 8000, { min: 1 });
const CACHE_TTL = parseIntegerEnv('RSS_CACHE_TTL', 60000, { min: 0 });
const MAX_CACHE_ENTRIES = parseIntegerEnv('RSS_CACHE_MAX_ENTRIES', 200, { min: 0 });
const ARTICLE_IMAGE_TIMEOUT = parseIntegerEnv('ARTICLE_IMAGE_TIMEOUT', 8000, { min: 1 });
const ARTICLE_IMAGE_CACHE_TTL = parseIntegerEnv('ARTICLE_IMAGE_CACHE_TTL', 6 * 60 * 60 * 1000, { min: 0 });
const ARTICLE_IMAGE_CACHE_MAX_ENTRIES = parseIntegerEnv('ARTICLE_IMAGE_CACHE_MAX_ENTRIES', 500, { min: 0 });
const ARTICLE_IMAGE_FALLBACK_LIMIT = parseIntegerEnv('ARTICLE_IMAGE_FALLBACK_LIMIT', 4, { min: 0 });
const RSS_MAX_RESPONSE_BYTES = parseIntegerEnv('RSS_MAX_RESPONSE_BYTES', 1048576, { min: 1 });
const RSS_DISCOVERY_MAX_RESPONSE_BYTES = parseIntegerEnv('RSS_DISCOVERY_MAX_RESPONSE_BYTES', 6291456, { min: 1 });
const ARTICLE_IMAGE_MAX_RESPONSE_BYTES = parseIntegerEnv('ARTICLE_IMAGE_MAX_RESPONSE_BYTES', 524288, { min: 1 });
const limitOutboundFetch = createConcurrencyLimiter(parseIntegerEnv('RSS_INGESTION_CONCURRENCY', 8, { min: 1 }));
const limitDiscoveryFetch = createConcurrencyLimiter(2);
const DISCOVERABLE_FEED_TYPES = new Set(['application/rss+xml', 'application/atom+xml', 'application/rdf+xml']);
const MAX_DISCOVERED_FEEDS = 10;
const MAX_DISCOVERED_FEED_URL_LENGTH = 2048;
const FEED_DIRECTORY_HINT = /(?:^|[^a-z])(?:rss|atom|feeds?)(?:[^a-z]|$)/i;
const DIRECT_FEED_URL_HINT = /\.(?:atom|rss|xml)$/i;
const LE_MONDE_FALLBACK_FEEDS = [
  ['Le Monde - En continu', '/rss/en_continu.xml'],
  ['Le Monde - International', '/international/rss_full.xml'],
  ['Le Monde - Planete', '/planete/rss_full.xml'],
  ['Le Monde - Politique', '/politique/rss_full.xml'],
  ['Le Monde - Societe', '/societe/rss_full.xml'],
  ['Le Monde - Economie', '/economie/rss_full.xml'],
  ['Le Monde - Idees', '/idees/rss_full.xml'],
  ['Le Monde - Culture', '/culture/rss_full.xml'],
  ['Le Monde - Sport', '/sport/rss_full.xml']
] as const;

const RSS_REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 NewsFlow/2.0',
  Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, text/html;q=0.7, */*;q=0.5',
  'Sec-Fetch-Mode': 'cors',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache'
};

const parser = new RSSParser({
  customFields: {
    item: [
      ['media:content', 'media'],
      ['media:thumbnail', 'thumbnail'],
      ['dc:creator', 'creator'],
      ['dc:date', 'dcdate'],
      ['content:encoded', 'contentEncoded']
    ]
  },
  timeout: RSS_TIMEOUT,
  headers: RSS_REQUEST_HEADERS
});

const responseCache = new Map<string, CacheEntry<string>>();
const articleImageCache = new Map<string, CacheEntry<string | null>>();
let cleanupHandle: NodeJS.Timeout | null = null;

function pruneCacheEntries<T>(cache: Map<string, CacheEntry<T>>, ttl: number, maxEntries: number, now = Date.now()) {
  for (const [url, entry] of cache.entries()) {
    if ((now - entry.timestamp) > ttl) {
      cache.delete(url);
    }
  }

  if (cache.size <= maxEntries) {
    return;
  }

  const sortedEntries = [...cache.entries()].sort((left, right) => left[1].timestamp - right[1].timestamp);
  const overflowCount = cache.size - maxEntries;

  sortedEntries.slice(0, overflowCount).forEach(([url]) => {
    cache.delete(url);
  });
}

function pruneResponseCache(now = Date.now()) {
  pruneCacheEntries(responseCache, CACHE_TTL, MAX_CACHE_ENTRIES, now);
  pruneCacheEntries(articleImageCache, ARTICLE_IMAGE_CACHE_TTL, ARTICLE_IMAGE_CACHE_MAX_ENTRIES, now);
}

function ensureCleanupInterval() {
  if (cleanupHandle) {
    return;
  }

  cleanupHandle = setInterval(() => {
    pruneResponseCache();
  }, 5 * 60 * 1000);

  cleanupHandle.unref?.();
}

function shutdown() {
  if (cleanupHandle) {
    clearInterval(cleanupHandle);
    cleanupHandle = null;
  }

  articleImageCache.clear();
  responseCache.clear();
}

ensureCleanupInterval();

function normalizeLanguageCode(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return '';
  }

  if (normalized.startsWith('it')) return 'it';
  if (normalized.startsWith('en')) return 'en';
  if (normalized.startsWith('fr')) return 'fr';
  if (normalized.startsWith('es')) return 'es';
  if (normalized.startsWith('de')) return 'de';

  return normalized.slice(0, 2);
}

function detectFeedLanguage(feed: DynamicRecord) {
  const explicitLanguage = normalizeLanguageCode(feed?.language || feed?.lang);
  if (explicitLanguage) {
    return explicitLanguage;
  }

  const sampleText = [
    feed?.title,
    feed?.description,
    ...(Array.isArray(feed?.items) ? feed.items.slice(0, 5).flatMap((item: DynamicRecord) => [item?.title, item?.contentSnippet, item?.description]) : [])
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const languageScores = {
    it: [' il ', ' lo ', ' gli ', ' della ', ' delle ', ' notizie ', ' oggi ', ' con '],
    en: [' the ', ' and ', ' from ', ' news ', ' with ', ' today ', ' this '],
    fr: [' les ', ' des ', ' avec ', ' aujourd', ' monde ', ' pour '],
    es: [' las ', ' los ', ' con ', ' hoy ', ' mundo ', ' para '],
    de: [' und ', ' der ', ' die ', ' mit ', ' heute ', ' nachrichten ']
  };

  const scoredLanguages = Object.entries(languageScores)
    .map(([language, markers]) => ({
      language,
      score: markers.reduce((total, marker) => total + (sampleText.includes(marker) ? 1 : 0), 0)
    }))
    .sort((left, right) => right.score - left.score);

  return scoredLanguages[0]?.score > 0 ? scoredLanguages[0].language : 'it';
}

function normalizeOptionalDate(value: unknown) {
  if (!value) {
    return '';
  }

  const parsed = new Date(value as string | number | Date);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function buildArticleId(source: RssSource, item: DynamicRecord, precomputedCanonicalUrl = '') {
  const stableSourceId = source?.id || '';
  const canonicalUrl = precomputedCanonicalUrl || normalizeArticleUrl(item?.link || '');
  const stableGuid = normalizeIdentityText(item?.guid || item?.id || '');
  const stableTitle = normalizeIdentityText(sanitizeHtml(item?.title || ''), { lowercase: true });
  const stableSummary = normalizeIdentityText(
    sanitizeHtml(item?.contentSnippet || item?.description || item?.contentEncoded || item?.content || ''),
    { lowercase: true }
  ).slice(0, 280);
  const stablePubDate = normalizeOptionalDate(item?.pubDate || item?.dcdate || item?.isoDate);
  const uniqueInput = canonicalUrl
    ? ['url', stableSourceId, canonicalUrl].join('|')
    : stableGuid
      ? ['guid', stableSourceId, stableGuid].join('|')
      : ['fallback', stableSourceId, stableTitle, stableSummary || stablePubDate].join('|');

  return crypto.createHash('sha1').update(uniqueInput).digest('hex');
}

function getImageUrl(item: DynamicRecord | null | undefined) {
  if (!item) {
    return null;
  }

  const mediaImage = findFirstImageUrl(item.media || item['media:content']);
  if (mediaImage) {
    return mediaImage;
  }

  const thumbnailImage = findFirstImageUrl(item.thumbnail || item['media:thumbnail']);
  if (thumbnailImage) {
    return thumbnailImage;
  }

  const enclosureImage = findFirstImageUrl(item.enclosure);
  if (enclosureImage) {
    return enclosureImage;
  }

  const contentToSearch = String(item.content || item.contentEncoded || item.description || '');
  return extractImageFromHtml(contentToSearch, String(item.link || '')) || null;
}

function normalizeImageUrl(rawUrl: unknown, baseUrl = '') {
  if (!rawUrl) {
    return null;
  }

  try {
    const parsedUrl = new URL(String(rawUrl).trim(), baseUrl || undefined);
    return ['http:', 'https:'].includes(parsedUrl.protocol) ? parsedUrl.toString() : null;
  } catch {
    return null;
  }
}

function isGifImageUrl(url: unknown) {
  try {
    return new URL(String(url || '')).pathname.toLowerCase().endsWith('.gif');
  } catch {
    return false;
  }
}

function normalizeCoverImageUrl(rawUrl: unknown, baseUrl = '') {
  const normalized = normalizeImageUrl(rawUrl, baseUrl);
  return normalized && !isGifImageUrl(normalized) ? normalized : null;
}

function extractFirstSrcsetUrl(value: unknown) {
  if (!value) {
    return null;
  }

  const firstEntry = String(value).split(',')[0]?.trim() || '';
  const [firstUrl] = firstEntry.split(/\s+/);
  return firstUrl || null;
}

function findFirstImageUrl(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return normalizeCoverImageUrl(value);
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const imageUrl = findFirstImageUrl(entry);
      if (imageUrl) {
        return imageUrl;
      }
    }

    return null;
  }

  if (typeof value === 'object') {
    const image = value as DynamicRecord;
    const attributes = image.$ && typeof image.$ === 'object' ? image.$ as DynamicRecord : {};
    const directCandidates = [
      image.url,
      image.href,
      image.src,
      image.source,
      attributes.url,
      attributes.href,
      attributes.src,
      extractFirstSrcsetUrl(image.srcset),
      extractFirstSrcsetUrl(attributes.srcset)
    ];

    for (const candidate of directCandidates) {
      const normalized = normalizeCoverImageUrl(candidate);
      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
}

function extractImageFromHtml(html: unknown, baseUrl = '') {
  if (typeof html !== 'string' || !html) {
    return null;
  }

  const imageTagMatches = html.match(/<img[^>]*>/gi);
  if (!imageTagMatches) {
    return null;
  }

  const attributePatterns = [
    /data-lazy-src=["']([^"']+)["']/i,
    /data-src=["']([^"']+)["']/i,
    /data-original=["']([^"']+)["']/i,
    /srcset=["']([^"']+)["']/i,
    /src=["']([^"']+)["']/i
  ];

  for (const imageTag of imageTagMatches) {
    for (const pattern of attributePatterns) {
      const match = imageTag.match(pattern);
      const rawValue = pattern.source.includes('srcset=') ? extractFirstSrcsetUrl(match?.[1]) : match?.[1];
      const normalized = normalizeCoverImageUrl(rawValue, baseUrl);

      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
}

function extractImageFromArticleHtml(html: unknown, pageUrl = '') {
  if (typeof html !== 'string' || !html) {
    return null;
  }

  const metaPatterns = [
    /<meta[^>]+property=["']og:image(?::url)?["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::url)?["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["'][^>]*>/i,
    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["'][^>]*>/i,
    /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']image_src["'][^>]*>/i
  ];

  for (const pattern of metaPatterns) {
    const match = html.match(pattern);
    const normalized = normalizeCoverImageUrl(match?.[1], pageUrl);
    if (normalized) {
      return normalized;
    }
  }

  return extractImageFromHtml(html, pageUrl);
}

function isRetryableFetchError(error: unknown) {
  const status = Number((error as AppError)?.status);
  if (!Number.isFinite(status)) {
    return true;
  }

  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function fetchArticleImage(url: string, options: RssOptions = {}) {
  if (!url) {
    return null;
  }

  pruneResponseCache();

  const cached = articleImageCache.get(url);
  if (cached && (Date.now() - cached.timestamp) < ARTICLE_IMAGE_CACHE_TTL) {
    return cached.data;
  }

  try {
    const response = await limitOutboundFetch(() => fetchSafeTextUrl(url, {
      timeout: ARTICLE_IMAGE_TIMEOUT,
      maxResponseBytes: ARTICLE_IMAGE_MAX_RESPONSE_BYTES,
      signal: options.signal,
      headers: {
        'User-Agent': 'newsflow-image-fallback/1.0 (+https://localhost)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    }), options);
    const imageUrl = extractImageFromArticleHtml(response.data, response.finalUrl || url);

    articleImageCache.set(url, {
      data: imageUrl,
      timestamp: Date.now()
    });
    pruneResponseCache();

    return imageUrl;
  } catch (error) {
    options.signal?.throwIfAborted();
    logger.debug(`Article image fallback failed for ${url}: ${summarizeErrorMessage(error)}`);
    articleImageCache.set(url, {
      data: null,
      timestamp: Date.now()
    });
    pruneResponseCache();
    return null;
  }
}

async function enrichArticlesWithImages(articles: DynamicRecord[] = [], options: RssOptions = {}) {
  const missingImageArticles = articles
    .filter((article) => article && !article.image && article.url)
    .slice(0, ARTICLE_IMAGE_FALLBACK_LIMIT);

  await Promise.allSettled(missingImageArticles.map(async (article) => {
    article.image = await fetchArticleImage(String(article.url), options);
  }));
}

async function fetchFeedXml(url: string, options: RssOptions = {}) {
  pruneResponseCache();

  const cached = responseCache.get(url);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return cached.data;
  }

  let lastError: unknown;
  const maxRetries = typeof options.maxRetries === 'number' && Number.isFinite(options.maxRetries) && options.maxRetries > 0
    ? Math.floor(options.maxRetries)
    : RSS_MAX_RETRIES;
  const timeout = typeof options.timeout === 'number' && Number.isFinite(options.timeout) && options.timeout > 0
    ? Math.floor(options.timeout)
    : RSS_TIMEOUT;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await limitOutboundFetch(() => fetchSafeTextUrl(url, {
        timeout,
        maxResponseBytes: RSS_MAX_RESPONSE_BYTES,
        signal: options.signal,
        headers: RSS_REQUEST_HEADERS
      }), options);

      responseCache.set(url, {
        data: response.data,
        timestamp: Date.now()
      });
      pruneResponseCache();

      return response.data;
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries || !isRetryableFetchError(error)) {
        break;
      }

      const retryDelay = RSS_RETRY_DELAY * attempt;
      logger.warn(`Retry ${attempt}/${maxRetries} for ${redactUrlForLog(url, { redactAllQuery: true })} after ${retryDelay}ms`);
      await wait(retryDelay, undefined, { signal: options.signal });
    }
  }

  throw lastError;
}

async function parseFeedPreview(xml: string, baseUrl: string) {
  const feed = await parser.parseString(xml);
  return {
    title: sanitizeHtml(feed?.title || ''),
    siteUrl: normalizeImageUrl(feed?.link || '', baseUrl) || '',
    language: detectFeedLanguage(feed),
    itemCount: Array.isArray(feed?.items) ? feed.items.length : 0
  };
}

async function discoverFeedUrls(url: string, options: RssOptions = {}): Promise<DiscoveredFeed[]> {
  const response = await limitDiscoveryFetch(() => fetchSafeTextUrl(url, {
    timeout: options.timeout || RSS_VALIDATION_TIMEOUT,
    maxResponseBytes: RSS_DISCOVERY_MAX_RESPONSE_BYTES,
    signal: options.signal,
    headers: RSS_REQUEST_HEADERS
  }), options);
  const finalUrl = response.finalUrl || url;

  try {
    const preview = await parseFeedPreview(response.data, finalUrl);
    return [{ url: finalUrl, title: preview.title.slice(0, 160) }];
  } catch {
    // Website HTML is expected when the submitted URL is not already a feed.
  }

  const feeds = new Map<string, DiscoveredFeed>();
  const inspectHtml = (html: string, pageUrl: string, { collectFeedAnchors = false, findDirectory = false } = {}) => {
    const dom = new JSDOM(html, { url: pageUrl });
    let directoryUrl = '';
    const addFeed = (rawUrl: string, title: string) => {
      try {
        const candidateUrl = new URL(rawUrl, dom.window.document.baseURI);
        const normalizedUrl = candidateUrl.toString();
        if (
          !['http:', 'https:'].includes(candidateUrl.protocol)
          || candidateUrl.username
          || candidateUrl.password
          || normalizedUrl.length > MAX_DISCOVERED_FEED_URL_LENGTH
        ) {
          return;
        }

        if (!feeds.has(normalizedUrl)) {
          feeds.set(normalizedUrl, {
            url: normalizedUrl,
            title: sanitizeHtml(title).slice(0, 160)
          });
        }
      } catch {
        // Ignore malformed declarations and continue inspecting the page.
      }
    };

    try {
      for (const link of dom.window.document.querySelectorAll('link[href]')) {
        const rel = String(link.getAttribute('rel') || '').toLowerCase().split(/\s+/u);
        const type = String(link.getAttribute('type') || '').toLowerCase().split(';', 1)[0].trim();
        if (rel.includes('alternate') && DISCOVERABLE_FEED_TYPES.has(type)) {
          addFeed(link.getAttribute('href') || '', link.getAttribute('title') || '');
        }
        if (feeds.size >= MAX_DISCOVERED_FEEDS) {
          return directoryUrl;
        }
      }

      for (const link of dom.window.document.querySelectorAll('a[href]')) {
        const href = link.getAttribute('href') || '';
        let candidateUrl: URL;
        try {
          candidateUrl = new URL(href, dom.window.document.baseURI);
        } catch {
          continue;
        }

        if (collectFeedAnchors && DIRECT_FEED_URL_HINT.test(candidateUrl.pathname)) {
          addFeed(href, link.textContent || link.getAttribute('title') || '');
        } else if (
          findDirectory
          && !directoryUrl
          && candidateUrl.origin === new URL(pageUrl).origin
          && FEED_DIRECTORY_HINT.test(`${href} ${link.textContent || ''}`)
        ) {
          directoryUrl = candidateUrl.toString();
        }
        if (feeds.size >= MAX_DISCOVERED_FEEDS) {
          return directoryUrl;
        }
      }

      return directoryUrl;
    } finally {
      dom.window.close();
    }
  };

  const directoryUrl = inspectHtml(response.data, finalUrl, { findDirectory: true });
  if (directoryUrl && feeds.size < MAX_DISCOVERED_FEEDS) {
    try {
      const directoryResponse = await limitDiscoveryFetch(() => fetchSafeTextUrl(directoryUrl, {
        timeout: options.timeout || RSS_VALIDATION_TIMEOUT,
        maxResponseBytes: RSS_DISCOVERY_MAX_RESPONSE_BYTES,
        signal: options.signal,
        headers: RSS_REQUEST_HEADERS
      }), options);
      inspectHtml(directoryResponse.data, directoryResponse.finalUrl || directoryUrl, { collectFeedAnchors: true });
    } catch (error) {
      options.signal?.throwIfAborted();
      logger.debug(`RSS directory discovery failed for ${redactUrlForLog(directoryUrl, { redactAllQuery: true })}: ${summarizeErrorMessage(error)}`);
    }
  }

  const finalHost = new URL(finalUrl).hostname.toLowerCase().replace(/^www\./, '');
  if (finalHost === 'lemonde.fr' && feeds.has(new URL('/rss/une.xml', finalUrl).toString())) {
    for (const [title, path] of LE_MONDE_FALLBACK_FEEDS) {
      const feedUrl = new URL(path, finalUrl).toString();
      feeds.set(feedUrl, { title, url: feedUrl });
      if (feeds.size >= MAX_DISCOVERED_FEEDS) {
        break;
      }
    }
  }

  return [...feeds.values()];
}

async function parseFeed(source: RssSource, options: RssOptions = {}) {
  const url = source.url || '';
  if (!url) {
    return [];
  }

  try {
    const xml = await fetchFeedXml(url, options);
    const feed = await parser.parseString(xml);
    const items: DynamicRecord[] = Array.isArray(feed?.items) ? feed.items.slice(0, MAX_ARTICLES_PER_SOURCE) : [];

    const normalizedItems = items
      .filter((item) => item?.title)
      .map((item) => {
        const canonicalUrl = normalizeArticleUrl(item.link || '');

        return {
          id: buildArticleId(source, item, canonicalUrl),
          title: sanitizeHtml(item.title),
          description: sanitizeHtml(item.description || item.contentSnippet || ''),
          content: sanitizeHtml(item.contentEncoded || item.content || ''),
          pubDate: normalizePublicationDate(item.pubDate || item.dcdate || item.isoDate),
          source: source.name,
          sourceId: source.id,
          url: item.link || '',
          canonicalUrl,
          image: getImageUrl(item),
          author: sanitizeHtml(item.creator || item.author || ''),
          language: source.language || 'it',
          ownerUserId: source.ownerUserId || null,
          rawTopics: Array.isArray(item.categories)
            ? item.categories.map((topic: unknown) => sanitizeHtml(topic)).filter(Boolean)
            : []
        };
      });

    if (options.imageFallback !== false) {
      await enrichArticlesWithImages(normalizedItems, options);
    }

    return normalizedItems;
  } catch (error) {
    logger.error(`Failed to parse RSS feed ${source.name} (${redactUrlForLog(url, { redactAllQuery: true })}): ${redactUrlForLog(summarizeErrorMessage(error), { redactAllQuery: true })}`);
    if (options.throwOnError) {
      throw error;
    }

    return [];
  }
}

export = {
  discoverFeedUrls,
  parseFeed,
  shutdown,
  validateFeedUrl: async (url: string, options: RssOptions = {}) => {
    const xml = await fetchFeedXml(url, {
      maxRetries: options.maxRetries || RSS_VALIDATION_MAX_RETRIES,
      timeout: options.timeout || RSS_VALIDATION_TIMEOUT,
      signal: options.signal
    });
    return parseFeedPreview(xml, url);
  },
  _buildArticleId: buildArticleId,
  _getImageUrl: getImageUrl,
  _extractImageFromHtml: extractImageFromHtml,
  _extractImageFromArticleHtml: extractImageFromArticleHtml
};
