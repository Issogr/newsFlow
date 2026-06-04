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
        storyGroupingEnabled: true,
        thematicSummariesEnabled: true,
        podcastsEnabled: true,
        podcastAudioEnabled: true
      }
    });
  });

  test('disables all AI features when OpenRouter is not configured', () => {
    delete process.env.OPENROUTER_API_KEY;

    const { getAiFeatures } = require('./aiFeatures');

    expect(getAiFeatures()).toEqual({
      ai: {
        topicDetectionEnabled: false,
        storyGroupingEnabled: false,
        thematicSummariesEnabled: false,
        podcastsEnabled: false,
        podcastAudioEnabled: false
      }
    });
  });

  test('allows each AI feature to be disabled independently with false', () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.AI_TOPIC_DETECTION_ENABLED = 'false';
    process.env.AI_STORY_GROUPING_ENABLED = 'false';
    process.env.AI_SUMMARY_GENERATION_ENABLED = 'false';
    process.env.AI_PODCAST_GENERATION_ENABLED = 'false';
    process.env.AI_PODCAST_TTS_ENABLED = 'false';

    const { getAiFeatures } = require('./aiFeatures');

    expect(getAiFeatures()).toEqual({
      ai: {
        topicDetectionEnabled: false,
        storyGroupingEnabled: false,
        thematicSummariesEnabled: false,
        podcastsEnabled: false,
        podcastAudioEnabled: false
      }
    });
  });

  test('treats true and auto as enabled when OpenRouter is configured', () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.AI_TOPIC_DETECTION_ENABLED = 'true';
    process.env.AI_STORY_GROUPING_ENABLED = 'auto';

    const { getAiFeatures } = require('./aiFeatures');

    expect(getAiFeatures().ai.topicDetectionEnabled).toBe(true);
    expect(getAiFeatures().ai.storyGroupingEnabled).toBe(true);
  });

  test('does not accept legacy true-like or false-like toggle values', () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.AI_TOPIC_DETECTION_ENABLED = '1';
    process.env.AI_STORY_GROUPING_ENABLED = 'yes';
    process.env.AI_SUMMARY_GENERATION_ENABLED = 'on';
    process.env.AI_PODCAST_GENERATION_ENABLED = '0';
    process.env.AI_PODCAST_TTS_ENABLED = 'off';

    const { getAiFeatures } = require('./aiFeatures');

    expect(getAiFeatures()).toEqual({
      ai: {
        topicDetectionEnabled: false,
        storyGroupingEnabled: false,
        thematicSummariesEnabled: false,
        podcastsEnabled: false,
        podcastAudioEnabled: false
      }
    });
  });
});
