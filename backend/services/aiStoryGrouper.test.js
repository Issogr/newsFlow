describe('aiStoryGrouper', () => {
  let aiStoryGrouper;
  let sendMock;

  beforeEach(() => {
    jest.resetModules();
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.OPENROUTER_STORY_GROUPING_MODEL = 'test-story-grouping-model';
    sendMock = jest.fn(async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              matches: [
                { id: 'candidate-1', confidence: 0.91, reason: 'same meeting and policy topics' },
                { id: 'candidate-2', confidence: 0.5, reason: 'same broad topic only' }
              ]
            })
          }
        }
      ]
    }));
    aiStoryGrouper = require('./aiStoryGrouper');
    aiStoryGrouper._setOpenRouterSdkLoader(async () => ({
      OpenRouter: jest.fn(() => ({
        chat: { send: sendMock }
      }))
    }));
  });

  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_STORY_GROUPING_MODEL;
    delete process.env.AI_STORY_GROUPING_REQUEST_TIMEOUT_MS;
    delete process.env.AI_SUMMARY_REQUEST_TIMEOUT_MS;
  });

  test('uses the story grouping model to classify candidate story matches', async () => {
    const result = await aiStoryGrouper.findSimilarStoriesForArticle({
      id: 'target-1',
      title: 'Meloni meets Trump in Rome',
      description: 'Talks focused on tariffs and Ukraine.',
      source: 'Source A',
      url: 'https://example.com/meloni-trump-rome',
      pubDate: '2026-03-15T14:30:00.000Z'
    }, [
      {
        id: 'candidate-1',
        title: 'Tariffs and Ukraine at Trump Meloni summit',
        description: 'The two leaders met in the Italian capital.',
        source: 'Source B',
        url: 'https://example.com/trump-meloni-summit',
        pubDate: '2026-03-15T14:10:00.000Z'
      },
      {
        id: 'candidate-2',
        title: 'Markets move after tariff remarks',
        description: 'Investors reacted to new policy comments.',
        source: 'Source C',
        pubDate: '2026-03-15T14:20:00.000Z'
      }
    ]);

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      chatRequest: expect.objectContaining({
        model: 'test-story-grouping-model',
        responseFormat: { type: 'json_object' }
      })
    }), expect.any(Object));
    const userPrompt = sendMock.mock.calls[0][0].chatRequest.messages[1].content;
    const promptPayload = JSON.parse(userPrompt.split('\n').pop());
    expect(Object.keys(promptPayload.target).sort()).toEqual(['description', 'id', 'publishedAt', 'title', 'topics']);
    expect(Object.keys(promptPayload.candidates[0]).sort()).toEqual(['description', 'id', 'publishedAt', 'title', 'topics']);
    expect(result).toEqual(expect.objectContaining({
      model: 'test-story-grouping-model',
      matches: [{ articleId: 'candidate-1', confidence: 0.91, reason: 'same meeting and policy topics' }]
    }));
  });

  test('filters candidates before calling the model', async () => {
    const result = await aiStoryGrouper.findSimilarStoriesForArticle({
      id: 'target-1',
      title: 'Volcano eruption in Iceland',
      description: 'Lava flows near Grindavik.'
    }, [
      {
        id: 'candidate-1',
        title: 'Football transfer market update',
        description: 'A striker may join a new club.'
      }
    ]);

    expect(result).toEqual(expect.objectContaining({ skipped: 'no_candidates', matches: [] }));
    expect(sendMock).not.toHaveBeenCalled();
  });

  test('defaults to DeepSeek flash when the story grouping model env var is unset', () => {
    delete process.env.OPENROUTER_STORY_GROUPING_MODEL;

    expect(aiStoryGrouper._getConfig()).toEqual(expect.objectContaining({
      model: 'deepseek/deepseek-v4-flash'
    }));
  });

  test('uses story-grouping-specific timeout instead of summary timeout', () => {
    process.env.AI_SUMMARY_REQUEST_TIMEOUT_MS = '9000';
    process.env.AI_STORY_GROUPING_REQUEST_TIMEOUT_MS = '7000';

    expect(aiStoryGrouper._getConfig()).toEqual(expect.objectContaining({
      timeoutMs: 7000
    }));
  });
});
