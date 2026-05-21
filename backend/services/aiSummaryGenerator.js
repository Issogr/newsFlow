const logger = require('../utils/logger');
const { parseIntegerEnv } = require('../utils/env');
const {
  createOpenRouterClient,
  extractAssistantContent,
  getOpenRouterConfig,
  parseJsonContent,
  setOpenRouterSdkLoader
} = require('./openRouterClient');

const DEFAULT_OPENROUTER_SUMMARY_MODEL = 'deepseek/deepseek-v4-flash';
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_PROMPT_TEXT_BUDGET_CHARS = 30000;
const MIN_ARTICLE_TEXT_CHARS = 220;
const DEFAULT_READER_TEXT_MAX_CHARS = 3000;
const DEFAULT_RSS_METADATA_MAX_CHARS = 520;

function getConfig() {
  return getOpenRouterConfig({
    enabledEnvName: 'AI_SUMMARY_GENERATION_ENABLED',
    modelEnvName: 'OPENROUTER_SUMMARY_MODEL',
    defaultModel: DEFAULT_OPENROUTER_SUMMARY_MODEL,
    timeoutEnvName: 'AI_SUMMARY_REQUEST_TIMEOUT_MS',
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS
  });
}

function truncateText(value, maxLength) {
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

function getPromptTextBudgetChars() {
  return parseIntegerEnv('AI_SUMMARY_PROMPT_TEXT_BUDGET_CHARS', DEFAULT_PROMPT_TEXT_BUDGET_CHARS, { min: 10000, max: 240000 });
}

function getArticleTextLimit(articleCount) {
  return Math.max(MIN_ARTICLE_TEXT_CHARS, Math.floor(getPromptTextBudgetChars() / Math.max(1, Number(articleCount) || 1)));
}

function buildArticlePayload(article = {}, index = 0, options = {}) {
  const articleTextLimit = Math.min(
    Number(article.readerTextMaxChars) || DEFAULT_READER_TEXT_MAX_CHARS,
    Number(options.articleTextLimit) || DEFAULT_READER_TEXT_MAX_CHARS
  );
  const readerText = truncateText(article.readerText || '', articleTextLimit);
  const fallbackText = truncateText(article.description || article.content || '', Math.min(DEFAULT_RSS_METADATA_MAX_CHARS, articleTextLimit));

  return {
    ref: index + 1,
    title: truncateText(article.title || '', 220),
    description: readerText || fallbackText,
    contentType: readerText ? 'cached_reader_text' : 'rss_metadata',
    source: truncateText(article.source || article.rawSource || '', 120),
    publishedAt: article.pubDate || ''
  };
}

function buildPrompt(topicConfig = {}, articles = []) {
  const articleTextLimit = getArticleTextLimit(articles.length);

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
      articles: articles.map((article, index) => buildArticlePayload(article, index, { articleTextLimit }))
    })
  ].join('\n');
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
  _getArticleTextLimit: getArticleTextLimit,
  _getConfig: getConfig,
  _parseJsonContent: parseJsonContent,
  _setOpenRouterSdkLoader: setOpenRouterSdkLoader
};
