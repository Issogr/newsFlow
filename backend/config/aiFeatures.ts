import { parseBooleanEnv } from '../utils/env';

function isAiToggleEnabled(envName: string, fallback = true) {
  return parseBooleanEnv(envName, fallback, { invalidFallback: false });
}

function isOpenRouterFeatureEnabled(envName: string) {
  return isAiToggleEnabled(envName) && Boolean(String(process.env.OPENROUTER_API_KEY || '').trim());
}

function getAiFeatures() {
  return {
    ai: {
      topicDetectionEnabled: isOpenRouterFeatureEnabled('AI_TOPIC_DETECTION_ENABLED'),
      storyGroupingEnabled: isOpenRouterFeatureEnabled('AI_STORY_GROUPING_ENABLED'),
      thematicSummariesEnabled: isOpenRouterFeatureEnabled('AI_SUMMARY_GENERATION_ENABLED')
    }
  };
}

export default {
  getAiFeatures,
  isAiToggleEnabled,
  isOpenRouterFeatureEnabled,
};
