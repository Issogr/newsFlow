const { parseBooleanEnv } = require('../utils/env');

function hasOpenRouterApiKey() {
  return Boolean(String(process.env.OPENROUTER_API_KEY || '').trim());
}

function readAiToggleValue(envName, fallback = 'true') {
  return parseBooleanEnv(envName, fallback !== 'false', { invalidFallback: false }) ? 'true' : 'false';
}

function isOpenRouterFeatureEnabled(envName) {
  const enabledValue = readAiToggleValue(envName);
  return enabledValue !== 'false' && hasOpenRouterApiKey();
}

function getAiFeatures() {
  return {
    ai: {
      topicDetectionEnabled: isOpenRouterFeatureEnabled('AI_TOPIC_DETECTION_ENABLED'),
      clickbaitDetectionEnabled: isOpenRouterFeatureEnabled('AI_CLICKBAIT_DETECTION_ENABLED'),
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
