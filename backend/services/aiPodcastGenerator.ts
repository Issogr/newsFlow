const axios = require('axios');
const logger = require('../utils/logger');
const { parseIntegerEnv } = require('../utils/env');
const { estimateTokenCountFromChars, logAiRequestMetric } = require('../utils/aiMetrics');
const { removePromotionalSentences } = require('../utils/promotionalContent');
const { buildArticlePayload, getArticleTextLimit: getSharedArticleTextLimit, truncateText } = require('./aiArticlePayload');
const {
  assertOpenRouterRequestAllowed,
  clearOpenRouterFailure,
  createOpenRouterClient,
  extractAssistantContent,
  getOpenRouterConfig,
  getRetryAfterMs,
  isTransientOpenRouterError,
  parseJsonContent,
  recordOpenRouterFailure,
  sendJsonChatCompletion
} = require('./openRouterClient');
import type { AppError, DynamicRecord, NewsArticle } from '../utils/types';

interface PcmFormat {
  audioFormat: number;
  bitsPerSample: number;
  channels: number;
  sampleRate: number;
}

interface PcmAudio extends PcmFormat {
  pcmBuffer: Buffer;
}

interface ProviderConfig extends DynamicRecord {
  apiKey: string;
  baseUrl: string;
  enabled: boolean;
  model: string;
  timeoutMs: number;
}

interface TtsRequestOptions extends DynamicRecord {
  audioFormat: string;
  config: ProviderConfig;
  deadline: number;
  fallbackMimeType: string;
  locale?: string;
  ttsVoice: string;
}

interface AudioResponse {
  audioBuffer: Buffer;
  mimeType: string;
}

interface TtsErrorOptions {
  cause?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  statusCode?: number;
}

interface PodcastPayload extends DynamicRecord {
  scriptTextByLocale?: Record<string, string>;
}

const DEFAULT_PODCAST_SCRIPT_MODEL = 'qwen/qwen3.7-flash';
const DEFAULT_PODCAST_AUDIO_MODEL = 'google/gemini-3.1-flash-tts-preview';
const DEFAULT_TTS_VOICE = 'Charon';
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_TTS_TIMEOUT_MS = 120000;
const DEFAULT_PROMPT_TEXT_BUDGET_CHARS = 42000;
const DEFAULT_GEMINI_TTS_MAX_INPUT_BYTES = 3800;
const DEFAULT_TTS_MAX_INPUT_BYTES = 6000;
const DEFAULT_TTS_MIN_AUDIO_BYTES = 1024;
const DEFAULT_TTS_MAX_AUDIO_BYTES = 24 * 1024 * 1024;
const DEFAULT_GEMINI_TTS_CHUNK_MAX_BYTES = 700;
const DEFAULT_TTS_MAX_CHUNKS = 12;
const DEFAULT_TTS_CHUNK_SILENCE_MS = 60;
const DEFAULT_TTS_CHUNK_EDGE_SILENCE_MS = 35;
const DEFAULT_TTS_CHUNK_MAX_RETRIES = 2;
const DEFAULT_TTS_CHUNK_RETRY_DELAY_MS = 500;
const DEFAULT_TTS_TOTAL_TIMEOUT_MS = 10 * 60 * 1000;
const PCM_SILENCE_THRESHOLD = 64;
const MIN_PODCAST_SCRIPT_CHARS = 120;
const GEMINI_TTS_PCM_SAMPLE_RATE_HZ = 24000;
const GEMINI_TTS_PCM_CHANNELS = 1;
const GEMINI_TTS_PCM_BITS_PER_SAMPLE = 16;
const DEFAULT_PODCAST_LANGUAGES = ['en'];
const PODCAST_LANGUAGE_CONFIGS: Record<string, { label: string; titleFallback: string; scriptDescription: string }> = {
  en: {
    label: 'English',
    titleFallback: 'News briefing',
    scriptDescription: 'speakable English script'
  },
  it: {
    label: 'Italian',
    titleFallback: 'Briefing notizie',
    scriptDescription: 'testo podcast parlato in italiano'
  }
};

let audioSpeechHttpClient = axios;

function setAudioSpeechHttpClient(client: DynamicRecord) {
  audioSpeechHttpClient = client || axios;
}

function getScriptConfig(): ProviderConfig {
  return getOpenRouterConfig({
    enabledEnvName: 'AI_PODCAST_GENERATION_ENABLED',
    modelEnvName: 'OPENROUTER_PODCAST_SCRIPT_MODEL',
    defaultModel: DEFAULT_PODCAST_SCRIPT_MODEL,
    timeoutEnvName: 'AI_SUMMARY_REQUEST_TIMEOUT_MS',
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS
  });
}

function getTtsConfig(): ProviderConfig {
  return getOpenRouterConfig({
    enabledEnvName: 'AI_PODCAST_GENERATION_ENABLED',
    modelEnvName: 'OPENROUTER_PODCAST_AUDIO_MODEL',
    defaultModel: DEFAULT_PODCAST_AUDIO_MODEL,
    timeoutEnvName: 'AI_PODCAST_TTS_TIMEOUT_MS',
    defaultTimeoutMs: DEFAULT_TTS_TIMEOUT_MS
  });
}

function getArticleTextLimit(articleCount: number) {
  return getSharedArticleTextLimit(articleCount, {
    envName: 'AI_PODCAST_PROMPT_TEXT_BUDGET_CHARS',
    defaultBudgetChars: DEFAULT_PROMPT_TEXT_BUDGET_CHARS
  });
}

function normalizePodcastLocale(locale: unknown = '') {
  return String(locale || '').trim().toLowerCase().replace(/_/gu, '-');
}

function getEnabledPodcastLocales() {
  const configuredLocales = String(process.env.AI_PODCAST_LANGUAGES || '')
    .split(',')
    .map(normalizePodcastLocale)
    .filter((locale) => PODCAST_LANGUAGE_CONFIGS[locale]);
  const locales = configuredLocales.length > 0 ? configuredLocales : DEFAULT_PODCAST_LANGUAGES;

  return [...new Set(locales)];
}

function getLocaleConfig(locale = 'en') {
  return PODCAST_LANGUAGE_CONFIGS[normalizePodcastLocale(locale)] || PODCAST_LANGUAGE_CONFIGS.en;
}

function getPodcastLanguageLabel(locale = 'en') {
  const normalizedLocale = normalizePodcastLocale(locale) || 'en';
  if (PODCAST_LANGUAGE_CONFIGS[normalizedLocale]) {
    return PODCAST_LANGUAGE_CONFIGS[normalizedLocale].label;
  }

  try {
    const displayName = new Intl.DisplayNames(['en'], { type: 'language' }).of(normalizedLocale);
    if (displayName) {
      return displayName;
    }
  } catch {
    // Fall through to the normalized locale code.
  }

  return normalizedLocale;
}

function getPodcastLanguageLabels(locales: string[] = getEnabledPodcastLocales()) {
  return locales.map(getPodcastLanguageLabel);
}

function getTtsMaxInputBytes(model = '') {
  const defaultLimit = isGeminiTtsModel(model) ? DEFAULT_GEMINI_TTS_MAX_INPUT_BYTES : DEFAULT_TTS_MAX_INPUT_BYTES;
  return parseIntegerEnv('AI_PODCAST_TTS_MAX_INPUT_BYTES', defaultLimit, { min: 500, max: 16000 });
}

function getTtsMinAudioBytes() {
  return parseIntegerEnv('AI_PODCAST_TTS_MIN_AUDIO_BYTES', DEFAULT_TTS_MIN_AUDIO_BYTES, { min: 44, max: 100000 });
}

function getTtsMaxAudioBytes() {
  return parseIntegerEnv('AI_PODCAST_TTS_MAX_AUDIO_BYTES', DEFAULT_TTS_MAX_AUDIO_BYTES, { min: 1024, max: 100 * 1024 * 1024 });
}

function getTtsChunkMaxBytes(model = '') {
  const maxInputBytes = getTtsMaxInputBytes(model);
  const defaultLimit = isGeminiTtsModel(model) ? Math.min(DEFAULT_GEMINI_TTS_CHUNK_MAX_BYTES, maxInputBytes) : maxInputBytes;
  return parseIntegerEnv('AI_PODCAST_TTS_CHUNK_MAX_BYTES', defaultLimit, { min: 300, max: maxInputBytes });
}

function getTtsMaxChunks() {
  return parseIntegerEnv('AI_PODCAST_TTS_MAX_CHUNKS', DEFAULT_TTS_MAX_CHUNKS, { min: 1, max: 30 });
}

function getTtsChunkSilenceMs() {
  return parseIntegerEnv('AI_PODCAST_TTS_CHUNK_SILENCE_MS', DEFAULT_TTS_CHUNK_SILENCE_MS, { min: 0, max: 500 });
}

function getTtsChunkMaxRetries() {
  return parseIntegerEnv('AI_PODCAST_TTS_CHUNK_MAX_RETRIES', DEFAULT_TTS_CHUNK_MAX_RETRIES, { min: 0, max: 5 });
}

function getTtsChunkRetryDelayMs() {
  return parseIntegerEnv('AI_PODCAST_TTS_CHUNK_RETRY_DELAY_MS', DEFAULT_TTS_CHUNK_RETRY_DELAY_MS, { min: 0, max: 30000 });
}

function getTtsTotalTimeoutMs() {
  return parseIntegerEnv('AI_PODCAST_TTS_TOTAL_TIMEOUT_MS', DEFAULT_TTS_TOTAL_TIMEOUT_MS, { min: 1000, max: 30 * 60 * 1000 });
}

function getNarrationInstructions(locale = 'en') {
  const languageLabel = getPodcastLanguageLabel(locale);
  return `Generate ${languageLabel} single-narrator daily news podcast audio, matching the language of the provided script, with a warm, intelligent, conversational delivery. Keep a measured pace, clear pronunciation, natural emphasis, and short pauses between paragraphs. Do not sound like a bulletin, a press release, or an advertisement. Do not add music, sound effects, extra words, or translation.`;
}

function buildPrompt(window: DynamicRecord = {}, articles: NewsArticle[] = [], options: { locales?: string[] } = {}) {
  const articleTextLimit = getArticleTextLimit(articles.length);
  const ttsInputTarget = Math.floor(getTtsMaxInputBytes(getTtsConfig().model) * 0.85);
  const enabledLocales = Array.isArray(options.locales) && options.locales.length > 0 ? options.locales : getEnabledPodcastLocales();
  const languageLabels = getPodcastLanguageLabels(enabledLocales);
  const responseShape = Object.fromEntries(enabledLocales.map((locale) => [
    locale,
    {
      title: getLocaleConfig(locale).titleFallback,
      script: getLocaleConfig(locale).scriptDescription
    }
  ]));

  return [
    'Act as the writer, editor, and producer for a daily news podcast with one narrator.',
    'Write a single guided podcast episode using only the provided articles; do not produce a flat bulletin or a list.',
    'Make editorial choices: prioritize the most important, useful, interesting, or meaningful stories for listeners. If there are too many items, group related stories, summarize minor ones briefly, or leave out low-value items.',
    'For each major story, use a natural narrative arc: opening hook, essential context, main fact, why it matters, what could happen next, and a clear closing thought or question.',
    'If multiple input articles describe the same event or facts, combine them into one segment and do not mention the same news twice.',
    'Alternate heavier stories with lighter, practical, or human stories when the source material allows it.',
    'Connect sections with smooth transitions that fit the target language. Avoid abrupt jumps between unrelated topics.',
    'Use occasional spoken signposts when useful, such as the equivalent of "The point is", "Why it matters", "The detail to watch", "What happens next", or "The story behind the headline". Weave them into the narration; do not format them as lists or headings.',
    'Explain technical or complex stories through concrete consequences and clear examples without oversimplifying the facts.',
    'Be non-partisan but editorially useful: help listeners understand what matters, what is noise, and what may have consequences in the coming days.',
    'Skip promotional shopping deals, coupon or affiliate sale posts, and product price-drop blurbs; do not read them as news.',
    'The schedule window is coverage metadata only. Do not name the title or opening after a time of day such as morning, noon, midday, afternoon, evening, night, mattina, mezzogiorno, pomeriggio, or sera.',
    'Use a short recognizable opening, introduce the main themes, develop the news in narrative blocks, and close with what to keep an eye on.',
    'Write in elegant, accessible spoken language. Prefer short sentences, natural pauses, and clear conversational formulations. Avoid bureaucratic, academic, stiff, or overly formal language.',
    'Use short paragraphs separated by blank lines. Start a new paragraph after the opening, when changing story or subject, and before the closing.',
    'Do not invent facts, do not use outside knowledge, and do not add bracket citations because the script may be converted to speech.',
    'Mention source names naturally only when useful. Avoid bullet lists, markdown, stage directions, timestamps, and sound effects.',
    `Keep each localized script under ${ttsInputTarget} UTF-8 bytes; concise scripts are more reliable for text-to-speech conversion.`,
    `Generate only the enabled ${enabledLocales.length === 1 ? 'language' : 'languages'}: ${languageLabels.join(', ')}. Do not include disabled languages.`,
    'Return minified JSON only. Do not use markdown fences or prose outside JSON.',
    `Return this exact shape: ${JSON.stringify(responseShape)}.`,
    '',
    JSON.stringify({
      periodStart: window.periodStart,
      periodEnd: window.periodEnd,
      articles: articles.map((article, index) => buildArticlePayload(article, index, { articleTextLimit }))
    })
  ].join('\n');
}

function containsTimeOfDayLabel(value = '', locale = 'en') {
  const normalized = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const pattern = locale === 'it'
    ? /\b(mattina|mattino|mattutino|mezzogiorno|pranzo|pomeriggio|pomeridiano|sera|serale|notte|notturno)\b/u
    : /\b(morning|midday|noon|afternoon|evening|night|tonight|lunchtime)\b/u;
  return pattern.test(normalized);
}

function sanitizePodcastTitle(title = '', locale = 'en', fallbackTitle = '') {
  const fallback = fallbackTitle || (locale === 'it' ? 'Briefing notizie' : 'News briefing');
  const normalizedTitle = truncateText(title || fallback, 180);
  return containsTimeOfDayLabel(normalizedTitle, locale) ? fallback : normalizedTitle;
}

function sanitizePodcastScript(script = '', locale = 'en') {
  const text = String(script || '').trim();
  if (!text) {
    return '';
  }

  const intro = text.slice(0, 500);
  const rest = text.slice(500);
  const sanitizedIntro = locale === 'it'
    ? intro
      .replace(/\b(aggiornamento|notiziario|briefing)\s+(?:di|del|della|da)\s+(?:mezzogiorno|mattina|mattino|pomeriggio|sera|notte)\b/giu, '$1 delle notizie')
      .replace(/\b(aggiornamento|notiziario|briefing)\s+(?:mattutino|pomeridiano|serale|notturno)\b/giu, '$1 delle notizie')
    : intro
      .replace(/\b(?:morning|midday|noon|afternoon|evening|night|tonight)\s+(news\s+)?(briefing|update|podcast|roundup)\b/giu, 'news $2')
      .replace(/\b(news\s+)?(briefing|update|podcast|roundup)\s+(?:for|at|around|of)\s+(?:the\s+)?(?:morning|midday|noon|afternoon|evening|night)\b/giu, 'news $2');

  return removePromotionalSentences(`${sanitizedIntro}${rest}`.trim());
}

function getCompletionTokenBudget(articleCount: number) {
  return Math.min(7000, 1200 + (Math.max(1, articleCount) * 90));
}

function normalizeLocalizedPodcast(payload: DynamicRecord = {}, locale: string, fallbackTitle = '') {
  const localizedPayload = payload?.[locale] && typeof payload[locale] === 'object'
    ? payload[locale] as DynamicRecord
    : null;
  if (!localizedPayload) {
    return null;
  }

  const title = sanitizePodcastTitle(String(localizedPayload.title || fallbackTitle), locale, fallbackTitle);
  const script = sanitizePodcastScript(String(localizedPayload.script || localizedPayload.text || ''), locale);

  if (!script) {
    return null;
  }

  return { title, script };
}

function normalizeGeneratedPodcast(payload: unknown, options: { locales?: string[] } = {}) {
  const response = payload && typeof payload === 'object' ? payload as DynamicRecord : {};
  const enabledLocales = Array.isArray(options.locales) && options.locales.length > 0 ? options.locales : getEnabledPodcastLocales();
  const localizedEntries = enabledLocales.map((locale) => {
    const entry = normalizeLocalizedPodcast(response, locale, getLocaleConfig(locale).titleFallback);
    return entry ? { locale, ...entry } : null;
  });

  if (localizedEntries.some((entry) => !entry)) {
    return null;
  }

  const validEntries = localizedEntries.filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const titleByLocale = Object.fromEntries(validEntries.map((entry) => [entry.locale, entry.title]));
  const scriptTextByLocale = Object.fromEntries(validEntries.map((entry) => [entry.locale, entry.script]));
  const primaryEntry = validEntries.find((entry) => entry.locale === 'en') || validEntries[0];

  return {
    title: primaryEntry.title,
    scriptText: primaryEntry.script,
    titleByLocale,
    scriptTextByLocale,
    enabledLocales
  };
}

function createPodcastValidationError(message: string) {
  const error: AppError = new Error(message);
  error.code = 'PODCAST_SCRIPT_VALIDATION_FAILED';
  return error;
}

function getMinScriptLength(articleCount: number) {
  return Math.min(500, MIN_PODCAST_SCRIPT_CHARS + (Math.max(1, Number(articleCount) || 1) * 35));
}

function hasForbiddenPodcastFormatting(script = '') {
  return /(^|\n)\s*(#{1,6}\s|[-*•]\s+|\d+[.)]\s+)/u.test(script)
    || /```|`|\*\*|__/u.test(script)
    || /\[(?:\d+|\d{1,2}:\d{2}|[^\]]*(?:music|sfx|sound|intro|outro|pause|jingle|applause)[^\]]*)\]/iu.test(script)
    || /\([^)]*(?:music|sfx|sound|intro|outro|pause|jingle|applause)[^)]*\)/iu.test(script)
    || /(^|\n)\s*(?:host|speaker|narrator|sfx|music|intro|outro)\s*:/iu.test(script)
    || /(?:^|\s)\d{1,2}:\d{2}(?::\d{2})?(?:\s|$)/u.test(script);
}

function validatePodcastScriptText(script = '', locale = 'en', articleCount = 1) {
  const normalized = String(script || '').trim();
  if (normalized.length < getMinScriptLength(articleCount)) {
    throw createPodcastValidationError(`AI podcast ${locale} script is too short`);
  }
  if (/\[\d+\]/u.test(normalized)) {
    throw createPodcastValidationError(`AI podcast ${locale} script contains bracket citations`);
  }
  if (hasForbiddenPodcastFormatting(normalized)) {
    throw createPodcastValidationError(`AI podcast ${locale} script contains non-speakable formatting`);
  }
}

function validateGeneratedPodcast(podcast: PodcastPayload = {}, articleCount = 1, options: { locales?: string[] } = {}) {
  const enabledLocales = Array.isArray(options.locales) && options.locales.length > 0 ? options.locales : getEnabledPodcastLocales();
  const scriptEntries = enabledLocales.map((locale) => {
    const script = String(podcast.scriptTextByLocale?.[locale] || '').trim();
    validatePodcastScriptText(script, getLocaleConfig(locale).label, articleCount);
    return { locale, script };
  });

  const normalizedScripts = scriptEntries.map((entry) => entry.script.toLowerCase());
  if (new Set(normalizedScripts).size !== normalizedScripts.length) {
    throw createPodcastValidationError('AI podcast localized scripts are identical');
  }
}

function getAudioMimeType(format = 'mp3') {
  const normalizedFormat = String(format || '').trim().toLowerCase();
  if (normalizedFormat === 'aac') {
    return 'audio/aac';
  }
  if (normalizedFormat === 'flac') {
    return 'audio/flac';
  }
  if (normalizedFormat === 'pcm') {
    return 'audio/pcm';
  }
  if (normalizedFormat === 'wav') {
    return 'audio/wav';
  }
  if (normalizedFormat === 'opus') {
    return 'audio/ogg';
  }
  return 'audio/mpeg';
}

function isGeminiTtsModel(model = '') {
  const normalizedModel = String(model || '').trim().toLowerCase();
  return normalizedModel.includes('gemini') && normalizedModel.includes('tts');
}

function getTtsAudioFormat(model = '') {
  if (isGeminiTtsModel(model)) {
    return 'pcm';
  }

  return String(process.env.AI_PODCAST_TTS_FORMAT || 'mp3').trim().toLowerCase() || 'mp3';
}

function getTtsVoice() {
  return String(process.env.AI_PODCAST_TTS_VOICE || DEFAULT_TTS_VOICE).trim() || DEFAULT_TTS_VOICE;
}

function getAudioSpeechUrl(config: DynamicRecord = {}) {
  return `${String(config.baseUrl || '').replace(/\/+$/u, '')}/audio/speech`;
}

function getOpenRouterHeaders(config: DynamicRecord = {}) {
  return {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': String(process.env.APP_BASE_URL || 'http://localhost'),
    'X-Title': 'News Flow'
  };
}

function getResponseContentType(headers: Record<string, unknown> = {}, fallbackMimeType = 'audio/mpeg') {
  return String(headers['content-type'] || headers['Content-Type'] || fallbackMimeType)
    .split(';')[0]
    .trim()
    .toLowerCase() || fallbackMimeType;
}

function getResponseBuffer(data: unknown): Buffer {
  if (!data) {
    return Buffer.alloc(0);
  }
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  if (typeof data === 'string') {
    return Buffer.from(data);
  }

  return Buffer.from(JSON.stringify(data));
}

function isWavBuffer(audioBuffer: unknown): audioBuffer is Buffer {
  return Buffer.isBuffer(audioBuffer)
    && audioBuffer.length >= 12
    && audioBuffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && audioBuffer.subarray(8, 12).toString('ascii') === 'WAVE';
}

function createTtsError(message: string, code = 'PODCAST_TTS_FAILED', options: TtsErrorOptions = {}) {
  const error: AppError = new Error(message);
  error.code = code;
  if (options.statusCode) {
    error.statusCode = options.statusCode;
  }
  if (options.headers) {
    error.headers = options.headers;
  }
  if (options.cause) {
    error.cause = options.cause;
  }
  return error;
}

function assertTtsInputWithinLimit(text = '', model = '') {
  const maxInputBytes = getTtsMaxInputBytes(model);
  const inputBytes = Buffer.byteLength(String(text || ''), 'utf8');
  if (inputBytes > maxInputBytes) {
    throw createTtsError(
      `AI podcast TTS input is too long (${inputBytes} bytes > ${maxInputBytes} bytes)`,
      'PODCAST_TTS_INPUT_TOO_LONG'
    );
  }
}

function assertValidAudioBuffer(audioBuffer: unknown, mimeType = ''): asserts audioBuffer is Buffer {
  const normalizedMimeType = String(mimeType || '').split(';')[0].trim().toLowerCase();
  const minAudioBytes = getTtsMinAudioBytes();
  const maxAudioBytes = getTtsMaxAudioBytes();
  if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length < minAudioBytes) {
    throw createTtsError(
      `AI podcast TTS response audio is too small (${Buffer.isBuffer(audioBuffer) ? audioBuffer.length : 0} bytes)`,
      'PODCAST_TTS_AUDIO_INVALID'
    );
  }

  if (audioBuffer.length > maxAudioBytes) {
    throw createTtsError(
      `AI podcast TTS response audio is too large (${audioBuffer.length} bytes > ${maxAudioBytes} bytes)`,
      'PODCAST_TTS_AUDIO_TOO_LARGE'
    );
  }

  if (normalizedMimeType === 'audio/wav' && !isWavBuffer(audioBuffer)) {
    throw createTtsError('AI podcast TTS response did not contain a valid WAV header', 'PODCAST_TTS_AUDIO_INVALID');
  }
}

function getUtf8ByteLength(value = '') {
  return Buffer.byteLength(String(value || ''), 'utf8');
}

function normalizeTtsText(value = '') {
  return String(value || '')
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function normalizeTtsChunkText(value = '') {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function splitLongTextByWords(text = '', maxBytes = DEFAULT_GEMINI_TTS_CHUNK_MAX_BYTES) {
  const parts = [];
  let current = '';

  for (const word of normalizeTtsChunkText(text).split(/\s+/u).filter(Boolean)) {
    if (getUtf8ByteLength(word) > maxBytes) {
      if (current) {
        parts.push(current);
        current = '';
      }

      let wordPart = '';
      for (const character of [...word]) {
        const candidate = `${wordPart}${character}`;
        if (wordPart && getUtf8ByteLength(candidate) > maxBytes) {
          parts.push(wordPart);
          wordPart = character;
        } else {
          wordPart = candidate;
        }
      }
      if (wordPart) {
        parts.push(wordPart);
      }
      continue;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (current && getUtf8ByteLength(candidate) > maxBytes) {
      parts.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}

function splitParagraphIntoSentenceUnits(paragraph = '', maxBytes = DEFAULT_GEMINI_TTS_CHUNK_MAX_BYTES) {
  const normalized = normalizeTtsChunkText(paragraph);
  if (!normalized) {
    return [];
  }

  if (getUtf8ByteLength(normalized) <= maxBytes) {
    return [normalized];
  }

  return normalized
    .split(/(?<=[.!?…])\s+/u)
    .flatMap((sentence) => {
      const cleanSentence = normalizeTtsChunkText(sentence);
      if (!cleanSentence) {
        return [];
      }
      return getUtf8ByteLength(cleanSentence) <= maxBytes
        ? [cleanSentence]
        : splitLongTextByWords(cleanSentence, maxBytes);
    });
}

function splitTextIntoTtsChunks(text = '', maxBytes = DEFAULT_GEMINI_TTS_CHUNK_MAX_BYTES) {
  const normalized = normalizeTtsText(text);
  if (!normalized) {
    return [];
  }

  const units = normalized
    .split(/\n{2,}/u)
    .flatMap((paragraph) => splitParagraphIntoSentenceUnits(paragraph, maxBytes));
  const chunks = [];
  let current = '';

  for (const unit of units) {
    const candidate = current ? `${current} ${unit}` : unit;
    if (current && getUtf8ByteLength(candidate) > maxBytes) {
      chunks.push(current);
      current = unit;
    } else {
      current = candidate;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function wrapPcmBufferInWav(pcmBuffer: Buffer, options: Partial<PcmFormat> = {}) {
  const sampleRate = Number(options.sampleRate) || GEMINI_TTS_PCM_SAMPLE_RATE_HZ;
  const channels = Number(options.channels) || GEMINI_TTS_PCM_CHANNELS;
  const bitsPerSample = Number(options.bitsPerSample) || GEMINI_TTS_PCM_BITS_PER_SAMPLE;
  const blockAlign = Math.max(1, Math.floor((channels * bitsPerSample) / 8));
  const paddingBytes = pcmBuffer.length % blockAlign === 0 ? 0 : blockAlign - (pcmBuffer.length % blockAlign);
  const normalizedPcmBuffer = paddingBytes > 0 ? Buffer.concat([pcmBuffer, Buffer.alloc(paddingBytes)]) : pcmBuffer;
  const dataSize = normalizedPcmBuffer.length;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, normalizedPcmBuffer]);
}

function readWavPcmBuffer(wavBuffer: Buffer): PcmAudio {
  if (!isWavBuffer(wavBuffer)) {
    throw createTtsError('AI podcast TTS response did not contain a valid WAV header', 'PODCAST_TTS_AUDIO_INVALID');
  }

  const format: PcmFormat = {
    audioFormat: 1,
    channels: GEMINI_TTS_PCM_CHANNELS,
    sampleRate: GEMINI_TTS_PCM_SAMPLE_RATE_HZ,
    bitsPerSample: GEMINI_TTS_PCM_BITS_PER_SAMPLE
  };
  let pcmBuffer: Buffer | null = null;
  let offset = 12;

  while (offset + 8 <= wavBuffer.length) {
    const chunkId = wavBuffer.subarray(offset, offset + 4).toString('ascii');
    const chunkSize = wavBuffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = Math.min(chunkStart + chunkSize, wavBuffer.length);

    if (chunkId === 'fmt ' && chunkSize >= 16 && chunkEnd <= wavBuffer.length) {
      format.audioFormat = wavBuffer.readUInt16LE(chunkStart);
      format.channels = wavBuffer.readUInt16LE(chunkStart + 2);
      format.sampleRate = wavBuffer.readUInt32LE(chunkStart + 4);
      format.bitsPerSample = wavBuffer.readUInt16LE(chunkStart + 14);
    }

    if (chunkId === 'data' && chunkEnd <= wavBuffer.length) {
      pcmBuffer = Buffer.from(wavBuffer.subarray(chunkStart, chunkEnd));
      break;
    }

    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  if (!pcmBuffer || pcmBuffer.length === 0) {
    throw createTtsError('AI podcast TTS response did not include audio data', 'PODCAST_TTS_AUDIO_INVALID');
  }
  if (format.audioFormat !== 1) {
    throw createTtsError('AI podcast TTS WAV response is not linear PCM', 'PODCAST_TTS_AUDIO_INVALID');
  }

  return { pcmBuffer, ...format };
}

function normalizeAudioBufferToPcm(audioBuffer: unknown, mimeType = '', requestedFormat = ''): PcmAudio {
  const normalizedMimeType = String(mimeType || '').split(';')[0].trim().toLowerCase();
  const normalizedFormat = String(requestedFormat || '').trim().toLowerCase();
  if (isWavBuffer(audioBuffer)) {
    const pcmAudio = readWavPcmBuffer(audioBuffer);
    if (pcmAudio.pcmBuffer.length < getTtsMinAudioBytes()) {
      throw createTtsError(`AI podcast TTS response audio is too small (${pcmAudio.pcmBuffer.length} bytes)`, 'PODCAST_TTS_AUDIO_INVALID');
    }
    return pcmAudio;
  }
  if (normalizedMimeType === 'audio/pcm' || normalizedFormat === 'pcm') {
    if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length < getTtsMinAudioBytes()) {
      throw createTtsError(`AI podcast TTS response audio is too small (${Buffer.isBuffer(audioBuffer) ? audioBuffer.length : 0} bytes)`, 'PODCAST_TTS_AUDIO_INVALID');
    }
    return {
      pcmBuffer: Buffer.from(audioBuffer),
      audioFormat: 1,
      channels: GEMINI_TTS_PCM_CHANNELS,
      sampleRate: GEMINI_TTS_PCM_SAMPLE_RATE_HZ,
      bitsPerSample: GEMINI_TTS_PCM_BITS_PER_SAMPLE
    };
  }

  throw createTtsError(`AI podcast TTS chunk returned unsupported audio type ${mimeType || 'unknown'}`, 'PODCAST_TTS_AUDIO_INVALID');
}

function getPcmFormatKey(format: Partial<PcmFormat> = {}) {
  return [format.audioFormat || 1, format.channels, format.sampleRate, format.bitsPerSample].join(':');
}

function getPcmSilenceBuffer(format: Partial<PcmFormat> = {}, durationMs = 0) {
  const sampleRate = Number(format.sampleRate) || GEMINI_TTS_PCM_SAMPLE_RATE_HZ;
  const channels = Number(format.channels) || GEMINI_TTS_PCM_CHANNELS;
  const bitsPerSample = Number(format.bitsPerSample) || GEMINI_TTS_PCM_BITS_PER_SAMPLE;
  const blockAlign = Math.max(1, Math.floor((channels * bitsPerSample) / 8));
  const frameCount = Math.max(0, Math.round((sampleRate * Math.max(0, Number(durationMs) || 0)) / 1000));
  return Buffer.alloc(frameCount * blockAlign);
}

function getPcmFrameAmplitude(pcmBuffer: Buffer, offset: number, format: Partial<PcmFormat> = {}) {
  if ((Number(format.bitsPerSample) || GEMINI_TTS_PCM_BITS_PER_SAMPLE) !== 16) {
    return PCM_SILENCE_THRESHOLD + 1;
  }

  const channels = Number(format.channels) || GEMINI_TTS_PCM_CHANNELS;
  let amplitude = 0;
  for (let channel = 0; channel < channels; channel += 1) {
    const sampleOffset = offset + (channel * 2);
    if (sampleOffset + 2 <= pcmBuffer.length) {
      amplitude = Math.max(amplitude, Math.abs(pcmBuffer.readInt16LE(sampleOffset)));
    }
  }
  return amplitude;
}

function trimPcmSilence(pcmBuffer: Buffer, format: Partial<PcmFormat> = {}, options: { preserveStartMs?: number; preserveEndMs?: number } = {}) {
  if ((Number(format.bitsPerSample) || GEMINI_TTS_PCM_BITS_PER_SAMPLE) !== 16) {
    return pcmBuffer;
  }

  const sampleRate = Number(format.sampleRate) || GEMINI_TTS_PCM_SAMPLE_RATE_HZ;
  const channels = Number(format.channels) || GEMINI_TTS_PCM_CHANNELS;
  const blockAlign = Math.max(1, Math.floor((channels * 16) / 8));
  const frameCount = Math.floor(pcmBuffer.length / blockAlign);
  let firstAudibleFrame = -1;
  let lastAudibleFrame = -1;

  for (let frame = 0; frame < frameCount; frame += 1) {
    if (getPcmFrameAmplitude(pcmBuffer, frame * blockAlign, format) > PCM_SILENCE_THRESHOLD) {
      firstAudibleFrame = frame;
      break;
    }
  }

  for (let frame = frameCount - 1; frame >= 0; frame -= 1) {
    if (getPcmFrameAmplitude(pcmBuffer, frame * blockAlign, format) > PCM_SILENCE_THRESHOLD) {
      lastAudibleFrame = frame;
      break;
    }
  }

  if (firstAudibleFrame < 0 || lastAudibleFrame < firstAudibleFrame) {
    return pcmBuffer;
  }

  const preserveStartFrames = Math.round((sampleRate * Math.max(0, Number(options.preserveStartMs) || 0)) / 1000);
  const preserveEndFrames = Math.round((sampleRate * Math.max(0, Number(options.preserveEndMs) || 0)) / 1000);
  const startFrame = Math.max(0, firstAudibleFrame - preserveStartFrames);
  const endFrame = Math.min(frameCount, lastAudibleFrame + 1 + preserveEndFrames);
  return Buffer.from(pcmBuffer.subarray(startFrame * blockAlign, endFrame * blockAlign));
}

function stitchPcmAudioChunks(chunks: PcmAudio[] = [], options: { edgeSilenceMs?: number } = {}) {
  if (chunks.length === 0) {
    throw createTtsError('AI podcast TTS response did not include audio data', 'PODCAST_TTS_AUDIO_INVALID');
  }

  const format = {
    audioFormat: chunks[0].audioFormat || 1,
    channels: chunks[0].channels,
    sampleRate: chunks[0].sampleRate,
    bitsPerSample: chunks[0].bitsPerSample
  };
  const expectedFormatKey = getPcmFormatKey(format);
  const silenceMs = getTtsChunkSilenceMs();
  const edgeSilenceMs = options.edgeSilenceMs ?? DEFAULT_TTS_CHUNK_EDGE_SILENCE_MS;
  const buffers: Buffer[] = [];

  chunks.forEach((chunk, index) => {
    if (getPcmFormatKey(chunk) !== expectedFormatKey) {
      throw createTtsError('AI podcast TTS chunks returned incompatible audio formats', 'PODCAST_TTS_AUDIO_INVALID');
    }

    const isLast = index === chunks.length - 1;
    const trimmedPcm = trimPcmSilence(chunk.pcmBuffer, format, {
      preserveStartMs: edgeSilenceMs,
      preserveEndMs: isLast ? Math.max(edgeSilenceMs, 80) : edgeSilenceMs
    });
    buffers.push(trimmedPcm.length > 0 ? trimmedPcm : chunk.pcmBuffer);

    if (!isLast && silenceMs > 0) {
      buffers.push(getPcmSilenceBuffer(format, silenceMs));
    }
  });

  const pcmByteLength = buffers.reduce((total, buffer) => total + buffer.length, 0);
  if (pcmByteLength + 44 > getTtsMaxAudioBytes()) {
    throw createTtsError(
      `AI podcast TTS response audio is too large (${pcmByteLength + 44} bytes > ${getTtsMaxAudioBytes()} bytes)`,
      'PODCAST_TTS_AUDIO_TOO_LARGE'
    );
  }

  const wavBuffer = wrapPcmBufferInWav(Buffer.concat(buffers, pcmByteLength), format);
  assertValidAudioBuffer(wavBuffer, 'audio/wav');
  return wavBuffer;
}

function normalizeAudioBufferForStorage(audioBuffer: Buffer, mimeType: string, requestedFormat: string) {
  const normalizedFormat = String(requestedFormat || '').trim().toLowerCase();
  const normalizedMimeType = String(mimeType || '').split(';')[0].trim().toLowerCase();
  if ((normalizedFormat === 'pcm' || normalizedMimeType === 'audio/pcm') && !isWavBuffer(audioBuffer)) {
    const wavBuffer = wrapPcmBufferInWav(audioBuffer);
    assertValidAudioBuffer(wavBuffer, 'audio/wav');
    return {
      data: wavBuffer.toString('base64'),
      mimeType: 'audio/wav'
    };
  }

  assertValidAudioBuffer(audioBuffer, mimeType);
  return {
    data: audioBuffer.toString('base64'),
    mimeType
  };
}

function canStitchTtsAudio(model = '', audioFormat = '') {
  return isGeminiTtsModel(model) && String(audioFormat || '').trim().toLowerCase() === 'pcm';
}

function parseSpeechErrorMessage(data: unknown) {
  const text = getResponseBuffer(data).toString('utf8').trim();
  if (!text) {
    return 'empty error response';
  }

  try {
    const parsed = JSON.parse(text);
    const message = String(parsed?.error?.message || parsed?.message || text).trim();
    const providerDetails = String(
      parsed?.error?.metadata?.raw
        || parsed?.error?.metadata?.provider_error
        || parsed?.error?.metadata?.providerError
        || parsed?.error?.details
        || ''
    ).trim();
    return providerDetails && providerDetails !== message
      ? `${message}: ${providerDetails}`.slice(0, 1000)
      : message.slice(0, 1000);
  } catch {
    return text.slice(0, 1000);
  }
}

function getCandidateAudioObjects(response: DynamicRecord = {}): DynamicRecord[] {
  const choices = Array.isArray(response.choices) ? response.choices as DynamicRecord[] : [];
  const choice = choices[0] || {};
  const message = choice.message && typeof choice.message === 'object' ? choice.message as DynamicRecord : {};
  const contentParts = Array.isArray(message.content) ? message.content : [];

  return [
    message.audio,
    choice.audio,
    response.audio,
    ...contentParts.map((part: unknown) => {
      const contentPart = part && typeof part === 'object' ? part as DynamicRecord : {};
      return contentPart.audio || contentPart.input_audio || contentPart;
    })
  ].filter((value): value is DynamicRecord => Boolean(value && typeof value === 'object'));
}

function extractAudioPayload(response: unknown, fallbackMimeType = 'audio/mpeg') {
  const payload = response && typeof response === 'object' ? response as DynamicRecord : {};
  for (const candidate of getCandidateAudioObjects(payload)) {
    if (typeof candidate?.data === 'string' && candidate.data.trim()) {
      const rawData = candidate.data.trim();
      const dataUriMatch = rawData.match(/^data:(audio\/[^;,]+);base64,(.+)$/i);
      return {
        data: dataUriMatch ? dataUriMatch[2].trim() : rawData,
        mimeType: dataUriMatch
          ? dataUriMatch[1]
          : (String(candidate.mimeType || candidate.mime_type || candidate.contentType || candidate.content_type || fallbackMimeType).trim() || fallbackMimeType)
      };
    }
  }

  return null;
}

async function requestAudioBuffer(text: string, options: TtsRequestOptions): Promise<AudioResponse> {
  const { config, audioFormat, ttsVoice, fallbackMimeType, locale = 'en' } = options;
  let response;
  try {
    response = await audioSpeechHttpClient.post(
      getAudioSpeechUrl(config),
      {
        model: config.model,
        input: text,
        voice: ttsVoice,
        response_format: audioFormat,
        instructions: getNarrationInstructions(locale)
      },
      {
        headers: getOpenRouterHeaders(config),
        responseType: 'arraybuffer',
        timeout: options.timeoutMs || config.timeoutMs,
        maxContentLength: getTtsMaxAudioBytes(),
        maxBodyLength: getTtsMaxAudioBytes(),
        validateStatus: () => true
      }
    );
  } catch (error) {
    const requestError = error as AppError & DynamicRecord;
    throw createTtsError(
      `AI podcast TTS request failed: ${requestError.message}`,
      'PODCAST_TTS_PROVIDER_ERROR',
      {
        statusCode: requestError.statusCode || (requestError.response as DynamicRecord | undefined)?.status as number | undefined,
        headers: requestError.headers || (requestError.response as DynamicRecord | undefined)?.headers as Record<string, string | string[] | undefined> | undefined,
        cause: requestError
      }
    );
  }

  if (response.status >= 400) {
    throw createTtsError(
      `AI podcast TTS request failed (${response.status}): ${parseSpeechErrorMessage(response.data)}`,
      'PODCAST_TTS_PROVIDER_ERROR',
      { statusCode: response.status, headers: response.headers }
    );
  }

  const contentType = getResponseContentType(response.headers || {}, fallbackMimeType);
  if (contentType === 'application/json') {
    const payload = parseJsonContent(getResponseBuffer(response.data).toString('utf8'));
    const audio = extractAudioPayload(payload, fallbackMimeType);
    if (!audio?.data) {
      throw createTtsError('AI podcast TTS response did not include audio data', 'PODCAST_TTS_AUDIO_INVALID');
    }

    const audioBuffer = Buffer.from(String(audio.data || ''), 'base64');
    if (audioBuffer.length === 0) {
      throw createTtsError('AI podcast TTS response did not include audio data', 'PODCAST_TTS_AUDIO_INVALID');
    }

    return {
      audioBuffer,
      mimeType: String(audio.mimeType || fallbackMimeType).trim() || fallbackMimeType
    };
  }

  const audioBuffer = getResponseBuffer(response.data);
  if (audioBuffer.length === 0) {
    throw createTtsError('AI podcast TTS response did not include audio data', 'PODCAST_TTS_AUDIO_INVALID');
  }

  return {
    audioBuffer,
    mimeType: contentType || fallbackMimeType
  };
}

function isRetryableTtsError(error: AppError & DynamicRecord) {
  return isTransientOpenRouterError(error) || error.code === 'PODCAST_TTS_AUDIO_INVALID';
}

function sleep(delayMs: number) {
  return delayMs > 0 ? new Promise((resolve) => setTimeout(resolve, delayMs)) : Promise.resolve();
}

async function requestAudioWithRetry<T>(text: string, options: TtsRequestOptions, normalizeAudio: (audio: AudioResponse) => T) {
  const { config, deadline } = options;
  const maxRetries = getTtsChunkMaxRetries();
  let attempt = 0;

  while (true) {
    assertOpenRouterRequestAllowed(config.model);
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw createTtsError('AI podcast TTS total timeout exceeded', 'PODCAST_TTS_TIMEOUT');
    }

    try {
      const requestStartedAt = Date.now();
      const audio = await requestAudioBuffer(text, {
        ...options,
        timeoutMs: Math.min(config.timeoutMs, remainingMs)
      });
      const value = normalizeAudio(audio);
      clearOpenRouterFailure(config.model, requestStartedAt);
      return { value, attemptCount: attempt + 1 };
    } catch (error) {
      const requestError = error as AppError & DynamicRecord;
      if (!isRetryableTtsError(requestError) || attempt >= maxRetries) {
        requestError.requestCount = attempt + 1;
        requestError.retryCount = attempt;
        recordOpenRouterFailure(config.model, requestError);
        throw requestError;
      }

      const retryDelayMs = Math.max(
        getRetryAfterMs(requestError),
        getTtsChunkRetryDelayMs() * (2 ** attempt)
      );
      if (Date.now() + retryDelayMs >= deadline) {
        recordOpenRouterFailure(config.model, requestError);
        const timeoutError = createTtsError('AI podcast TTS total timeout exceeded', 'PODCAST_TTS_TIMEOUT');
        timeoutError.requestCount = attempt + 1;
        timeoutError.retryCount = attempt;
        throw timeoutError;
      }
      attempt += 1;
      await sleep(retryDelayMs);
    }
  }
}

async function generateChunkedAudio(text: string, options: TtsRequestOptions) {
  const { config, audioFormat } = options;
  const chunks = splitTextIntoTtsChunks(text, getTtsChunkMaxBytes(config.model));
  const maxChunks = getTtsMaxChunks();
  if (chunks.length > maxChunks) {
    throw createTtsError(
      `AI podcast TTS input requires too many chunks (${chunks.length} > ${maxChunks})`,
      'PODCAST_TTS_INPUT_TOO_LONG'
    );
  }

  const pcmChunks: PcmAudio[] = [];
  let requestCount = 0;
  let cumulativePcmBytes = 0;
  for (const chunk of chunks) {
    assertTtsInputWithinLimit(chunk, config.model);
    let pcmChunk;
    let attemptCount;
    try {
      ({ value: pcmChunk, attemptCount } = await requestAudioWithRetry(
        chunk,
        options,
        (audio) => normalizeAudioBufferToPcm(audio.audioBuffer, audio.mimeType, audioFormat)
      ));
    } catch (error) {
      const requestError = error as AppError;
      requestError.requestCount = requestCount + (requestError.requestCount || 0);
      requestError.retryCount = (requestCount - pcmChunks.length) + (requestError.retryCount || 0);
      throw requestError;
    }
    requestCount += attemptCount;
    const silenceBytes = pcmChunks.length > 0 ? getPcmSilenceBuffer(pcmChunks[0], getTtsChunkSilenceMs()).length : 0;
    cumulativePcmBytes += pcmChunk.pcmBuffer.length + silenceBytes;
    if (cumulativePcmBytes + 44 > getTtsMaxAudioBytes()) {
      throw createTtsError(
        `AI podcast TTS response audio is too large (${cumulativePcmBytes + 44} bytes > ${getTtsMaxAudioBytes()} bytes)`,
        'PODCAST_TTS_AUDIO_TOO_LARGE'
      );
    }
    pcmChunks.push(pcmChunk);
  }

  return {
    data: stitchPcmAudioChunks(pcmChunks).toString('base64'),
    mimeType: 'audio/wav',
    chunkCount: chunks.length,
    requestCount,
    retryCount: requestCount - chunks.length
  };
}

async function generateSingleAudio(text: string, options: TtsRequestOptions) {
  const { config, audioFormat } = options;
  assertTtsInputWithinLimit(text, config.model);
  const { value, attemptCount } = await requestAudioWithRetry(
    text,
    options,
    (audio) => normalizeAudioBufferForStorage(audio.audioBuffer, audio.mimeType, audioFormat)
  );
  return { ...value, requestCount: attemptCount, retryCount: attemptCount - 1 };
}

async function generatePodcastScript(window: DynamicRecord = {}, articles: NewsArticle[] = []) {
  const config = getScriptConfig();
  const enabledLocales = getEnabledPodcastLocales();
  if (!Array.isArray(articles) || articles.length === 0) {
    return null;
  }

  if (!config.enabled) {
    logger.info(`AI podcast script generation skipped: reason=${config.apiKey ? 'disabled' : 'missing_api_key'}`);
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
        content: 'You write source-grounded, speakable podcast scripts. Return valid JSON only.'
      },
      {
        role: 'user',
        content: buildPrompt(window, articles, { locales: enabledLocales })
      }
    ],
    temperature: 0.35,
    maxTokens: tokenBudget
  }, {
    timeoutMs: config.timeoutMs,
    metrics: {
      feature: 'podcast_script',
      articleCount: articles.length,
      localeCount: enabledLocales.length,
      maxTokens: tokenBudget
    }
  });
  const payload = parseJsonContent(extractAssistantContent(response));
  const normalized = normalizeGeneratedPodcast(payload, { locales: enabledLocales });

  if (!normalized) {
    throw new Error(`AI podcast response did not contain script text for enabled languages: ${getPodcastLanguageLabels(enabledLocales).join(', ')}`);
  }

  validateGeneratedPodcast(normalized, articles.length, { locales: enabledLocales });

  logger.info(`AI podcast script generated: model=${config.model}, articles=${articles.length}, durationMs=${Date.now() - startedAt}`);
  return {
    ...normalized,
    model: config.model
  };
}

async function generateAudioForLocale(scriptText = '', locale = 'en') {
  const config = getTtsConfig();
  const normalizedLocale = normalizePodcastLocale(locale) || 'en';
  const text = String(scriptText || '').trim();
  if (!text) {
    return null;
  }

  if (!config.enabled) {
    logger.info(`AI podcast audio generation skipped: reason=${config.apiKey ? 'disabled' : 'missing_api_key'}`);
    return null;
  }

  const audioFormat = getTtsAudioFormat(config.model);
  const ttsVoice = getTtsVoice();
  const fallbackMimeType = getAudioMimeType(audioFormat);
  const startedAt = Date.now();
  const deadline = startedAt + getTtsTotalTimeoutMs();
  const inputBytes = Buffer.byteLength(text, 'utf8');
  let playableAudio: DynamicRecord;
  try {
    playableAudio = canStitchTtsAudio(config.model, audioFormat)
      ? await generateChunkedAudio(text, { config, audioFormat, ttsVoice, fallbackMimeType, locale: normalizedLocale, deadline })
      : await generateSingleAudio(text, { config, audioFormat, ttsVoice, fallbackMimeType, locale: normalizedLocale, deadline });
  } catch (error) {
    const generationError = error as AppError;
    logAiRequestMetric({
      provider: 'openrouter',
      type: 'audio_speech',
      feature: 'podcast_tts',
      model: config.model,
      status: 'failed',
      locale: normalizedLocale,
      inputBytes,
      estimatedInputTokens: estimateTokenCountFromChars(text.length),
      durationMs: Date.now() - startedAt,
      requestCount: generationError.requestCount,
      retryCount: generationError.retryCount,
      errorCode: generationError.code,
      errorMessage: generationError.message
    }, 'warn');
    throw error;
  }
  const { chunkCount, requestCount, retryCount, ...audioForStorage } = playableAudio;

  logAiRequestMetric({
    provider: 'openrouter',
    type: 'audio_speech',
    feature: 'podcast_tts',
    model: config.model,
    status: 'completed',
    locale: normalizedLocale,
    inputBytes,
    estimatedInputTokens: estimateTokenCountFromChars(text.length),
    chunkCount: chunkCount || 1,
    requestCount: requestCount || 1,
    retryCount: retryCount || 0,
    audioBytes: Buffer.byteLength(typeof audioForStorage.data === 'string' ? audioForStorage.data : '', 'base64'),
    durationMs: Date.now() - startedAt
  });
  logger.info(`AI podcast audio generated: locale=${normalizedLocale}, model=${config.model}, chunks=${chunkCount || 1}, durationMs=${Date.now() - startedAt}`);
  return {
    ...audioForStorage,
    model: config.model,
    voice: ttsVoice,
    generatedAt: new Date().toISOString()
  };
}

function isAiPodcastGenerationAvailable() {
  return getScriptConfig().enabled;
}

export = {
  generatePodcastScriptForArticles: generatePodcastScript,
  generateAudioForLocale,
  isAiPodcastGenerationAvailable,
  _buildPrompt: buildPrompt,
  _extractAudioPayload: extractAudioPayload,
  _getEnabledPodcastLocales: getEnabledPodcastLocales,
  _getNarrationInstructions: getNarrationInstructions,
  _getArticleTextLimit: getArticleTextLimit,
  _getScriptConfig: getScriptConfig,
  _getTtsConfig: getTtsConfig,
  _getTtsVoice: getTtsVoice,
  _normalizeGeneratedPodcast: normalizeGeneratedPodcast,
  _validateGeneratedPodcast: validateGeneratedPodcast,
  _setAudioSpeechHttpClient: setAudioSpeechHttpClient
};
