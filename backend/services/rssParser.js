const crypto = require('crypto');
const axios = require('axios');
const RSSParser = require('rss-parser');
const logger = require('../utils/logger');
const { sanitizeHtml } = require('../utils/inputValidator');

const MAX_ARTICLES_PER_SOURCE = parseInt(process.env.MAX_ARTICLES_PER_SOURCE || '25', 10);
const RSS_MAX_RETRIES = parseInt(process.env.RSS_MAX_RETRIES || '4', 10);
const RSS_RETRY_DELAY = parseInt(process.env.RSS_RETRY_DELAY || '1500', 10);
const RSS_TIMEOUT = parseInt(process.env.RSS_TIMEOUT || '15000', 10);
const CACHE_TTL = parseInt(process.env.RSS_CACHE_TTL || '60000', 10);

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
    'User-Agent': 'news-aggregator/2.0 (+https://localhost)'
  }
});

const responseCache = new Map();

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

function normalizeDate(value) {
  const parsed = new Date(value || Date.now());
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function buildArticleId(source, item) {
  const uniqueInput = [
    source.id,
    item.guid || item.id || '',
    item.link || '',
    item.title || '',
    normalizeDate(item.pubDate || item.dcdate || item.isoDate)
  ].join('|');

  return crypto.createHash('sha1').update(uniqueInput).digest('hex');
}

function getImageUrl(item) {
  if (!item) {
    return null;
  }

  if (item.media?.$?.url) {
    return item.media.$.url;
  }

  if (item.thumbnail?.$?.url) {
    return item.thumbnail.$.url;
  }

  if (item.enclosure?.url) {
    return item.enclosure.url;
  }

  const contentToSearch = item.content || item.contentEncoded || item.description || '';
  const match = typeof contentToSearch === 'string'
    ? contentToSearch.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i)
    : null;

  return match?.[1]?.startsWith('http') ? match[1] : null;
}

async function fetchFeedXml(url) {
  const cached = responseCache.get(url);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return cached.data;
  }

  let lastError;

  for (let attempt = 1; attempt <= RSS_MAX_RETRIES; attempt += 1) {
    try {
      const response = await axios.get(url, {
        timeout: RSS_TIMEOUT,
        responseType: 'text',
        headers: {
          'User-Agent': 'news-aggregator/2.0 (+https://localhost)',
          Accept: 'application/rss+xml, application/xml, text/xml, */*'
        },
        transformResponse: [(data) => data]
      });

      responseCache.set(url, {
        data: response.data,
        timestamp: Date.now()
      });

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

async function parseFeed(source) {
  const url = source.url || '';
  if (!url) {
    return [];
  }

  try {
    const xml = await fetchFeedXml(url);
    const feed = await parser.parseString(xml);
    const items = Array.isArray(feed?.items) ? feed.items.slice(0, MAX_ARTICLES_PER_SOURCE) : [];

    return items
      .filter((item) => item?.title)
      .map((item) => ({
        id: buildArticleId(source, item),
        title: sanitizeHtml(item.title),
        description: sanitizeHtml(item.description || ''),
        content: sanitizeHtml(item.contentEncoded || item.content || ''),
        pubDate: normalizeDate(item.pubDate || item.dcdate || item.isoDate),
        source: source.name,
        sourceId: source.id,
        url: item.link || '',
        image: getImageUrl(item),
        author: sanitizeHtml(item.creator || item.author || ''),
        language: source.language || 'it',
        ownerUserId: source.ownerUserId || null,
        rawTopics: Array.isArray(item.categories)
          ? item.categories.map((topic) => sanitizeHtml(topic)).filter(Boolean)
          : []
      }));
  } catch (error) {
    logger.error(`Failed to parse RSS feed ${source.name} (${url}): ${error.message}`);
    return [];
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [url, entry] of responseCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL) {
      responseCache.delete(url);
    }
  }
}, 5 * 60 * 1000);

module.exports = {
  parseFeed,
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
  _normalizeDate: normalizeDate
};
