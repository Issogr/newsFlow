const { parseBooleanEnv } = require('../utils/env');

function hasOpenRouterApiKey() {
  return Boolean(String(process.env.OPENROUTER_API_KEY || '').trim());
}

function isAiToggleEnabled(envName, fallback = true) {
  return parseBooleanEnv(envName, fallback, { invalidFallback: false });
}

function isOpenRouterFeatureEnabled(envName) {
  return isAiToggleEnabled(envName) && hasOpenRouterApiKey();
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
  isAiToggleEnabled,
  isOpenRouterFeatureEnabled,
};
