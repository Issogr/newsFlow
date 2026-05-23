const { parseIntegerEnv } = require('../utils/env');

const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
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

function getOpenRouterConfig({
  enabledEnvName,
  modelEnvName,
  defaultModel,
  timeoutEnvName,
  defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
  clampTimeout = false
} = {}) {
  const apiKey = String(process.env.OPENROUTER_API_KEY || '').trim();
  const enabledValue = String(process.env[enabledEnvName] || 'auto').trim().toLowerCase();
  const resolvedDefaultModel = String(defaultModel || '').trim();

  return {
    apiKey,
    enabled: enabledValue !== 'false' && Boolean(apiKey),
    model: String(process.env[modelEnvName] || resolvedDefaultModel).trim() || resolvedDefaultModel,
    baseUrl: String(process.env.OPENROUTER_BASE_URL || DEFAULT_OPENROUTER_BASE_URL).trim().replace(/\/+$/u, ''),
    timeoutMs: parseIntegerEnv(timeoutEnvName, defaultTimeoutMs, { min: 1000, max: 120000, clamp: clampTimeout, strict: true })
  };
}

async function createOpenRouterClient(config = {}) {
  const { OpenRouter } = await loadOpenRouterSdk();
  return new OpenRouter({
    apiKey: config.apiKey,
    serverURL: config.baseUrl,
    timeoutMs: config.timeoutMs,
    httpReferer: String(process.env.APP_BASE_URL || 'http://localhost'),
    appTitle: 'News Flow'
  });
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

module.exports = {
  createOpenRouterClient,
  extractAssistantContent,
  getOpenRouterConfig,
  parseJsonContent,
  setOpenRouterSdkLoader
};
