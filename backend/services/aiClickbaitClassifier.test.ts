const createMockLogger = require('../test-utils/mockLogger');
import type { Mock } from 'vitest';

jest.mock('../utils/logger', createMockLogger);

const aiClickbaitClassifier = require('./aiClickbaitClassifier');

describe('aiClickbaitClassifier', () => {
  const originalEnv = process.env;
  let chatSend: Mock;
  let OpenRouterMock: Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    chatSend = jest.fn();
    OpenRouterMock = jest.fn(() => ({
      chat: {
        send: chatSend
      }
    }));
    aiClickbaitClassifier._setOpenRouterSdkLoader(async () => ({ OpenRouter: OpenRouterMock }));
    process.env = {
      ...originalEnv,
      OPENROUTER_API_KEY: 'test-key',
      OPENROUTER_TOPIC_MODEL: 'topic-classifier-model',
      OPENROUTER_CLICKBAIT_MODEL: undefined,
      AI_CLICKBAIT_DETECTION_ENABLED: 'true',
      AI_CLICKBAIT_REQUEST_TIMEOUT_MS: undefined,
      AI_TOPIC_BATCH_SIZE: undefined,
      AI_TOPIC_BATCH_CONCURRENCY: undefined,
      AI_TOPIC_MAX_ARTICLES_PER_REFRESH: undefined,
      AI_TOPIC_DETERMINISTIC_SKIP_ENABLED: 'false'
    };
  });

  afterEach(() => {
    aiClickbaitClassifier._setOpenRouterSdkLoader();
    process.env = originalEnv;
  });

  test('uses dedicated enable and model env vars while defaulting to the topic model', () => {
    expect(aiClickbaitClassifier._getConfig()).toEqual(expect.objectContaining({
      enabled: true,
      model: 'topic-classifier-model'
    }));

    process.env.OPENROUTER_CLICKBAIT_MODEL = 'clickbait-classifier-model';
    process.env.AI_CLICKBAIT_DETECTION_ENABLED = 'false';

    expect(aiClickbaitClassifier._getConfig()).toEqual(expect.objectContaining({
      enabled: false,
      model: 'clickbait-classifier-model'
    }));
  });

  test('skips the provider for high-confidence local clickbait labels', async () => {
    process.env.AI_TOPIC_DETERMINISTIC_SKIP_ENABLED = 'true';

    const status = await aiClickbaitClassifier.classifyClickbaitForArticlesWithStatus([
      {
        id: 'article-1',
        title: "You won't believe what happened next!!!",
        description: 'A teaser headline.'
      }
    ]);

    expect(chatSend).not.toHaveBeenCalled();
    expect(status.classificationsByArticleId.get('article-1')).toEqual(expect.objectContaining({
      label: 'high',
      source: 'local',
      reasonCode: 'local_clear_high'
    }));
  });

  test('uses AI for ambiguous labels with compact article payloads', async () => {
    process.env.OPENROUTER_CLICKBAIT_MODEL = 'clickbait-classifier-model';
    chatSend.mockResolvedValue({
      choices: [
        { message: { content: JSON.stringify({ clickbaitByRef: [{ ref: 1, label: 'medium', confidence: 0.82, score: 46 }] }) } }
      ]
    });

    const status = await aiClickbaitClassifier.classifyClickbaitForArticlesWithStatus([
      {
        id: 'article-1',
        source: 'Example Source',
        title: 'The reason markets moved today',
        description: 'Investors reacted to the policy update.',
        content: 'This full article body should not be sent to the model.'
      }
    ]);

    const requestBody = chatSend.mock.calls[0][0].chatRequest;
    const prompt = requestBody.messages[1].content;
    const promptPayload = JSON.parse(prompt.split('\n').at(-1));

    expect(status.classificationsByArticleId.get('article-1')).toEqual({
      label: 'medium',
      score: 46,
      confidence: 0.82,
      source: 'ai',
      reasonCode: 'ai_clickbait_label'
    });
    expect(requestBody.model).toBe('clickbait-classifier-model');
    expect(requestBody.responseFormat).toEqual({ type: 'json_object' });
    expect(prompt).toContain('low, medium, or high');
    expect(prompt).toContain('Return refs, not article ids');
    expect(promptPayload.articles[0]).toEqual({
      ref: 1,
      title: 'The reason markets moved today',
      description: 'Investors reacted to the policy update.'
    });
    expect(prompt).not.toContain('article-1');
    expect(prompt).not.toContain('Example Source');
    expect(prompt).not.toContain('This full article body should not be sent');
  });

  test('returns no labels when the dedicated feature toggle is disabled', async () => {
    process.env.AI_CLICKBAIT_DETECTION_ENABLED = 'false';
    process.env.AI_TOPIC_DETERMINISTIC_SKIP_ENABLED = 'true';

    const status = await aiClickbaitClassifier.classifyClickbaitForArticlesWithStatus([
      { id: 'article-1', title: "You won't believe what happened next!!!" }
    ]);

    expect(chatSend).not.toHaveBeenCalled();
    expect(status.classificationsByArticleId.size).toBe(0);
    expect(status.cappedArticleIds).toEqual(['article-1']);
  });
});
