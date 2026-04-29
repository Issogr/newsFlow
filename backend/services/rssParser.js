const crypto = require('crypto');
const RSSParser = require('rss-parser');
const logger = require('../utils/logger');
const summarizeErrorMessage = require('../utils/summarizeError');
const { sanitizeHtml } = require('../utils/inputValidator');
const { normalizeArticleUrl, normalizeIdentityText } = require('../utils/articleIdentity');
const { normalizePublicationDate } = require('../utils/publicationDate');
const { fetchSafeTextUrl } = require('../utils/urlSafety');

const MAX_ARTICLES_PER_SOURCE = parseInt(process.env.MAX_ARTICLES_PER_SOURCE || '25', 10);
const RSS_MAX_RETRIES = parseInt(process.env.RSS_MAX_RETRIES || '4', 10);
const RSS_RETRY_DELAY = parseInt(process.env.RSS_RETRY_DELAY || '1500', 10);
const RSS_TIMEOUT = parseInt(process.env.RSS_TIMEOUT || '15000', 10);
const CACHE_TTL = parseInt(process.env.RSS_CACHE_TTL || '60000', 10);
const MAX_CACHE_ENTRIES = parseInt(process.env.RSS_CACHE_MAX_ENTRIES || '200', 10);
const ARTICLE_IMAGE_TIMEOUT = parseInt(process.env.ARTICLE_IMAGE_TIMEOUT || '8000', 10);
const ARTICLE_IMAGE_CACHE_TTL = parseInt(process.env.ARTICLE_IMAGE_CACHE_TTL || String(6 * 60 * 60 * 1000), 10);
const ARTICLE_IMAGE_CACHE_MAX_ENTRIES = parseInt(process.env.ARTICLE_IMAGE_CACHE_MAX_ENTRIES || '500', 10);
const ARTICLE_IMAGE_FALLBACK_LIMIT = parseInt(process.env.ARTICLE_IMAGE_FALLBACK_LIMIT || '4', 10);
const RSS_MAX_RESPONSE_BYTES = parseInt(process.env.RSS_MAX_RESPONSE_BYTES || '1048576', 10);
const ARTICLE_IMAGE_MAX_RESPONSE_BYTES = parseInt(process.env.ARTICLE_IMAGE_MAX_RESPONSE_BYTES || '524288', 10);

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
  headers: {
    'User-Agent': 'newsflow/2.0 (+https://localhost)'
  }
});

const responseCache = new Map();
const articleImageCache = new Map();
let cleanupHandle = null;

function pruneCacheEntries(cache, ttl, maxEntries, now = Date.now()) {
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
    return cleanupHandle;
  }

  cleanupHandle = setInterval(() => {
    pruneResponseCache();
  }, 5 * 60 * 1000);

  if (typeof cleanupHandle.unref === 'function') {
    cleanupHandle.unref();
  }

  return cleanupHandle;
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

function normalizeLanguageCode(value) {
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

function detectFeedLanguage(feed) {
  const explicitLanguage = normalizeLanguageCode(feed?.language || feed?.lang);
  if (explicitLanguage) {
    return explicitLanguage;
  }

  const sampleText = [
    feed?.title,
    feed?.description,
    ...(Array.isArray(feed?.items) ? feed.items.slice(0, 5).flatMap((item) => [item?.title, item?.contentSnippet, item?.description]) : [])
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

function normalizeDate(value, referenceDate = new Date()) {
  return normalizePublicationDate(value, referenceDate);
}

function normalizeOptionalDate(value) {
  if (!value) {
    return '';
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}

function buildArticleId(source, item, precomputedCanonicalUrl = '') {
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

function getImageUrl(item) {
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

  const contentToSearch = item.content || item.contentEncoded || item.description || '';
  return extractImageFromHtml(contentToSearch, item.link || '') || null;
}

function normalizeImageUrl(rawUrl, baseUrl = '') {
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

function extractFirstSrcsetUrl(value) {
  if (!value) {
    return null;
  }

  const firstEntry = String(value).split(',')[0]?.trim() || '';
  const [firstUrl] = firstEntry.split(/\s+/);
  return firstUrl || null;
}

function findFirstImageUrl(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return normalizeImageUrl(value);
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
    const directCandidates = [
      value.url,
      value.href,
      value.src,
      value.source,
      value.$?.url,
      value.$?.href,
      value.$?.src,
      extractFirstSrcsetUrl(value.srcset),
      extractFirstSrcsetUrl(value.$?.srcset)
    ];

    for (const candidate of directCandidates) {
      const normalized = normalizeImageUrl(candidate);
      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
}

function extractImageFromHtml(html, baseUrl = '') {
  if (typeof html !== 'string' || !html) {
    return null;
  }

  const imageTagMatch = html.match(/<img[^>]*>/i);
  if (!imageTagMatch) {
    return null;
  }

  const imageTag = imageTagMatch[0];
  const attributePatterns = [
    /data-lazy-src=["']([^"']+)["']/i,
    /data-src=["']([^"']+)["']/i,
    /data-original=["']([^"']+)["']/i,
    /srcset=["']([^"']+)["']/i,
    /src=["']([^"']+)["']/i
  ];

  for (const pattern of attributePatterns) {
    const match = imageTag.match(pattern);
    const rawValue = pattern.source.includes('srcset=') ? extractFirstSrcsetUrl(match?.[1]) : match?.[1];
    const normalized = normalizeImageUrl(rawValue, baseUrl);

    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function extractImageFromArticleHtml(html, pageUrl = '') {
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
    const normalized = normalizeImageUrl(match?.[1], pageUrl);
    if (normalized) {
      return normalized;
    }
  }

  return extractImageFromHtml(html, pageUrl);
}

async function fetchArticleImage(url) {
  if (!url) {
    return null;
  }

  pruneResponseCache();

  const cached = articleImageCache.get(url);
  if (cached && (Date.now() - cached.timestamp) < ARTICLE_IMAGE_CACHE_TTL) {
    return cached.data;
  }

  try {
    const response = await fetchSafeTextUrl(url, {
      timeout: ARTICLE_IMAGE_TIMEOUT,
      maxResponseBytes: ARTICLE_IMAGE_MAX_RESPONSE_BYTES,
      headers: {
        'User-Agent': 'newsflow-image-fallback/1.0 (+https://localhost)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    const imageUrl = extractImageFromArticleHtml(response.data, response.finalUrl || url);

    articleImageCache.set(url, {
      data: imageUrl,
      timestamp: Date.now()
    });
    pruneResponseCache();

    return imageUrl;
  } catch (error) {
    logger.debug(`Article image fallback failed for ${url}: ${summarizeErrorMessage(error)}`);
    articleImageCache.set(url, {
      data: null,
      timestamp: Date.now()
    });
    pruneResponseCache();
    return null;
  }
}

async function enrichArticlesWithImages(articles = []) {
  const missingImageArticles = articles
    .filter((article) => article && !article.image && article.url)
    .slice(0, ARTICLE_IMAGE_FALLBACK_LIMIT);

  await Promise.allSettled(missingImageArticles.map(async (article) => {
    article.image = await fetchArticleImage(article.url);
  }));

  return articles;
}

async function fetchFeedXml(url) {
  pruneResponseCache();

  const cached = responseCache.get(url);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return cached.data;
  }

  let lastError;

  for (let attempt = 1; attempt <= RSS_MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetchSafeTextUrl(url, {
        timeout: RSS_TIMEOUT,
        maxResponseBytes: RSS_MAX_RESPONSE_BYTES,
        headers: {
          'User-Agent': 'newsflow/2.0 (+https://localhost)',
          Accept: 'application/rss+xml, application/xml, text/xml, */*'
        }
      });

      responseCache.set(url, {
        data: response.data,
        timestamp: Date.now()
      });
      pruneResponseCache();

      return response.data;
    } catch (error) {
      lastError = error;
      if (attempt === RSS_MAX_RETRIES) {
        break;
      }

      const delay = RSS_RETRY_DELAY * attempt;
      logger.warn(`Retry ${attempt}/${RSS_MAX_RETRIES} for ${url} after ${delay}ms`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

async function parseFeed(source, options = {}) {
  const url = source.url || '';
  if (!url) {
    return [];
  }

  try {
    const xml = await fetchFeedXml(url);
    const feed = await parser.parseString(xml);
    const items = Array.isArray(feed?.items) ? feed.items.slice(0, MAX_ARTICLES_PER_SOURCE) : [];

    const normalizedItems = items
      .filter((item) => item?.title)
      .map((item) => {
        const canonicalUrl = normalizeArticleUrl(item.link || '');

        return {
          id: buildArticleId(source, item, canonicalUrl),
          title: sanitizeHtml(item.title),
          description: sanitizeHtml(item.description || ''),
          content: sanitizeHtml(item.contentEncoded || item.content || ''),
          pubDate: normalizeDate(item.pubDate || item.dcdate || item.isoDate),
          source: source.name,
          sourceId: source.id,
          url: item.link || '',
          canonicalUrl,
          image: getImageUrl(item),
          author: sanitizeHtml(item.creator || item.author || ''),
          language: source.language || 'it',
          ownerUserId: source.ownerUserId || null,
          rawTopics: Array.isArray(item.categories)
            ? item.categories.map((topic) => sanitizeHtml(topic)).filter(Boolean)
            : []
        };
      });

    await enrichArticlesWithImages(normalizedItems);

    return normalizedItems;
  } catch (error) {
    logger.error(`Failed to parse RSS feed ${source.name} (${url}): ${summarizeErrorMessage(error)}`);
    if (options.throwOnError) {
      throw error;
    }

    return [];
  }
}

module.exports = {
  parseFeed,
  shutdown,
  validateFeedUrl: async (url) => {
    const xml = await fetchFeedXml(url);
    const feed = await parser.parseString(xml);
    return {
      title: sanitizeHtml(feed?.title || ''),
      language: detectFeedLanguage(feed),
      itemCount: Array.isArray(feed?.items) ? feed.items.length : 0
    };
  },
  _buildArticleId: buildArticleId,
  _normalizeArticleUrl: normalizeArticleUrl,
  _normalizeDate: normalizeDate,
  _getImageUrl: getImageUrl,
  _extractImageFromHtml: extractImageFromHtml,
  _extractImageFromArticleHtml: extractImageFromArticleHtml,
  _normalizeOptionalDate: normalizeOptionalDate,
  _pruneResponseCache: pruneResponseCache,
  _responseCache: responseCache
};
