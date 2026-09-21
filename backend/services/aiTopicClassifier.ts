import logger from '../utils/logger';
import concurrency from '../utils/concurrency';
import aiFeatures from '../config/aiFeatures';
import topicNormalizer from './topicNormalizer';
import classifierUtils from './aiClassifierUtils';
import openRouterClient from './openRouterClient';
import aiArticlePayload from './aiArticlePayload';
const { mapSettledWithConcurrency } = concurrency;
const { isAiToggleEnabled } = aiFeatures;
const {
  extractAssistantContent,
  getOpenRouterConfig,
  parseJsonContent,
  sendJsonChatCompletion
} = openRouterClient;
const { truncateText } = aiArticlePayload;
const {
  getClassifierBatchConfig,
  getClassifierEntries,
  isTimeoutError,
  resolveClassifierEntryId,
  summarizeResponseShape,
} = classifierUtils;
import type { DynamicRecord, NewsArticle } from '../utils/types';

const DEFAULT_OPENROUTER_TOPIC_MODEL = 'mistralai/mistral-small-24b-instruct-2501';
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

interface ClassifierContext extends DynamicRecord {
  batchCount?: number;
  batchIndex?: number;
}

function isAiArticleDebugLoggingEnabled() {
  return isAiToggleEnabled('AI_TOPIC_DEBUG_LOG_ARTICLES', false);
}

function summarizeArticleForDebug(article: Partial<NewsArticle> = {}) {
  return `${String(article.id || '').trim() || 'unknown'}:${truncateText(article.title || '', 120) || '(untitled)'}`;
}

function logBatchArticlesForDebug(batch: NewsArticle[] = [], config: DynamicRecord = {}, batchIndex = 0, batchCount = 0) {
  if (!isAiArticleDebugLoggingEnabled() || batch.length === 0) {
    return;
  }

  logger.info(`AI topic batch articles (dev): model=${config.model}, batch=${batchIndex + 1}/${batchCount || 1}, items=${batch.map((article) => summarizeArticleForDebug(article)).join(' | ')}`);
}

function logBatchClassificationsForDebug(
  result = new Map<string, DynamicRecord[]>(),
  articlesById = new Map<string, NewsArticle>(),
  config: DynamicRecord = {}
) {
  if (!isAiArticleDebugLoggingEnabled() || result.size === 0) {
    return;
  }

  const summary = [...result.entries()].map(([articleId, topics]) => {
    const article = articlesById.get(articleId);
    const topicLabels = Array.isArray(topics) ? topics.map((entry) => entry?.topic).filter(Boolean).join(',') : '';
    return `${summarizeArticleForDebug({ id: articleId, title: article?.title || '' })}->${topicLabels || 'none'}`;
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
    ...getClassifierBatchConfig()
  };
}

function summarizeAiError(error: unknown) {
  if (isTimeoutError(error)) {
    return 'OpenRouter request timed out; keeping local fallback topics';
  }

  return error instanceof Error ? error.message : 'OpenRouter request failed; keeping local fallback topics';
}

function buildArticlePayload(article: Partial<NewsArticle> = {}, index = 0) {
  return {
    ref: index + 1,
    title: truncateText(article.title || '', 220),
    description: truncateText(article.description || '', 420)
  };
}

function buildPrompt(batch: NewsArticle[] = []) {
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

function getCompletionTokenBudget(batchLength: number) {
  return Math.min(2000, 320 + (Math.max(1, batchLength) * 120));
}

function getDeterministicTopicDetails(article: Partial<NewsArticle> = {}) {
  return topicNormalizer.classifyTopicsFromText(article, { threshold: 6 })
    .filter((entry) => Number(entry.confidence) >= 0.8)
    .slice(0, 3)
    .map((entry) => ({
      topic: entry.topic,
      confidence: entry.confidence,
      evidence: entry.evidence || [],
      source: 'local',
      reasonCode: 'local_high_confidence_skip'
    }));
}

function splitDeterministicAndAiArticles(articles: NewsArticle[] = [], config: DynamicRecord = {}) {
  const deterministicTopicsByArticleId = new Map<string, DynamicRecord[]>();
  const aiArticles: NewsArticle[] = [];

  articles.forEach((article) => {
    const deterministicTopics = config.deterministicSkipEnabled ? getDeterministicTopicDetails(article) : [];
    if (deterministicTopics.length > 0) {
      deterministicTopicsByArticleId.set(article.id, deterministicTopics);
      return;
    }

    aiArticles.push(article);
  });

  return { aiArticles, deterministicTopicsByArticleId };
}

function getClassifierEntryTopics(entry: DynamicRecord = {}): unknown[] {
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

function getArticleEvidenceText(article: Partial<NewsArticle> = {}) {
  return topicNormalizer.cleanTopicValue([
    article.title,
    article.description
  ].filter(Boolean).join(' '));
}

function getTopicCandidateDetails(entry: DynamicRecord = {}) {
  const entryEvidence = Array.isArray(entry.evidence) ? entry.evidence : [];
  const entryConfidence = Number(entry.confidence);
  const topics = getClassifierEntryTopics(entry);

  return topics.map((topicEntry) => {
    if (topicEntry && typeof topicEntry === 'object') {
      const topic = topicEntry as DynamicRecord;
      return {
        topic: topic.topic || topic.name || topic.category,
        confidence: Number(topic.confidence),
        evidence: Array.isArray(topic.evidence) ? topic.evidence : entryEvidence
      };
    }

    return {
      topic: topicEntry,
      confidence: Number.isFinite(entryConfidence) ? entryConfidence : 1,
      evidence: entryEvidence
    };
  });
}

function evidenceMatchesArticle(evidence: unknown[] = [], article: NewsArticle | null = null) {
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

function summarizeClassifierResult(payload: unknown, allowedIds = new Set<string>(), refToArticleId: Map<string, string> | null = null) {
  if (!payload || typeof payload !== 'object') {
    return 'invalid_json';
  }

  const entries = getClassifierEntries(payload, ['topicsByRef', 'topicsById']);
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

function normalizeClassifierDetails(
  payload: unknown,
  allowedIds = new Set<string>(),
  articlesById: Map<string, NewsArticle> | null = null,
  refToArticleId: Map<string, string> | null = null
) {
  const entries = getClassifierEntries(payload, ['topicsByRef', 'topicsById']);
  const result = new Map<string, DynamicRecord[]>();

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
        evidence: Array.isArray(candidate.evidence) ? candidate.evidence.map((value: unknown) => String(value || '').trim()).filter(Boolean) : []
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

async function classifyBatch(batch: NewsArticle[], config: ReturnType<typeof getConfig>, context: ClassifierContext = {}) {
  const allowedIds = new Set(batch.map((article) => article.id).filter(Boolean));
  const articlesById = new Map(batch.map((article) => [article.id, article]));
  const refToArticleId = new Map(batch.map((article, index) => [String(index + 1), article.id]));
  if (allowedIds.size === 0) {
    return new Map();
  }

  const startedAt = Date.now();
  logBatchArticlesForDebug(batch, config, context.batchIndex || 0, context.batchCount || 0);
  const tokenBudget = getCompletionTokenBudget(batch.length);
  const response = await sendJsonChatCompletion(config, {
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
    max_tokens: tokenBudget
  }, {
    timeoutMs: config.timeoutMs,
    metrics: {
      feature: 'topic_detection',
      articleCount: batch.length,
      batchIndex: context.batchIndex,
      batchCount: context.batchCount,
      maxTokens: tokenBudget
    }
  });

  const content = extractAssistantContent(response);
  const payload = parseJsonContent(content);
  const result = normalizeClassifierDetails(payload, allowedIds, articlesById, refToArticleId);

  if (result.size === 0) {
    logger.warn(`AI topic batch produced no valid topics: reason=${summarizeClassifierResult(payload, allowedIds, refToArticleId)}, responseChars=${content.length}, ${summarizeResponseShape(response, { includeReasoningStats: true })}`);
  }

  logBatchClassificationsForDebug(result, articlesById, config);
  logger.info(`AI topic batch completed: model=${config.model}, articles=${batch.length}, classified=${result.size}, durationMs=${Date.now() - startedAt}`);
  return result;
}

async function classifyTopicDetailsForArticlesWithStatus(articles: NewsArticle[] = []) {
  const config = getConfig();
  const topicsByArticleId = new Map<string, DynamicRecord[]>();
  if (!Array.isArray(articles) || articles.length === 0 || !config.enabled) {
    if (articles?.length && !config.enabled) {
      logger.info(`AI topic detection skipped: reason=${config.apiKey ? 'disabled' : 'missing_api_key'}, articles=${articles.length}`);
    }
    return {
      topicsByArticleId,
      attemptedArticleIds: [],
      failedArticleIds: [],
      cappedArticleIds: Array.isArray(articles) ? articles.map((article) => article?.id).filter(Boolean) : []
    };
  }

  const startedAt = Date.now();
  const limitedArticles = articles.slice(0, config.maxArticlesPerRefresh);
  const cappedArticleIds = articles.slice(config.maxArticlesPerRefresh).map((article) => article?.id).filter(Boolean);
  if (cappedArticleIds.length) {
    logger.warn(`AI topic detection capped at ${limitedArticles.length}/${articles.length} new articles for this refresh`);
  }
  const { aiArticles, deterministicTopicsByArticleId } = splitDeterministicAndAiArticles(limitedArticles, config);
  deterministicTopicsByArticleId.forEach((topics, id) => topicsByArticleId.set(id, topics));
  const batches: NewsArticle[][] = [];
  for (let index = 0; index < aiArticles.length; index += config.batchSize) {
    batches.push(aiArticles.slice(index, index + config.batchSize));
  }
  logger.info(`AI topic detection started: model=${config.model}, articles=${limitedArticles.length}, deterministic=${deterministicTopicsByArticleId.size}, aiArticles=${aiArticles.length}, batches=${batches.length}`);
  const batchResults: PromiseSettledResult<Map<string, DynamicRecord[]>>[] = await mapSettledWithConcurrency(batches, config.batchConcurrency, (batch: NewsArticle[], batchIndex: number) => classifyBatch(batch, config, {
    batchIndex,
    batchCount: batches.length
  }));
  const failedArticleIds: string[] = [];
  batchResults.forEach((result, index) => {
    if (result.status === 'rejected') {
      logger.warn(`AI topic batch failed: ${summarizeAiError(result.reason)}`);
      failedArticleIds.push(...batches[index].map((article) => article.id).filter(Boolean));
    } else {
      result.value.forEach((topics, id) => topicsByArticleId.set(id, topics));
    }
  });
  logger.info(`AI topic detection completed: model=${config.model}, requested=${limitedArticles.length}, deterministic=${deterministicTopicsByArticleId.size}, aiRequested=${aiArticles.length}, classified=${topicsByArticleId.size}, durationMs=${Date.now() - startedAt}`);

  return {
    topicsByArticleId,
    attemptedArticleIds: limitedArticles.map((article) => article.id).filter(Boolean),
    failedArticleIds,
    cappedArticleIds
  };
}

function isAiTopicDetectionAvailable() {
  return getConfig().enabled;
}

export default {
  classifyTopicDetailsForArticlesWithStatus,
  isAiTopicDetectionAvailable,
  _getConfig: getConfig,
  _getCompletionTokenBudget: getCompletionTokenBudget,
  _normalizeClassifierDetails: normalizeClassifierDetails
};
