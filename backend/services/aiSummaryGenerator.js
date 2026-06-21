const logger = require('../utils/logger');
const { removePromotionalSentences } = require('../utils/promotionalContent');
const { buildArticlePayload, getArticleTextLimit: getSharedArticleTextLimit } = require('./aiArticlePayload');
const {
  createOpenRouterClient,
  extractAssistantContent,
  getOpenRouterConfig,
  parseJsonContent,
  sendJsonChatCompletion
} = require('./openRouterClient');

const DEFAULT_OPENROUTER_SUMMARY_MODEL = 'deepseek/deepseek-v4-flash';
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_PROMPT_TEXT_BUDGET_CHARS = 30000;
const MIN_SUMMARY_TEXT_LENGTH = 60;

function getConfig() {
  return getOpenRouterConfig({
    enabledEnvName: 'AI_SUMMARY_GENERATION_ENABLED',
    modelEnvName: 'OPENROUTER_SUMMARY_MODEL',
    defaultModel: DEFAULT_OPENROUTER_SUMMARY_MODEL,
    timeoutEnvName: 'AI_SUMMARY_REQUEST_TIMEOUT_MS',
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS
  });
}

function getArticleTextLimit(articleCount) {
  return getSharedArticleTextLimit(articleCount, {
    envName: 'AI_SUMMARY_PROMPT_TEXT_BUDGET_CHARS',
    defaultBudgetChars: DEFAULT_PROMPT_TEXT_BUDGET_CHARS
  });
}

function buildPrompt(topicConfig = {}, articles = []) {
  const articleTextLimit = getArticleTextLimit(articles.length);

  return [
    'Write concise, fluid news briefings for the requested topic using only the provided articles.',
    'The style should feel like a clean ChatGPT reading experience: clear context, compact paragraphs, no hype, no bullet spam.',
    'Keep the briefing tightly focused on the requested topic and its canonical topics. Ignore crossover articles where another category is the main story, even if the article has a tangential connection to the requested topic.',
    'Cite article references inline with bracketed numbers like [1] when mentioning a fact.',
    'Do not invent facts, do not use outside knowledge, and do not cite references that are not present in the input.',
    'Exclude promotional shopping deals, coupon or affiliate sale posts, and product price-drop blurbs; do not summarize them as news.',
    'Do not generate or include a title. The schedule window is coverage metadata only; do not name the opening after a time of day such as morning, noon, midday, afternoon, evening, night, mattina, mezzogiorno, pomeriggio, or sera.',
    'Generate the briefing in both supported languages: English and Italian.',
    'Return minified JSON only. Do not use markdown fences or prose outside JSON.',
    'Return this exact shape: {"en":{"paragraphs":["paragraph with [1] citations"]},"it":{"paragraphs":["paragrafo con citazioni [1]"]}}.',
    'Use two to four paragraphs per language. Start a new paragraph whenever the subject, argument, or subtopic changes. Keep each briefing easy to scan but written as prose.',
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

function normalizeLocalizedSummary(payload = {}, locale) {
  const localizedPayload = payload?.[locale] && typeof payload[locale] === 'object' ? payload[locale] : null;
  if (!localizedPayload) {
    return null;
  }

  const paragraphs = Array.isArray(localizedPayload.paragraphs)
    ? localizedPayload.paragraphs
    : [];
  const highlights = Array.isArray(localizedPayload.highlights)
    ? localizedPayload.highlights
    : [];
  const summaryParts = [
    ...paragraphs.map((paragraph) => removePromotionalSentences(paragraph)).filter(Boolean),
    ...highlights.map((highlight) => removePromotionalSentences(highlight)).filter(Boolean)
  ];
  const summaryText = summaryParts.join('\n\n').trim();

  if (!summaryText) {
    return null;
  }

  return {
    summaryText
  };
}

function normalizeGeneratedSummary(payload = {}) {
  const en = normalizeLocalizedSummary(payload, 'en');
  const it = normalizeLocalizedSummary(payload, 'it');

  if (!en?.summaryText || !it?.summaryText) {
    return null;
  }

  return {
    summaryText: en.summaryText,
    summaryTextByLocale: {
      en: en.summaryText,
      it: it.summaryText
    }
  };
}

function createValidationError(message) {
  const error = new Error(message);
  error.code = 'SUMMARY_VALIDATION_FAILED';
  return error;
}

function extractCitationIndexes(text = '') {
  return [...String(text || '').matchAll(/\[(\d+)\]/gu)].map((match) => Number(match[1]));
}

function assertValidCitations(summaryText, articleCount, locale) {
  const citations = extractCitationIndexes(summaryText);
  if (citations.length === 0) {
    throw createValidationError(`AI summary ${locale} text has no citations`);
  }

  const invalidCitation = citations.find((citation) => !Number.isInteger(citation) || citation < 1 || citation > articleCount);
  if (invalidCitation) {
    throw createValidationError(`AI summary ${locale} text has invalid citation [${invalidCitation}]`);
  }
}

function validateGeneratedSummary(summary = {}, articleCount = 0) {
  const enText = String(summary.summaryTextByLocale?.en || '').trim();
  const itText = String(summary.summaryTextByLocale?.it || '').trim();

  if (enText.length < MIN_SUMMARY_TEXT_LENGTH || itText.length < MIN_SUMMARY_TEXT_LENGTH) {
    throw createValidationError('AI summary text is too short');
  }

  if (enText.toLowerCase() === itText.toLowerCase()) {
    throw createValidationError('AI summary English and Italian text are identical');
  }

  assertValidCitations(enText, articleCount, 'English');
  assertValidCitations(itText, articleCount, 'Italian');
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
  const response = await sendJsonChatCompletion(openRouter, {
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
    maxTokens: tokenBudget
  }, { timeoutMs: config.timeoutMs });
  const payload = parseJsonContent(extractAssistantContent(response));
  const normalized = normalizeGeneratedSummary(payload);

  if (!normalized) {
    throw new Error('AI summary response did not contain both English and Italian summary text');
  }

  validateGeneratedSummary(normalized, articles.length);

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
  _normalizeGeneratedSummary: normalizeGeneratedSummary,
  _validateGeneratedSummary: validateGeneratedSummary
};
