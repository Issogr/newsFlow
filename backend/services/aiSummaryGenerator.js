const logger = require('../utils/logger');
const { parseIntegerEnv } = require('../utils/env');

const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_OPENROUTER_SUMMARY_MODEL = 'deepseek/deepseek-v4-flash';
const DEFAULT_TIMEOUT_MS = 120000;

let openRouterSdkLoader = () => import('@openrouter/sdk');
let openRouterSdkPromise = null;

function setOpenRouterSdkLoader(loader) {
  openRouterSdkLoader = loader || (() => import('@openrouter/sdk'));
  openRouterSdkPromise = null;
}

async function loadOpenRouterSdk() {
  if (!openRouterSdkPromise) {
    openRouterSdkPromise = openRouterSdkLoader();
  }

  return openRouterSdkPromise;
}

function getConfig() {
  const apiKey = String(process.env.OPENROUTER_API_KEY || '').trim();
  const enabledValue = String(process.env.AI_SUMMARY_GENERATION_ENABLED || 'auto').trim().toLowerCase();

  return {
    apiKey,
    enabled: enabledValue !== 'false' && Boolean(apiKey),
    model: String(process.env.OPENROUTER_SUMMARY_MODEL || DEFAULT_OPENROUTER_SUMMARY_MODEL).trim() || DEFAULT_OPENROUTER_SUMMARY_MODEL,
    baseUrl: String(process.env.OPENROUTER_BASE_URL || DEFAULT_OPENROUTER_BASE_URL).trim().replace(/\/+$/u, ''),
    timeoutMs: parseIntegerEnv('AI_SUMMARY_REQUEST_TIMEOUT_MS', DEFAULT_TIMEOUT_MS, { min: 1000, max: 120000 })
  };
}

async function createOpenRouterClient(config) {
  const { OpenRouter } = await loadOpenRouterSdk();
  return new OpenRouter({
    apiKey: config.apiKey,
    serverURL: config.baseUrl,
    timeoutMs: config.timeoutMs,
    httpReferer: String(process.env.APP_BASE_URL || 'http://localhost'),
    appTitle: 'News Flow'
  });
}

function truncateText(value, maxLength) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3).trim()}...`;
}

function buildArticlePayload(article = {}, index = 0) {
  const readerText = truncateText(article.readerText || '', Number(article.readerTextMaxChars) || 3000);
  return {
    ref: index + 1,
    title: truncateText(article.title || '', 220),
    description: readerText || truncateText(article.description || article.content || '', 520),
    contentType: readerText ? 'cached_reader_text' : 'rss_metadata',
    source: truncateText(article.source || article.rawSource || '', 120),
    publishedAt: article.pubDate || '',
    url: article.url || ''
  };
}

function buildPrompt(topicConfig = {}, articles = []) {
  return [
    'Write concise, fluid news briefings for the requested topic using only the provided articles.',
    'The style should feel like a clean ChatGPT reading experience: clear context, compact paragraphs, no hype, no bullet spam.',
    'Cite article references inline with bracketed numbers like [1] when mentioning a fact.',
    'Do not invent facts, do not use outside knowledge, and do not cite references that are not present in the input.',
    'Generate the briefing in both supported languages: English and Italian.',
    'Return minified JSON only. Do not use markdown fences or prose outside JSON.',
    'Return this exact shape: {"en":{"title":"Brief title","paragraphs":["paragraph with [1] citations"]},"it":{"title":"Titolo breve","paragraphs":["paragrafo con citazioni [1]"]}}.',
    'Use two to four paragraphs per language. Keep each briefing easy to scan but written as prose.',
    '',
    JSON.stringify({
      topic: topicConfig.label || topicConfig.key,
      canonicalTopics: topicConfig.topics || [],
      periodStart: topicConfig.periodStart,
      periodEnd: topicConfig.periodEnd,
      articles: articles.map(buildArticlePayload)
    })
  ].join('\n');
}

function extractContentPart(value) {
  if (!value) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(extractContentPart).filter(Boolean).join('\n');
  }

  if (typeof value === 'object') {
    return extractContentPart(value.text || value.content || value.outputText || value.output_text);
  }

  return '';
}

function extractAssistantContent(response = {}) {
  const choice = response.choices?.[0] || {};
  return extractContentPart(
    choice.message?.content
      || choice.message?.text
      || choice.text
      || response.outputText
      || response.output_text
      || response.message?.content
      || response.content
  );
}

function parseJsonContent(content) {
  const rawContent = String(content || '').trim();
  if (!rawContent) {
    return null;
  }

  try {
    return JSON.parse(rawContent);
  } catch {
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/u);
    if (!jsonMatch) {
      return null;
    }

    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      return null;
    }
  }
}

function getCompletionTokenBudget(articleCount) {
  return Math.min(4000, 900 + (Math.max(1, articleCount) * 55));
}

function normalizeLocalizedSummary(payload = {}, locale, fallbackTitle = '') {
  const localizedPayload = payload?.[locale] && typeof payload[locale] === 'object' ? payload[locale] : null;
  if (!localizedPayload) {
    return null;
  }

  const title = truncateText(localizedPayload.title || fallbackTitle, 160);
  const paragraphs = Array.isArray(localizedPayload.paragraphs)
    ? localizedPayload.paragraphs
    : [];
  const highlights = Array.isArray(localizedPayload.highlights)
    ? localizedPayload.highlights
    : [];
  const summaryParts = [
    ...paragraphs.map((paragraph) => String(paragraph || '').trim()).filter(Boolean),
    ...highlights.map((highlight) => String(highlight || '').trim()).filter(Boolean)
  ];
  const summaryText = summaryParts.join('\n\n').trim();

  if (!summaryText) {
    return null;
  }

  return {
    title,
    summaryText
  };
}

function normalizeGeneratedSummary(payload = {}, fallbackTitle = '') {
  const en = normalizeLocalizedSummary(payload, 'en', fallbackTitle);
  const it = normalizeLocalizedSummary(payload, 'it', fallbackTitle);

  if (!en?.summaryText || !it?.summaryText) {
    return null;
  }

  return {
    title: en.title,
    summaryText: en.summaryText,
    titleByLocale: {
      en: en.title,
      it: it.title
    },
    summaryTextByLocale: {
      en: en.summaryText,
      it: it.summaryText
    }
  };
}

async function generateSummaryForArticles(topicConfig = {}, articles = []) {
  const config = getConfig();
  if (!Array.isArray(articles) || articles.length === 0) {
    return null;
  }

  if (!config.enabled) {
    logger.info(`AI summary generation skipped: reason=${config.apiKey ? 'disabled' : 'missing_api_key'}, topic=${topicConfig.key || 'unknown'}`);
    return null;
  }

  const startedAt = Date.now();
  const openRouter = await createOpenRouterClient(config);
  const tokenBudget = getCompletionTokenBudget(articles.length);
  const completionPromise = openRouter.chat.send({
    chatRequest: {
      model: config.model,
      messages: [
        {
          role: 'system',
          content: 'You write concise, source-grounded news briefings. Return valid JSON only.'
        },
        {
          role: 'user',
          content: buildPrompt(topicConfig, articles)
        }
      ],
      temperature: 0.25,
      maxTokens: tokenBudget,
      maxCompletionTokens: tokenBudget,
      reasoning: {
        enabled: false,
        effort: 'none',
        maxTokens: 0
      },
      responseFormat: { type: 'json_object' },
      stream: false
    }
  }, {
    retries: { strategy: 'none' },
    timeoutMs: config.timeoutMs
  });

  if (completionPromise && typeof completionPromise.catch === 'function') {
    completionPromise.catch(() => {});
  }

  const response = await completionPromise;
  const payload = parseJsonContent(extractAssistantContent(response));
  const normalized = normalizeGeneratedSummary(payload, topicConfig.label || topicConfig.key || 'News briefing');

  if (!normalized) {
    throw new Error('AI summary response did not contain both English and Italian summary text');
  }

  logger.info(`AI summary generated: topic=${topicConfig.key}, model=${config.model}, articles=${articles.length}, durationMs=${Date.now() - startedAt}`);
  return {
    ...normalized,
    model: config.model
  };
}

function isAiSummaryGenerationAvailable() {
  return getConfig().enabled;
}

module.exports = {
  generateSummaryForArticles,
  isAiSummaryGenerationAvailable,
  _buildPrompt: buildPrompt,
  _getConfig: getConfig,
  _parseJsonContent: parseJsonContent,
  _setOpenRouterSdkLoader: setOpenRouterSdkLoader
};
