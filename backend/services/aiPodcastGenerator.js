const axios = require('axios');
const logger = require('../utils/logger');
const { parseIntegerEnv } = require('../utils/env');
const { removePromotionalSentences } = require('../utils/promotionalContent');
const { buildArticlePayload, getArticleTextLimit: getSharedArticleTextLimit, truncateText } = require('./aiArticlePayload');
const {
  createOpenRouterClient,
  extractAssistantContent,
  getOpenRouterConfig,
  parseJsonContent,
  setOpenRouterSdkLoader
} = require('./openRouterClient');

const DEFAULT_PODCAST_SCRIPT_MODEL = 'deepseek/deepseek-v4-flash';
const DEFAULT_PODCAST_AUDIO_MODEL = 'google/gemini-3.1-flash-tts-preview';
const DEFAULT_TTS_VOICE = 'Charon';
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_TTS_TIMEOUT_MS = 120000;
const DEFAULT_PROMPT_TEXT_BUDGET_CHARS = 42000;
const DEFAULT_GEMINI_TTS_MAX_INPUT_BYTES = 3800;
const DEFAULT_TTS_MAX_INPUT_BYTES = 6000;
const DEFAULT_TTS_MIN_AUDIO_BYTES = 1024;
const MIN_PODCAST_SCRIPT_CHARS = 120;
const GEMINI_TTS_PCM_SAMPLE_RATE_HZ = 24000;
const GEMINI_TTS_PCM_CHANNELS = 1;
const GEMINI_TTS_PCM_BITS_PER_SAMPLE = 16;

let audioSpeechHttpClient = axios;

function setAudioSpeechHttpClient(client) {
  audioSpeechHttpClient = client || axios;
}

function getScriptConfig() {
  return getOpenRouterConfig({
    enabledEnvName: 'AI_SUMMARY_GENERATION_ENABLED',
    modelEnvName: 'OPENROUTER_PODCAST_SCRIPT_MODEL',
    defaultModel: DEFAULT_PODCAST_SCRIPT_MODEL,
    timeoutEnvName: 'AI_SUMMARY_REQUEST_TIMEOUT_MS',
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS
  });
}

function getTtsConfig() {
  return getOpenRouterConfig({
    enabledEnvName: 'AI_PODCAST_TTS_ENABLED',
    modelEnvName: 'OPENROUTER_PODCAST_AUDIO_MODEL',
    defaultModel: DEFAULT_PODCAST_AUDIO_MODEL,
    timeoutEnvName: 'AI_PODCAST_TTS_TIMEOUT_MS',
    defaultTimeoutMs: DEFAULT_TTS_TIMEOUT_MS
  });
}

function getArticleTextLimit(articleCount) {
  return getSharedArticleTextLimit(articleCount, {
    envName: 'AI_PODCAST_PROMPT_TEXT_BUDGET_CHARS',
    defaultBudgetChars: DEFAULT_PROMPT_TEXT_BUDGET_CHARS
  });
}

function getTtsMaxInputBytes(model = '') {
  const defaultLimit = isGeminiTtsModel(model) ? DEFAULT_GEMINI_TTS_MAX_INPUT_BYTES : DEFAULT_TTS_MAX_INPUT_BYTES;
  return parseIntegerEnv('AI_PODCAST_TTS_MAX_INPUT_BYTES', defaultLimit, { min: 500, max: 16000 });
}

function getTtsMinAudioBytes() {
  return parseIntegerEnv('AI_PODCAST_TTS_MIN_AUDIO_BYTES', DEFAULT_TTS_MIN_AUDIO_BYTES, { min: 44, max: 100000 });
}

function buildPrompt(window = {}, articles = []) {
  const articleTextLimit = getArticleTextLimit(articles.length);
  const ttsInputTarget = Math.floor(getTtsMaxInputBytes(getTtsConfig().model) * 0.85);

  return [
    'Write a single podcast-style news script using only the provided articles.',
    'This is not topic-specific: include every newsworthy article in the input exactly once or as part of a coherent connected segment.',
    'Skip promotional shopping deals, coupon or affiliate sale posts, and product price-drop blurbs; do not read them as news.',
    'The schedule window is coverage metadata only. Do not name the title or opening after a time of day such as morning, noon, midday, afternoon, evening, night, mattina, mezzogiorno, pomeriggio, or sera.',
    'The script should feel natural when read aloud: quick introduction, fluid transitions, concise context, then a short closing.',
    'Use short paragraphs separated by blank lines. Start a new paragraph after the intro, when changing story or subject, and before the closing.',
    'Do not invent facts, do not use outside knowledge, and do not add bracket citations because the script may be converted to speech.',
    'Mention source names naturally only when useful. Avoid bullet lists, markdown, stage directions, timestamps, and sound effects.',
    `Keep each localized script under ${ttsInputTarget} UTF-8 bytes; concise scripts are more reliable for text-to-speech conversion.`,
    'Generate both supported languages: English and Italian. The Italian script will be used for text-to-speech audio.',
    'Return minified JSON only. Do not use markdown fences or prose outside JSON.',
    'Return this exact shape: {"en":{"title":"News briefing","script":"speakable script"},"it":{"title":"Briefing notizie","script":"testo podcast parlato"}}.',
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

function getCompletionTokenBudget(articleCount) {
  return Math.min(7000, 1200 + (Math.max(1, articleCount) * 90));
}

function normalizeLocalizedPodcast(payload = {}, locale, fallbackTitle = '') {
  const localizedPayload = payload?.[locale] && typeof payload[locale] === 'object' ? payload[locale] : null;
  if (!localizedPayload) {
    return null;
  }

  const title = sanitizePodcastTitle(localizedPayload.title || fallbackTitle, locale, fallbackTitle);
  const script = sanitizePodcastScript(localizedPayload.script || localizedPayload.text || '', locale);

  if (!script) {
    return null;
  }

  return { title, script };
}

function normalizeGeneratedPodcast(payload = {}) {
  const en = normalizeLocalizedPodcast(payload, 'en', 'News briefing');
  const it = normalizeLocalizedPodcast(payload, 'it', 'Briefing notizie');

  if (!en?.script || !it?.script) {
    return null;
  }

  return {
    title: en.title,
    scriptText: en.script,
    titleByLocale: {
      en: en.title,
      it: it.title
    },
    scriptTextByLocale: {
      en: en.script,
      it: it.script
    }
  };
}

function createPodcastValidationError(message) {
  const error = new Error(message);
  error.code = 'PODCAST_SCRIPT_VALIDATION_FAILED';
  return error;
}

function getMinScriptLength(articleCount) {
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

function validateGeneratedPodcast(podcast = {}, articleCount = 1) {
  const enScript = String(podcast.scriptTextByLocale?.en || '').trim();
  const itScript = String(podcast.scriptTextByLocale?.it || '').trim();

  validatePodcastScriptText(enScript, 'English', articleCount);
  validatePodcastScriptText(itScript, 'Italian', articleCount);

  if (enScript.toLowerCase() === itScript.toLowerCase()) {
    throw createPodcastValidationError('AI podcast English and Italian scripts are identical');
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

function getAudioSpeechUrl(config = {}) {
  return `${String(config.baseUrl || '').replace(/\/+$/u, '')}/audio/speech`;
}

function getOpenRouterHeaders(config = {}) {
  return {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': String(process.env.APP_BASE_URL || 'http://localhost'),
    'X-Title': 'News Flow'
  };
}

function getResponseContentType(headers = {}, fallbackMimeType = 'audio/mpeg') {
  return String(headers['content-type'] || headers['Content-Type'] || fallbackMimeType)
    .split(';')[0]
    .trim()
    .toLowerCase() || fallbackMimeType;
}

function getResponseBuffer(data) {
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

function isWavBuffer(audioBuffer) {
  return Buffer.isBuffer(audioBuffer)
    && audioBuffer.length >= 12
    && audioBuffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && audioBuffer.subarray(8, 12).toString('ascii') === 'WAVE';
}

function createTtsError(message, code = 'PODCAST_TTS_FAILED') {
  const error = new Error(message);
  error.code = code;
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

function assertValidAudioBuffer(audioBuffer, mimeType = '') {
  const normalizedMimeType = String(mimeType || '').split(';')[0].trim().toLowerCase();
  const minAudioBytes = getTtsMinAudioBytes();
  if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length < minAudioBytes) {
    throw createTtsError(
      `AI podcast TTS response audio is too small (${audioBuffer?.length || 0} bytes)`,
      'PODCAST_TTS_AUDIO_INVALID'
    );
  }

  if (normalizedMimeType === 'audio/wav' && !isWavBuffer(audioBuffer)) {
    throw createTtsError('AI podcast TTS response did not contain a valid WAV header', 'PODCAST_TTS_AUDIO_INVALID');
  }
}

function getTtsFailureCategory(error = {}) {
  if (error.code === 'PODCAST_TTS_PROVIDER_ERROR') {
    return 'provider_unavailable';
  }

  return 'tts_failed';
}

function wrapPcmBufferInWav(pcmBuffer, options = {}) {
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

function normalizeAudioBufferForStorage(audioBuffer, mimeType, requestedFormat) {
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

function normalizeExtractedAudioForStorage(audio = {}, requestedFormat = '') {
  const audioBuffer = Buffer.from(String(audio.data || ''), 'base64');
  if (audioBuffer.length === 0) {
    return null;
  }

  return normalizeAudioBufferForStorage(
    audioBuffer,
    String(audio.mimeType || getAudioMimeType(requestedFormat)).trim() || getAudioMimeType(requestedFormat),
    requestedFormat
  );
}

function parseSpeechErrorMessage(data) {
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

function getCandidateAudioObjects(response = {}) {
  const choice = response.choices?.[0] || {};
  const message = choice.message || {};
  const contentParts = Array.isArray(message.content) ? message.content : [];

  return [
    message.audio,
    choice.audio,
    response.audio,
    ...contentParts.map((part) => part?.audio || part?.input_audio || part)
  ].filter(Boolean);
}

function extractAudioPayload(response = {}, fallbackMimeType = 'audio/mpeg') {
  for (const candidate of getCandidateAudioObjects(response)) {
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

async function generatePodcastScript(window = {}, articles = []) {
  const config = getScriptConfig();
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
  const completionPromise = openRouter.chat.send({
    chatRequest: {
      model: config.model,
      messages: [
        {
          role: 'system',
          content: 'You write source-grounded, speakable podcast scripts. Return valid JSON only.'
        },
        {
          role: 'user',
          content: buildPrompt(window, articles)
        }
      ],
      temperature: 0.35,
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
  const normalized = normalizeGeneratedPodcast(payload);

  if (!normalized) {
    throw new Error('AI podcast response did not contain both English and Italian script text');
  }

  validateGeneratedPodcast(normalized, articles.length);

  logger.info(`AI podcast script generated: model=${config.model}, articles=${articles.length}, durationMs=${Date.now() - startedAt}`);
  return {
    ...normalized,
    model: config.model
  };
}

async function generateItalianAudio(scriptText = '') {
  const config = getTtsConfig();
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
  assertTtsInputWithinLimit(text, config.model);
  const startedAt = Date.now();
  const response = await audioSpeechHttpClient.post(
    getAudioSpeechUrl(config),
    {
      model: config.model,
      input: text,
      voice: ttsVoice,
      response_format: audioFormat,
      instructions: 'Generate clear, natural Italian podcast narration audio. Do not translate the input text.'
    },
    {
      headers: getOpenRouterHeaders(config),
      responseType: 'arraybuffer',
      timeout: config.timeoutMs,
      validateStatus: () => true
    }
  );

  if (response.status >= 400) {
    throw createTtsError(`AI podcast TTS request failed (${response.status}): ${parseSpeechErrorMessage(response.data)}`, 'PODCAST_TTS_PROVIDER_ERROR');
  }

  const contentType = getResponseContentType(response.headers || {}, fallbackMimeType);
  if (contentType === 'application/json') {
    const payload = parseJsonContent(getResponseBuffer(response.data).toString('utf8'));
    const audio = extractAudioPayload(payload, fallbackMimeType);
    if (audio?.data) {
      const playableAudio = normalizeExtractedAudioForStorage(audio, audioFormat);
      if (!playableAudio) {
        throw createTtsError('AI podcast TTS response did not include audio data', 'PODCAST_TTS_AUDIO_INVALID');
      }

      logger.info(`AI podcast audio generated: model=${config.model}, durationMs=${Date.now() - startedAt}`);
      return {
        ...playableAudio,
        model: config.model,
        voice: ttsVoice,
        generatedAt: new Date().toISOString()
      };
    }

    throw createTtsError('AI podcast TTS response did not include audio data', 'PODCAST_TTS_AUDIO_INVALID');
  }

  const audioBuffer = getResponseBuffer(response.data);
  if (audioBuffer.length === 0) {
    throw createTtsError('AI podcast TTS response did not include audio data', 'PODCAST_TTS_AUDIO_INVALID');
  }
  const playableAudio = normalizeAudioBufferForStorage(audioBuffer, contentType || fallbackMimeType, audioFormat);

  logger.info(`AI podcast audio generated: model=${config.model}, durationMs=${Date.now() - startedAt}`);
  return {
    ...playableAudio,
    model: config.model,
    voice: ttsVoice,
    generatedAt: new Date().toISOString()
  };
}

async function generatePodcastForArticles(window = {}, articles = []) {
  const script = await generatePodcastScript(window, articles);
  if (!script) {
    return null;
  }

  let audio = null;
  let audioErrorMessage = '';
  try {
    audio = await generateItalianAudio(script.scriptTextByLocale.it);
  } catch (error) {
    audioErrorMessage = error.message;
    const audioFailureCategory = getTtsFailureCategory(error);
    logger.warn(`AI podcast audio generation failed: model=${getTtsConfig().model}, error=${error.message}`);
    return {
      ...script,
      audio: null,
      audioStatus: 'failed',
      audioErrorMessage,
      audioFailureCategory
    };
  }

  return {
    ...script,
    audio,
    audioStatus: audio ? 'completed' : 'not_available',
    audioErrorMessage,
    audioFailureCategory: ''
  };
}

function isAiPodcastGenerationAvailable() {
  return getScriptConfig().enabled;
}

module.exports = {
  generatePodcastForArticles,
  generateItalianAudio,
  isAiPodcastGenerationAvailable,
  _buildPrompt: buildPrompt,
  _extractAudioPayload: extractAudioPayload,
  _generateItalianAudio: generateItalianAudio,
  _getAudioSpeechUrl: getAudioSpeechUrl,
  _getArticleTextLimit: getArticleTextLimit,
  _getScriptConfig: getScriptConfig,
  _getTtsConfig: getTtsConfig,
  _getTtsMaxInputBytes: getTtsMaxInputBytes,
  _getTtsVoice: getTtsVoice,
  _normalizeGeneratedPodcast: normalizeGeneratedPodcast,
  _parseJsonContent: parseJsonContent,
  _validateGeneratedPodcast: validateGeneratedPodcast,
  _setAudioSpeechHttpClient: setAudioSpeechHttpClient,
  _setOpenRouterSdkLoader: setOpenRouterSdkLoader
};
