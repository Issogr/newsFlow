const crypto = require('crypto');
const logger = require('../utils/logger');
const { parseIntegerEnv } = require('../utils/env');

const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_OPENROUTER_SUMMARY_MODEL = 'deepseek/deepseek-v4-flash';
const DEFAULT_TIMEOUT_MS = 120000;
const MIN_MATCH_CONFIDENCE = 0.82;
const STORY_GROUP_TOKEN_STOP_WORDS = new Set([
  'a', 'ad', 'al', 'alla', 'and', 'con', 'da', 'dal', 'dalla', 'de', 'del', 'della', 'di', 'e', 'for', 'from', 'gli', 'il', 'in', 'la', 'le', 'lo', 'of', 'on', 'per', 'the', 'to', 'un', 'una', 'with'
]);

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
  const enabledValue = String(process.env.AI_STORY_GROUPING_ENABLED || 'auto').trim().toLowerCase();

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

function tokenizeStoryText(article = {}) {
  return new Set(`${article.title || ''} ${article.description || ''}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-z0-9\s]/gu, ' ')
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !STORY_GROUP_TOKEN_STOP_WORDS.has(token)));
}

function getTokenOverlapScore(left = {}, right = {}) {
  const leftTokens = tokenizeStoryText(left);
  const rightTokens = tokenizeStoryText(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  });

  return overlap / Math.min(leftTokens.size, rightTokens.size);
}

function hasTopicOverlap(left = {}, right = {}) {
  const leftTopics = new Set((left.topics || []).map((topic) => String(topic || '').toLowerCase()).filter(Boolean));
  if (leftTopics.size === 0) {
    return false;
  }

  return (right.topics || []).some((topic) => leftTopics.has(String(topic || '').toLowerCase()));
}

function filterCandidateArticles(target = {}, candidates = []) {
  return (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => candidate?.id && candidate.id !== target?.id)
    .map((candidate) => ({
      candidate,
      overlapScore: getTokenOverlapScore(target, candidate),
      topicOverlap: hasTopicOverlap(target, candidate)
    }))
    .filter(({ overlapScore, topicOverlap }) => overlapScore >= 0.18 || topicOverlap)
    .sort((left, right) => right.overlapScore - left.overlapScore)
    .slice(0, 8)
    .map(({ candidate }) => candidate);
}

function buildArticlePayload(article = {}) {
  return {
    id: String(article.id || '').slice(0, 160),
    title: truncateText(article.title || '', 220),
    description: truncateText(article.description || article.content || '', 520),
    source: truncateText(article.source || article.rawSource || '', 120),
    publishedAt: article.pubDate || '',
    topics: (article.topics || []).slice(0, 4),
    url: truncateText(article.url || '', 320)
  };
}

function buildPrompt(target = {}, candidates = []) {
  return [
    'Decide which candidate articles describe the same specific real-world news event as the target article.',
    'Use only the provided RSS metadata. Do not use outside knowledge.',
    'Same broad topic is not enough. Match only if the articles report the same event, statement, match, incident, decision, meeting, or release.',
    'Different developments in the same larger story must not be matched.',
    'Return minified JSON only. Do not use markdown fences or prose outside JSON.',
    'Return this exact shape: {"matches":[{"id":"candidate-id","confidence":0.0,"reason":"short reason"}]}',
    'Only include matches with confidence >= 0.82.',
    '',
    JSON.stringify({
      target: buildArticlePayload(target),
      candidates: candidates.map(buildArticlePayload)
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

function normalizeMatches(payload = {}, candidateIds = new Set()) {
  const matches = Array.isArray(payload?.matches) ? payload.matches : [];
  return matches
    .map((match) => ({
      articleId: String(match?.id || '').trim(),
      confidence: Number(match?.confidence),
      reason: truncateText(match?.reason || '', 200)
    }))
    .filter((match) => candidateIds.has(match.articleId) && Number.isFinite(match.confidence) && match.confidence >= MIN_MATCH_CONFIDENCE)
    .sort((left, right) => right.confidence - left.confidence);
}

function buildStoryGroupId(articleIds = []) {
  const stableIds = [...new Set(articleIds.filter(Boolean))].sort();
  if (stableIds.length === 0) {
    return '';
  }

  return `ai-story-${crypto.createHash('sha1').update(stableIds.join('|')).digest('hex').slice(0, 16)}`;
}

async function findSimilarStoriesForArticle(target = {}, candidates = []) {
  const config = getConfig();
  const filteredCandidates = filterCandidateArticles(target, candidates);
  if (!target?.id || filteredCandidates.length === 0) {
    return { matches: [], model: config.model, skipped: 'no_candidates' };
  }

  if (!config.enabled) {
    logger.info(`AI story grouping skipped: reason=${config.apiKey ? 'disabled' : 'missing_api_key'}`);
    return { matches: [], model: config.model, skipped: 'disabled' };
  }

  const startedAt = Date.now();
  const openRouter = await createOpenRouterClient(config);
  const completionPromise = openRouter.chat.send({
    chatRequest: {
      model: config.model,
      messages: [
        {
          role: 'system',
          content: 'You classify whether news articles describe the same specific story. Return valid JSON only.'
        },
        {
          role: 'user',
          content: buildPrompt(target, filteredCandidates)
        }
      ],
      temperature: 0,
      maxTokens: 900,
      maxCompletionTokens: 900,
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
  if (!payload) {
    throw new Error('AI story grouping response did not contain valid JSON');
  }

  const matches = normalizeMatches(payload, new Set(filteredCandidates.map((candidate) => candidate.id)));
  logger.info(`AI story grouping completed: article=${target.id}, candidates=${filteredCandidates.length}, matches=${matches.length}, model=${config.model}, durationMs=${Date.now() - startedAt}`);
  return {
    matches,
    model: config.model,
    candidates: filteredCandidates
  };
}

function isAiStoryGroupingAvailable() {
  return getConfig().enabled;
}

module.exports = {
  findSimilarStoriesForArticle,
  isAiStoryGroupingAvailable,
  buildStoryGroupId,
  filterCandidateArticles,
  _buildPrompt: buildPrompt,
  _getConfig: getConfig,
  _parseJsonContent: parseJsonContent,
  _setOpenRouterSdkLoader: setOpenRouterSdkLoader
};
