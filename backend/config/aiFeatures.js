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

function isAiTopicDetectionEnabled() {
  return isOpenRouterFeatureEnabled('AI_TOPIC_DETECTION_ENABLED');
}

function isAiStoryGroupingEnabled() {
  return isOpenRouterFeatureEnabled('AI_STORY_GROUPING_ENABLED');
}

function isAiSummaryGenerationEnabled() {
  return isOpenRouterFeatureEnabled('AI_SUMMARY_GENERATION_ENABLED');
}

function isAiPodcastGenerationEnabled() {
  return isOpenRouterFeatureEnabled('AI_PODCAST_GENERATION_ENABLED');
}

function isAiPodcastTtsEnabled() {
  return isOpenRouterFeatureEnabled('AI_PODCAST_TTS_ENABLED');
}

function getAiFeatures() {
  return {
    ai: {
      topicDetectionEnabled: isAiTopicDetectionEnabled(),
      storyGroupingEnabled: isAiStoryGroupingEnabled(),
      thematicSummariesEnabled: isAiSummaryGenerationEnabled(),
      podcastsEnabled: isAiPodcastGenerationEnabled(),
      podcastAudioEnabled: isAiPodcastTtsEnabled()
    }
  };
}

module.exports = {
  getAiFeatures,
  isAiPodcastGenerationEnabled,
  isAiPodcastTtsEnabled,
  isAiStoryGroupingEnabled,
  isAiSummaryGenerationEnabled,
  isAiTopicDetectionEnabled,
  isOpenRouterFeatureEnabled,
  readAiToggleValue
};
