const logger = require('../utils/logger');
const topicNormalizer = require('./topicNormalizer');
const { mapSettledWithConcurrency } = require('../utils/concurrency');
const { parseIntegerEnv } = require('../utils/env');
const {
  createOpenRouterClient,
  extractAssistantContent,
  getOpenRouterConfig,
  parseJsonContent,
  setOpenRouterSdkLoader
} = require('./openRouterClient');

const DEFAULT_OPENROUTER_TOPIC_MODEL = 'qwen/qwen3.5-9b';
const DEFAULT_BATCH_SIZE = 4;
const DEFAULT_BATCH_CONCURRENCY = 1;
const DEFAULT_MAX_ARTICLES_PER_REFRESH = 160;
const DEFAULT_TIMEOUT_MS = 30000;
const TOPIC_GUIDANCE = [
  'Politica: government, elections, parties, institutions, protests, policy, public ceremonies.',
  'Economia: markets, business, companies, finance, inflation, jobs, trade.',
  'Tecnologia: digital technology only, AI, software, hardware, cybersecurity, chips, startups. Do not use for generic physical objects or air/compressed-air weapons.',
  'Scienza: scientific research, space, labs, discoveries, biology, physics.',
  'Ambiente: climate, pollution, energy transition, weather impacts, environment.',
  'Sport: sports events, teams, athletes, competitions.',
  'Cultura: books, art, museums, theatre, literature.',
  'Salute: medicine, healthcare, hospitals, public health, diseases.',
  'Esteri: foreign affairs, international conflicts, diplomacy, events outside Italy.',
  'Cronaca: incidents, crime, accidents, injuries, police, courts, public order. This is not limited to local news.',
  'Spettacolo: cinema, TV, music, celebrities, entertainment.'
];

function isAiArticleDebugLoggingEnabled() {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env.AI_TOPIC_DEBUG_LOG_ARTICLES || '').trim().toLowerCase());
}

function summarizeArticleForDebug(article = {}) {
  return `${String(article.id || '').trim() || 'unknown'}:${truncateText(article.title || '', 120) || '(untitled)'}`;
}

function logBatchArticlesForDebug(batch = [], config = {}, batchIndex = 0, batchCount = 0) {
  if (!isAiArticleDebugLoggingEnabled() || batch.length === 0) {
    return;
  }

  logger.info(`AI topic batch articles (dev): model=${config.model}, batch=${batchIndex + 1}/${batchCount || 1}, items=${batch.map((article) => summarizeArticleForDebug(article)).join(' | ')}`);
}

function logBatchClassificationsForDebug(result = new Map(), articlesById = new Map(), config = {}) {
  if (!isAiArticleDebugLoggingEnabled() || result.size === 0) {
    return;
  }

  const summary = [...result.entries()].map(([articleId, topics]) => {
    const article = articlesById.get(articleId) || {};
    const topicLabels = Array.isArray(topics) ? topics.map((entry) => entry?.topic).filter(Boolean).join(',') : '';
    return `${summarizeArticleForDebug({ id: articleId, title: article.title })}->${topicLabels || 'none'}`;
  }).join(' | ');

  logger.info(`AI topic batch classifications (dev): model=${config.model}, items=${summary}`);
}

function getConfig() {
  const openRouterConfig = getOpenRouterConfig({
    enabledEnvName: 'AI_TOPIC_DETECTION_ENABLED',
    modelEnvName: 'OPENROUTER_TOPIC_MODEL',
    defaultModel: DEFAULT_OPENROUTER_TOPIC_MODEL,
    timeoutEnvName: 'AI_TOPIC_REQUEST_TIMEOUT_MS',
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
    clampTimeout: true
  });

  return {
    ...openRouterConfig,
    batchSize: parseIntegerEnv('AI_TOPIC_BATCH_SIZE', DEFAULT_BATCH_SIZE, { min: 1, max: 50, clamp: true, strict: true }),
    batchConcurrency: parseIntegerEnv('AI_TOPIC_BATCH_CONCURRENCY', DEFAULT_BATCH_CONCURRENCY, { min: 1, max: 4, clamp: true, strict: true }),
    maxArticlesPerRefresh: parseIntegerEnv('AI_TOPIC_MAX_ARTICLES_PER_REFRESH', DEFAULT_MAX_ARTICLES_PER_REFRESH, { min: 1, max: 1000, clamp: true, strict: true })
  };
}

function chunkItems(items = [], size = DEFAULT_BATCH_SIZE) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function isTimeoutError(error) {
  const name = String(error?.name || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return name.includes('timeout') || message.includes('aborted due to timeout') || message.includes('timeout');
}

function summarizeAiError(error) {
  if (isTimeoutError(error)) {
    return 'OpenRouter request timed out; keeping local fallback topics';
  }

  return error?.message || 'OpenRouter request failed; keeping local fallback topics';
}

function truncateText(value, maxLength) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3).trim()}...`;
}

function buildArticlePayload(article = {}, index = 0) {
  return {
    ref: index + 1,
    title: truncateText(article.title || '', 220),
    description: truncateText(article.description || '', 420)
  };
}

function buildPrompt(batch = []) {
  return [
    'Classify each news item into one to three canonical topics when the title or description is enough to decide.',
    `Allowed topics: ${topicNormalizer.CANONICAL_TOPICS.join(', ')}.`,
    `Topic meanings: ${TOPIC_GUIDANCE.join(' ')}`,
    'Use the exact allowed Italian topic labels only.',
    'Use only the title and short description. Do not use provider RSS categories and do not infer from missing full article content.',
    'Return minified JSON only. Do not use markdown fences, prose, or trailing explanations.',
    'If people are wounded, attacked, arrested, shot, or involved in a police/court incident, prefer Cronaca. If the same event is a demonstration or public ceremony, also consider Politica.',
    'Example: "A Roma due persone che partecipavano al corteo per il 25 aprile sono state ferite da colpi di pistola ad aria compressa" -> ["Cronaca", "Politica"], not Tecnologia.',
    'Each provided item has a numeric ref. Return refs, not article ids.',
    'Return strict JSON only with this shape: {"topicsByRef":[{"ref":1,"topics":[{"topic":"Topic","confidence":0.82}]}]}',
    'Confidence must be between 0 and 1.',
    'Return objects only for refs with one to three topics. If truly impossible to classify an item, omit that ref.',
    '',
    JSON.stringify({ articles: batch.map(buildArticlePayload) })
  ].join('\n');
}

function getCompletionTokenBudget(batchLength) {
  return Math.min(2000, 320 + (Math.max(1, batchLength) * 120));
}

function getClassifierEntries(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  return [
    payload?.topicsByRef,
    payload?.topicsById,
    payload?.results,
    payload?.classifications,
    payload?.articles,
    payload?.items
  ].find(Array.isArray) || [];
}

function getClassifierEntryId(entry = {}) {
  return String(entry.id || entry.articleId || entry.article_id || '').trim();
}

function getClassifierEntryRef(entry = {}) {
  const rawRef = entry.ref ?? entry.articleRef ?? entry.article_ref ?? entry.index;
  return String(rawRef || '').trim();
}

function resolveClassifierEntryId(entry = {}, allowedIds = new Set(), refToArticleId = null) {
  const id = getClassifierEntryId(entry);
  if (id && allowedIds.has(id)) {
    return id;
  }

  const ref = getClassifierEntryRef(entry);
  const mappedId = refToArticleId?.get(ref);
  return mappedId && allowedIds.has(mappedId) ? mappedId : '';
}

function getClassifierEntryTopics(entry = {}) {
  if (Array.isArray(entry.topics)) {
    return entry.topics;
  }

  if (Array.isArray(entry.categories)) {
    return entry.categories;
  }

  if (entry.topic) {
    return [entry.topic];
  }

  if (entry.category) {
    return [entry.category];
  }

  return [];
}

function getArticleEvidenceText(article = {}) {
  return topicNormalizer.cleanTopicValue([
    article.title,
    article.description
  ].filter(Boolean).join(' '));
}

function getTopicCandidateDetails(entry = {}) {
  const entryEvidence = Array.isArray(entry.evidence) ? entry.evidence : [];
  const entryConfidence = Number(entry.confidence);
  const topics = getClassifierEntryTopics(entry);

  return topics.map((topicEntry) => {
    if (topicEntry && typeof topicEntry === 'object') {
      return {
        topic: topicEntry.topic || topicEntry.name || topicEntry.category,
        confidence: Number(topicEntry.confidence),
        evidence: Array.isArray(topicEntry.evidence) ? topicEntry.evidence : entryEvidence
      };
    }

    return {
      topic: topicEntry,
      confidence: Number.isFinite(entryConfidence) ? entryConfidence : 1,
      evidence: entryEvidence
    };
  });
}

function evidenceMatchesArticle(evidence = [], article = null) {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    return true;
  }

  if (!article) {
    return true;
  }

  const articleText = getArticleEvidenceText(article);
  return evidence.some((phrase) => {
    const cleanedPhrase = topicNormalizer.cleanTopicValue(phrase);
    return cleanedPhrase.length >= 2 && articleText.includes(cleanedPhrase);
  });
}

function summarizeClassifierResult(payload, allowedIds = new Set(), refToArticleId = null) {
  if (!payload || typeof payload !== 'object') {
    return 'invalid_json';
  }

  const entries = getClassifierEntries(payload);
  if (entries.length === 0) {
    return 'missing_topics_array';
  }

  const validIdEntries = entries.filter((entry) => resolveClassifierEntryId(entry, allowedIds, refToArticleId));
  if (validIdEntries.length === 0) {
    return `no_matching_article_ids entries=${entries.length}`;
  }

  const topicEntries = validIdEntries.filter((entry) => getClassifierEntryTopics(entry).length > 0);
  if (topicEntries.length === 0) {
    return `empty_topics entries=${entries.length} validIds=${validIdEntries.length}`;
  }

  return `unsupported_topics entries=${entries.length} validIds=${validIdEntries.length}`;
}

function normalizeClassifierDetails(payload, allowedIds = new Set(), articlesById = null, refToArticleId = null) {
  const entries = getClassifierEntries(payload);
  const result = new Map();

  entries.forEach((entry) => {
    const id = resolveClassifierEntryId(entry, allowedIds, refToArticleId);
    if (!id) {
      return;
    }

    const article = articlesById?.get(id) || null;
    const details = getTopicCandidateDetails(entry)
      .map((candidate) => ({
        topic: topicNormalizer.normalizeTopic(candidate.topic),
        confidence: Number.isFinite(candidate.confidence) ? candidate.confidence : 0,
        evidence: Array.isArray(candidate.evidence) ? candidate.evidence.map((value) => String(value || '').trim()).filter(Boolean) : []
      }))
      .filter((candidate) => candidate.topic && candidate.confidence >= 0.65)
      .filter((candidate) => !article || evidenceMatchesArticle(candidate.evidence, article))
      .slice(0, 3)
      .map((candidate) => ({
        ...candidate,
        source: 'ai',
        reasonCode: 'ai_confident_evidence'
      }));

    if (details.length > 0) {
      result.set(id, details);
    }
  });

  return result;
}

function summarizeResponseShape(response = {}) {
  const choice = response.choices?.[0] || {};
  const message = choice.message || {};
  const messageKeys = Object.keys(message).sort().join(',') || 'none';
  const contentType = Array.isArray(message.content) ? 'array' : typeof message.content;
  const finishReason = choice.finishReason || choice.finish_reason || 'unknown';
  const reasoningChars = String(message.reasoning || '').length;
  const refusalChars = String(message.refusal || '').length;

  return `finishReason=${finishReason}, messageKeys=${messageKeys}, contentType=${contentType}, reasoningChars=${reasoningChars}, refusalChars=${refusalChars}`;
}

async function classifyBatch(batch, config, context = {}) {
  const allowedIds = new Set(batch.map((article) => article.id).filter(Boolean));
  const articlesById = new Map(batch.map((article) => [article.id, article]));
  const refToArticleId = new Map(batch.map((article, index) => [String(index + 1), article.id]));
  if (allowedIds.size === 0) {
    return new Map();
  }

  const startedAt = Date.now();
  logBatchArticlesForDebug(batch, config, context.batchIndex || 0, context.batchCount || 0);
  const openRouter = context.openRouter || await createOpenRouterClient(config);
  const completionPromise = openRouter.chat.send({
    chatRequest: {
      model: config.model,
      messages: [
        {
          role: 'system',
          content: 'You are a fast, conservative news taxonomy classifier. Return valid JSON only.'
        },
        {
          role: 'user',
          content: buildPrompt(batch)
        }
      ],
      temperature: 0,
      maxTokens: getCompletionTokenBudget(batch.length),
      maxCompletionTokens: getCompletionTokenBudget(batch.length),
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

  // The SDK's APIPromise owns a secondary unwrapped promise; attach a catch so
  // expected request failures do not also surface as global unhandled rejections.
  if (completionPromise && typeof completionPromise.catch === 'function') {
    completionPromise.catch(() => {});
  }

  const response = await completionPromise;

  const content = extractAssistantContent(response);
  const payload = parseJsonContent(content);
  const result = normalizeClassifierDetails(payload, allowedIds, articlesById, refToArticleId);

  if (result.size === 0) {
    logger.warn(`AI topic batch produced no valid topics: reason=${summarizeClassifierResult(payload, allowedIds, refToArticleId)}, responseChars=${content.length}, ${summarizeResponseShape(response)}`);
  }

  logBatchClassificationsForDebug(result, articlesById, config);
  logger.info(`AI topic batch completed: model=${config.model}, articles=${batch.length}, classified=${result.size}, durationMs=${Date.now() - startedAt}`);
  return result;
}

async function classifyTopicDetailsForArticlesWithStatus(articles = []) {
  const config = getConfig();
  if (!Array.isArray(articles) || articles.length === 0) {
    return {
      topicsByArticleId: new Map(),
      attemptedArticleIds: [],
      failedArticleIds: [],
      cappedArticleIds: []
    };
  }

  if (!config.enabled) {
    logger.info(`AI topic detection skipped: reason=${config.apiKey ? 'disabled' : 'missing_api_key'}, articles=${articles.length}`);
    return {
      topicsByArticleId: new Map(),
      attemptedArticleIds: [],
      failedArticleIds: [],
      cappedArticleIds: articles.map((article) => article?.id).filter(Boolean)
    };
  }

  const startedAt = Date.now();
  const limitedArticles = articles.slice(0, config.maxArticlesPerRefresh);
  const cappedArticleIds = articles.slice(config.maxArticlesPerRefresh).map((article) => article?.id).filter(Boolean);
  if (articles.length > limitedArticles.length) {
    logger.warn(`AI topic detection capped at ${limitedArticles.length}/${articles.length} new articles for this refresh`);
  }

  const batches = chunkItems(limitedArticles, config.batchSize);
  const openRouter = await createOpenRouterClient(config);
  logger.info(`AI topic detection started: model=${config.model}, articles=${limitedArticles.length}, batches=${batches.length}`);
  const batchResults = await mapSettledWithConcurrency(batches, config.batchConcurrency, (batch, batchIndex) => classifyBatch(batch, config, {
    batchIndex,
    batchCount: batches.length,
    openRouter
  }));
  const result = new Map();
  const failedArticleIds = [];

  batchResults.forEach((batchResult, index) => {
    if (batchResult?.status === 'rejected') {
      logger.warn(`AI topic batch failed: ${summarizeAiError(batchResult.reason)}`);
      failedArticleIds.push(...batches[index].map((article) => article?.id).filter(Boolean));
      return;
    }

    batchResult.value.forEach((topics, articleId) => {
      result.set(articleId, topics);
    });
  });

  logger.info(`AI topic detection completed: model=${config.model}, requested=${limitedArticles.length}, classified=${result.size}, durationMs=${Date.now() - startedAt}`);
  return {
    topicsByArticleId: result,
    attemptedArticleIds: limitedArticles.map((article) => article?.id).filter(Boolean),
    failedArticleIds,
    cappedArticleIds
  };
}

function isAiTopicDetectionAvailable() {
  return getConfig().enabled;
}

module.exports = {
  classifyTopicDetailsForArticlesWithStatus,
  isAiTopicDetectionAvailable,
  _buildPrompt: buildPrompt,
  _getConfig: getConfig,
  _getCompletionTokenBudget: getCompletionTokenBudget,
  _extractAssistantContent: extractAssistantContent,
  _normalizeClassifierDetails: normalizeClassifierDetails,
  _parseJsonContent: parseJsonContent,
  _setOpenRouterSdkLoader: setOpenRouterSdkLoader
};
