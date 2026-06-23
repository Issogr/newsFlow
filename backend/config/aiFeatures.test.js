describe('aiFeatures config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('enables all AI features by default when OpenRouter is configured', () => {
    process.env.OPENROUTER_API_KEY = 'test-key';

    const { getAiFeatures } = require('./aiFeatures');

    expect(getAiFeatures()).toEqual({
      ai: {
        topicDetectionEnabled: true,
        clickbaitDetectionEnabled: true,
        storyGroupingEnabled: true,
        thematicSummariesEnabled: true,
        podcastsEnabled: true
      }
    });
  });

  test('disables all AI features when OpenRouter is not configured', () => {
    delete process.env.OPENROUTER_API_KEY;

    const { getAiFeatures } = require('./aiFeatures');

    expect(getAiFeatures()).toEqual({
      ai: {
        topicDetectionEnabled: false,
        clickbaitDetectionEnabled: false,
        storyGroupingEnabled: false,
        thematicSummariesEnabled: false,
        podcastsEnabled: false
      }
    });
  });

  test('allows each AI feature to be disabled independently with false', () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.AI_TOPIC_DETECTION_ENABLED = 'false';
    process.env.AI_CLICKBAIT_DETECTION_ENABLED = 'false';
    process.env.AI_STORY_GROUPING_ENABLED = 'false';
    process.env.AI_SUMMARY_GENERATION_ENABLED = 'false';
    process.env.AI_PODCAST_GENERATION_ENABLED = 'false';

    const { getAiFeatures } = require('./aiFeatures');

    expect(getAiFeatures()).toEqual({
      ai: {
        topicDetectionEnabled: false,
        clickbaitDetectionEnabled: false,
        storyGroupingEnabled: false,
        thematicSummariesEnabled: false,
        podcastsEnabled: false
      }
    });
  });

  test('treats explicit true as enabled when OpenRouter is configured', () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.AI_TOPIC_DETECTION_ENABLED = 'true';
    process.env.AI_CLICKBAIT_DETECTION_ENABLED = 'true';
    process.env.AI_STORY_GROUPING_ENABLED = 'true';

    const { getAiFeatures } = require('./aiFeatures');

    expect(getAiFeatures().ai.topicDetectionEnabled).toBe(true);
    expect(getAiFeatures().ai.clickbaitDetectionEnabled).toBe(true);
    expect(getAiFeatures().ai.storyGroupingEnabled).toBe(true);
  });

  test('does not accept auto or legacy true-like or false-like toggle values', () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.AI_TOPIC_DETECTION_ENABLED = 'auto';
    process.env.AI_CLICKBAIT_DETECTION_ENABLED = 'maybe';
    process.env.AI_STORY_GROUPING_ENABLED = '1';
    process.env.AI_SUMMARY_GENERATION_ENABLED = 'yes';
    process.env.AI_PODCAST_GENERATION_ENABLED = '0';

    const { getAiFeatures } = require('./aiFeatures');

    expect(getAiFeatures()).toEqual({
      ai: {
        topicDetectionEnabled: false,
        clickbaitDetectionEnabled: false,
        storyGroupingEnabled: false,
        thematicSummariesEnabled: false,
        podcastsEnabled: false
      }
    });
  });
});
