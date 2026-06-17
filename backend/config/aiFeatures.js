const VALID_AI_TOGGLE_VALUES = new Set(['true', 'false']);

function hasOpenRouterApiKey() {
  return Boolean(String(process.env.OPENROUTER_API_KEY || '').trim());
}

function readAiToggleValue(envName, fallback = 'true') {
  const rawValue = process.env[envName];
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return fallback;
  }

  const normalized = String(rawValue).trim().toLowerCase();
  return VALID_AI_TOGGLE_VALUES.has(normalized) ? normalized : 'false';
}

function isOpenRouterFeatureEnabled(envName) {
  const enabledValue = readAiToggleValue(envName);
  return enabledValue !== 'false' && hasOpenRouterApiKey();
}

function getAiFeatures() {
  return {
    ai: {
      topicDetectionEnabled: isOpenRouterFeatureEnabled('AI_TOPIC_DETECTION_ENABLED'),
      storyGroupingEnabled: isOpenRouterFeatureEnabled('AI_STORY_GROUPING_ENABLED'),
      thematicSummariesEnabled: isOpenRouterFeatureEnabled('AI_SUMMARY_GENERATION_ENABLED'),
      podcastsEnabled: isOpenRouterFeatureEnabled('AI_PODCAST_GENERATION_ENABLED')
    }
  };
}

module.exports = {
  getAiFeatures,
  isOpenRouterFeatureEnabled,
  readAiToggleValue
};
