const logger = require('../utils/logger');
const { readAiToggleValue } = require('../config/aiFeatures');
const { parseIntegerEnv } = require('../utils/env');
const {
  createOpenRouterClient,
  extractAssistantContent,
  getOpenRouterConfig,
  parseJsonContent,
  sendJsonChatCompletion,
  setOpenRouterSdkLoader
} = require('./openRouterClient');
const { truncateText } = require('./aiArticlePayload');
const {
  isTimeoutError,
  resolveClassifierEntryId,
  runBatchedClassifier,
  summarizeResponseShape,
} = require('./aiClassifierUtils');

const DEFAULT_OPENROUTER_TOPIC_MODEL = 'qwen/qwen3.5-9b';
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_BATCH_CONCURRENCY = 1;
const DEFAULT_MAX_ARTICLES_PER_REFRESH = 160;
const DEFAULT_TIMEOUT_MS = 30000;
const VALID_LABELS = new Set(['low', 'medium', 'high']);

const STRONG_CLICKBAIT_PATTERNS = [
  /you\s+won'?t\s+believe/iu,
  /what\s+happened\s+next/iu,
  /will\s+blow\s+your\s+mind/iu,
  /non\s+crederai/iu,
  /cosa\s+e\s+successo\s+dopo/iu,
  /cosa\s+e\s+successo/iu,
  /da\s+non\s+credere/iu,
  /senza\s+parole/iu,
  /da\s+brividi/iu,
  /la\s+verita\s+su/iu,
  /the\s+truth\s+about/iu,
  /il\s+segreto\s+di/iu,
  /the\s+secret\s+to/iu
];

const MODERATE_CLICKBAIT_PATTERNS = [
  /here'?s\s+why/iu,
  /this\s+is\s+why/iu,
  /the\s+reason\s+why/iu,
  /ecco\s+perche/iu,
  /ecco\s+cosa/iu,
  /il\s+motivo\s+per\s+cui/iu,
  /scopri/iu,
  /svelat[oaie]/iu,
  /revealed/iu,
  /viral/iu,
  /tutti\s+ne\s+parlano/iu,
  /everyone\s+is\s+talking/iu,
  /mai\s+visto/iu,
  /never\s+seen/iu,
  /shock(?:ing)?/iu,
  /clamoros[oaie]/iu,
  /incredibil[ei]/iu,
  /unbelievable/iu,
  /assurd[oaie]/iu,
  /jaw[-\s]?dropping/iu
];

const VAGUE_HOOK_PATTERNS = [
  /^(this|these|that|those)\b/iu,
  /^(quest[oaie]|questi|queste)\b/iu,
  /\b(something|someone|qualcosa|qualcuno)\b/iu
];

function getConfig() {
  const defaultModel = String(process.env.OPENROUTER_TOPIC_MODEL || DEFAULT_OPENROUTER_TOPIC_MODEL).trim() || DEFAULT_OPENROUTER_TOPIC_MODEL;
  const openRouterConfig = getOpenRouterConfig({
    enabledEnvName: 'AI_CLICKBAIT_DETECTION_ENABLED',
    modelEnvName: 'OPENROUTER_CLICKBAIT_MODEL',
    defaultModel,
    timeoutEnvName: 'AI_CLICKBAIT_REQUEST_TIMEOUT_MS',
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
    clampTimeout: true
  });

  return {
    ...openRouterConfig,
    batchSize: parseIntegerEnv('AI_TOPIC_BATCH_SIZE', DEFAULT_BATCH_SIZE, { min: 1, max: 50, clamp: true, strict: true }),
    batchConcurrency: parseIntegerEnv('AI_TOPIC_BATCH_CONCURRENCY', DEFAULT_BATCH_CONCURRENCY, { min: 1, max: 4, clamp: true, strict: true }),
    maxArticlesPerRefresh: parseIntegerEnv('AI_TOPIC_MAX_ARTICLES_PER_REFRESH', DEFAULT_MAX_ARTICLES_PER_REFRESH, { min: 1, max: 1000, clamp: true, strict: true }),
    deterministicSkipEnabled: readAiToggleValue('AI_TOPIC_DETERMINISTIC_SKIP_ENABLED') !== 'false'
  };
}

function normalizeText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[’‘]/gu, "'")
    .replace(/[“”]/gu, '"')
    .replace(/\s+/gu, ' ')
    .trim();
}

function normalizeLabel(value = '') {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return '';
  }

  if (['low', 'basso', 'bassa', 'none', 'no', 'not clickbait', 'no clickbait'].includes(normalized)) {
    return 'low';
  }
  if (['medium', 'moderate', 'medio', 'media', 'moderato', 'moderata'].includes(normalized)) {
    return 'medium';
  }
  if (['high', 'alto', 'alta'].includes(normalized)) {
    return 'high';
  }

  const firstToken = normalized.split(/[^a-z]+/u).find(Boolean) || '';
  if (VALID_LABELS.has(firstToken)) {
    return firstToken;
  }

  return '';
}

function clampScore(score) {
  return Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
}

function labelToScore(label) {
  if (label === 'high') {
    return 85;
  }
  if (label === 'medium') {
    return 50;
  }
  return 15;
}

function scoreToLabel(score) {
  if (score >= 67) {
    return 'high';
  }
  if (score >= 34) {
    return 'medium';
  }
  return 'low';
}

function countPatternMatches(patterns = [], text = '') {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

function getAllCapsWordCount(title = '') {
  return (String(title || '').match(/\b[A-ZÀ-ÖØ-Þ]{4,}\b/gu) || []).length;
}

function getTitleTokenCount(title = '') {
  return normalizeText(title).split(/\s+/u).filter((token) => /[a-z0-9]/iu.test(token)).length;
}

function scoreArticleLocally(article = {}) {
  const title = normalizeText(article.title || '');
  const description = normalizeText(article.description || '');
  const text = `${title} ${description}`.trim();
  const strongSignals = countPatternMatches(STRONG_CLICKBAIT_PATTERNS, text);
  const moderateSignals = countPatternMatches(MODERATE_CLICKBAIT_PATTERNS, text);
  const vagueHooks = countPatternMatches(VAGUE_HOOK_PATTERNS, title);
  const allCapsWords = getAllCapsWordCount(title);
  const repeatedPunctuation = /([!?])\1{1,}/u.test(title) ? 1 : 0;
  const questionMark = title.includes('?') ? 1 : 0;
  const exclamationMark = title.includes('!') ? 1 : 0;
  const listicle = /(?:^|\b)(?:\d+|ten|dieci|cinque|sette)\s+(?:things|ways|reasons|cose|modi|ragioni|motivi)\b/iu.test(title) ? 1 : 0;
  const teaserSeparator = /:\s*(?:ecco|here|this|these|quest[oaie]|scopri)\b/iu.test(title) ? 1 : 0;
  const signalCount = strongSignals + moderateSignals + vagueHooks + allCapsWords + repeatedPunctuation + questionMark + exclamationMark + listicle + teaserSeparator;
  const score = clampScore(
    (strongSignals * 42)
    + (moderateSignals * 22)
    + (vagueHooks * 14)
    + (allCapsWords * 8)
    + (repeatedPunctuation * 18)
    + (questionMark * 10)
    + (exclamationMark * 12)
    + (listicle * 18)
    + (teaserSeparator * 12)
  );

  return {
    score,
    signalCount,
    strongSignals,
    moderateSignals,
    titleTokenCount: getTitleTokenCount(title),
    hasQuestionOrExclamation: Boolean(questionMark || exclamationMark || repeatedPunctuation)
  };
}

function getDeterministicClickbaitClassification(article = {}) {
  const local = scoreArticleLocally(article);
  const label = scoreToLabel(local.score);
  let confidence = 0;

  if (label === 'high' && (local.score >= 70 || local.strongSignals >= 1)) {
    confidence = 0.9;
  } else if (label === 'medium' && local.signalCount >= 2 && local.score >= 38) {
    confidence = 0.82;
  } else if (label === 'low' && local.score <= 12 && local.signalCount === 0 && local.titleTokenCount >= 4) {
    confidence = 0.86;
  }

  if (confidence < 0.8) {
    return null;
  }

  return {
    label,
    score: local.score,
    confidence,
    source: 'local',
    reasonCode: `local_clear_${label}`
  };
}

function splitDeterministicAndAiArticles(articles = [], config = {}) {
  const deterministicClassificationsByArticleId = new Map();
  const aiArticles = [];

  articles.forEach((article) => {
    const deterministicClassification = config.deterministicSkipEnabled
      ? getDeterministicClickbaitClassification(article)
      : null;
    if (deterministicClassification) {
      deterministicClassificationsByArticleId.set(article.id, deterministicClassification);
      return;
    }

    aiArticles.push(article);
  });

  return { aiArticles, deterministicClassificationsByArticleId };
}

function buildArticlePayload(article = {}, index = 0) {
  return {
    ref: index + 1,
    title: truncateText(article.title || '', 240),
    description: truncateText(article.description || '', 420)
  };
}

function buildPrompt(batch = []) {
  return [
    'Classify how clickbait-like each news item is using only the title and short description.',
    'Return one label per item when possible: low, medium, or high.',
    'Low means factual, specific, and neutral. Medium means some teaser, emotional, vague, listicle, or promotional framing. High means strong curiosity gap, sensationalism, exaggerated punctuation, emotional manipulation, or misleading teaser framing.',
    'Do not judge the topic, publisher, political stance, or importance of the event. Judge only headline/description framing.',
    'Each item has a numeric ref. Return refs, not article ids.',
    'Return minified JSON only. Do not use markdown fences, prose, or trailing explanations.',
    'Return strict JSON only with this shape: {"clickbaitByRef":[{"ref":1,"label":"low","confidence":0.9,"score":12}]}',
    'Confidence must be between 0 and 1. Score must be an integer from 0 to 100. Omit only items that are impossible to judge from the provided text.',
    '',
    JSON.stringify({ articles: batch.map(buildArticlePayload) })
  ].join('\n');
}

function getCompletionTokenBudget(batchLength) {
  return Math.min(1600, 240 + (Math.max(1, batchLength) * 80));
}

function getClassifierEntries(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  return [
    payload?.clickbaitByRef,
    payload?.clickbaitById,
    payload?.results,
    payload?.classifications,
    payload?.articles,
    payload?.items
  ].find(Array.isArray) || [];
}

function getClassifierEntryLabel(entry = {}) {
  return normalizeLabel(entry.label || entry.clickbaitLabel || entry.clickbait || entry.level || entry.category || '');
}

function normalizeClassifierResults(payload, allowedIds = new Set(), refToArticleId = null) {
  const entries = getClassifierEntries(payload);
  const result = new Map();

  entries.forEach((entry) => {
    const id = resolveClassifierEntryId(entry, allowedIds, refToArticleId);
    if (!id) {
      return;
    }

    const rawScore = Number(entry.score ?? entry.clickbaitScore);
    const label = getClassifierEntryLabel(entry) || (Number.isFinite(rawScore) ? scoreToLabel(clampScore(rawScore)) : '');
    const confidence = Number(entry.confidence);
    if (!VALID_LABELS.has(label) || !Number.isFinite(confidence) || confidence < 0.55) {
      return;
    }

    result.set(id, {
      label,
      score: Number.isFinite(rawScore) ? clampScore(rawScore) : labelToScore(label),
      confidence: Math.max(0, Math.min(1, confidence)),
      source: 'ai',
      reasonCode: 'ai_clickbait_label'
    });
  });

  return result;
}

function summarizeClassifierResult(payload, allowedIds = new Set(), refToArticleId = null) {
  if (!payload || typeof payload !== 'object') {
    return 'invalid_json';
  }

  const entries = getClassifierEntries(payload);
  if (entries.length === 0) {
    return 'missing_clickbait_array';
  }

  const validIdEntries = entries.filter((entry) => resolveClassifierEntryId(entry, allowedIds, refToArticleId));
  if (validIdEntries.length === 0) {
    return `no_matching_article_ids entries=${entries.length}`;
  }

  const labelEntries = validIdEntries.filter((entry) => getClassifierEntryLabel(entry) || Number.isFinite(Number(entry.score ?? entry.clickbaitScore)));
  if (labelEntries.length === 0) {
    return `empty_labels entries=${entries.length} validIds=${validIdEntries.length}`;
  }

  return `unsupported_labels entries=${entries.length} validIds=${validIdEntries.length}`;
}

function summarizeAiError(error) {
  if (isTimeoutError(error)) {
    return 'OpenRouter request timed out; keeping clickbait label deferred';
  }

  return error?.message || 'OpenRouter request failed; keeping clickbait label deferred';
}

async function classifyBatch(batch, config, context = {}) {
  const allowedIds = new Set(batch.map((article) => article.id).filter(Boolean));
  const refToArticleId = new Map(batch.map((article, index) => [String(index + 1), article.id]));
  if (allowedIds.size === 0) {
    return new Map();
  }

  const startedAt = Date.now();
  const openRouter = context.openRouter || await createOpenRouterClient(config);
  const tokenBudget = getCompletionTokenBudget(batch.length);
  const response = await sendJsonChatCompletion(openRouter, {
    model: config.model,
    messages: [
      {
        role: 'system',
        content: 'You are a fast, conservative news clickbait classifier. Return valid JSON only.'
      },
      {
        role: 'user',
        content: buildPrompt(batch)
      }
    ],
    temperature: 0,
    maxTokens: tokenBudget
  }, {
    timeoutMs: config.timeoutMs,
    metrics: {
      feature: 'clickbait_detection',
      articleCount: batch.length,
      batchIndex: context.batchIndex,
      batchCount: context.batchCount,
      maxTokens: tokenBudget
    }
  });

  const content = extractAssistantContent(response);
  const payload = parseJsonContent(content);
  const result = normalizeClassifierResults(payload, allowedIds, refToArticleId);

  if (result.size === 0) {
    logger.warn(`AI clickbait batch produced no valid labels: reason=${summarizeClassifierResult(payload, allowedIds, refToArticleId)}, responseChars=${content.length}, ${summarizeResponseShape(response)}`);
  }

  logger.info(`AI clickbait batch completed: model=${config.model}, articles=${batch.length}, classified=${result.size}, durationMs=${Date.now() - startedAt}`);
  return result;
}

async function classifyClickbaitForArticlesWithStatus(articles = []) {
  const config = getConfig();
  const status = await runBatchedClassifier({
    articles,
    config,
    featureName: 'clickbait',
    splitArticles: splitDeterministicAndAiArticles,
    deterministicResultKey: 'deterministicClassificationsByArticleId',
    classifyBatch,
    summarizeBatchError: summarizeAiError,
    logger
  });

  return {
    classificationsByArticleId: status.resultByArticleId,
    attemptedArticleIds: status.attemptedArticleIds,
    failedArticleIds: status.failedArticleIds,
    cappedArticleIds: status.cappedArticleIds,
    model: config.model
  };
}

function isAiClickbaitDetectionAvailable() {
  return getConfig().enabled;
}

module.exports = {
  classifyClickbaitForArticlesWithStatus,
  isAiClickbaitDetectionAvailable,
  _buildPrompt: buildPrompt,
  _getCompletionTokenBudget: getCompletionTokenBudget,
  _getConfig: getConfig,
  _getDeterministicClickbaitClassification: getDeterministicClickbaitClassification,
  _normalizeClassifierResults: normalizeClassifierResults,
  _normalizeLabel: normalizeLabel,
  _parseJsonContent: parseJsonContent,
  _setOpenRouterSdkLoader: setOpenRouterSdkLoader
};
