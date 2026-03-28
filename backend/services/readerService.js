const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const database = require('./database');
const logger = require('../utils/logger');
const summarizeErrorMessage = require('../utils/summarizeError');
const { createError } = require('../utils/errorHandler');
const { fetchSafeTextUrl } = require('../utils/urlSafety');

const READER_TIMEOUT = parseInt(process.env.READER_TIMEOUT || '12000', 10);
const READER_CACHE_TTL_MS = parseInt(process.env.READER_CACHE_TTL_MS || String(24 * 60 * 60 * 1000), 10);
const READER_MAX_RESPONSE_BYTES = parseInt(process.env.READER_MAX_RESPONSE_BYTES || '2097152', 10);
const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'UL', 'OL', 'PRE']);
const CONTAINER_TAGS = new Set(['ARTICLE', 'SECTION', 'DIV', 'MAIN']);

function normalizeText(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
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

function extractTextFromNode(node) {
  if (!node) {
    return '';
  }

  return normalizeText(node.textContent || '');
}

function extractListItems(listNode) {
  return [...listNode.querySelectorAll(':scope > li')]
    .map((item) => extractTextFromNode(item))
    .filter(Boolean);
}

function createTextBlock(type, text, level) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return null;
  }

  return level ? { type, text: normalized, level } : { type, text: normalized };
}

function extractBlocksFromElement(element, blocks = []) {
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

    const tagName = node.tagName.toUpperCase();

    if (tagName === 'UL' || tagName === 'OL') {
      const items = extractListItems(node);
      if (items.length > 0) {
        blocks.push({
          type: tagName === 'UL' ? 'unordered-list' : 'ordered-list',
          items
        });
      }
      return;
    }

    if (tagName === 'BLOCKQUOTE') {
      const quoteBlock = createTextBlock('blockquote', extractTextFromNode(node));
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
      const paragraphBlock = createTextBlock('paragraph', extractTextFromNode(node));
      if (paragraphBlock) {
        blocks.push(paragraphBlock);
      }
      return;
    }

    if (CONTAINER_TAGS.has(tagName)) {
      extractBlocksFromElement(node, blocks);
      return;
    }

    if (!BLOCK_TAGS.has(tagName)) {
      const fallbackBlock = createTextBlock('paragraph', extractTextFromNode(node));
      if (fallbackBlock) {
        blocks.push(fallbackBlock);
      }
    }
  });

  return blocks;
}

function dedupeAdjacentBlocks(blocks = []) {
  return blocks.reduce((result, block) => {
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

function buildBlocksFromHtml(html) {
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

function buildBlocksFromPlainText(text) {
  return splitParagraphs(text).map((paragraph) => ({
    type: 'paragraph',
    text: paragraph
  }));
}

function blocksToText(blocks = []) {
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

function buildPayload(article, data, cached = false) {
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
    contentBlocks: buildBlocksFromPlainText(fallbackText),
    fetchedAt: new Date().toISOString()
  });
}

async function fetchReaderPayload(article) {
  const response = await fetchSafeTextUrl(article.url, {
    timeout: READER_TIMEOUT,
    maxResponseBytes: READER_MAX_RESPONSE_BYTES,
    headers: {
      'User-Agent': 'news-aggregator-reader/1.0 (+https://localhost)',
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

async function getReaderArticle(articleId, options = {}) {
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
  }

  try {
    const payload = await fetchReaderPayload(article);
    database.upsertReaderCache(articleId, payload);
    return payload;
  } catch (error) {
    logger.debug(`Reader mode extraction fell back for ${article.url}: ${summarizeErrorMessage(error)}`);

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
  _calculateMinutesToRead: calculateMinutesToRead,
  _buildBlocksFromHtml: buildBlocksFromHtml,
  _blocksToText: blocksToText
};
