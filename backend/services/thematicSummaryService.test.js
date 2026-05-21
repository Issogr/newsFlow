describe('thematicSummaryService', () => {
  const originalEnv = process.env;
  let thematicSummaryService;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      AI_SUMMARY_TIME_ZONE: 'Europe/Rome'
    };
    thematicSummaryService = require('./thematicSummaryService');
  });

  afterEach(() => {
    thematicSummaryService.stopScheduler();
    process.env = originalEnv;
  });

  test('builds the 07:00 window from the previous 19:00 slot', () => {
    const window = thematicSummaryService._getLatestDueWindow(new Date('2026-05-21T05:05:00.000Z'));

    expect(window).toEqual({
      periodStart: '2026-05-20T17:00:00.000Z',
      periodEnd: '2026-05-21T05:00:00.000Z'
    });
  });

  test('builds the 13:00 and 19:00 same-day windows', () => {
    expect(thematicSummaryService._getLatestDueWindow(new Date('2026-05-21T11:10:00.000Z'))).toEqual({
      periodStart: '2026-05-21T05:00:00.000Z',
      periodEnd: '2026-05-21T11:00:00.000Z'
    });
    expect(thematicSummaryService._getLatestDueWindow(new Date('2026-05-21T17:01:00.000Z'))).toEqual({
      periodStart: '2026-05-21T11:00:00.000Z',
      periodEnd: '2026-05-21T17:00:00.000Z'
    });
  });

  test('defaults summary scheduling to Europe/Rome instead of the container UTC clock', () => {
    expect(thematicSummaryService._getSummaryTimeZone()).toBe('Europe/Rome');
    expect(thematicSummaryService._getLatestDueWindow(new Date('2026-01-21T06:05:00.000Z'))).toEqual({
      periodStart: '2026-01-20T18:00:00.000Z',
      periodEnd: '2026-01-21T06:00:00.000Z'
    });
  });

  test('keeps entertainment and science as separate summaries', () => {
    const topicKeys = thematicSummaryService._getSummaryTopics().map((topic) => topic.key);

    expect(topicKeys).toEqual(['technology', 'politics', 'crime', 'sport', 'entertainment', 'science']);
  });

  test('builds the next due window for reader prewarm', () => {
    expect(thematicSummaryService._getNextDueWindow(new Date('2026-05-21T04:30:00.000Z'))).toEqual({
      periodStart: '2026-05-20T17:00:00.000Z',
      periodEnd: '2026-05-21T05:00:00.000Z'
    });
    expect(thematicSummaryService._getNextDueWindow(new Date('2026-05-21T18:00:00.000Z'))).toEqual({
      periodStart: '2026-05-21T17:00:00.000Z',
      periodEnd: '2026-05-22T05:00:00.000Z'
    });
  });
});

describe('thematic summary reader prewarm', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
  });

  test('prewarms uncached candidate reader content without retrying the same article in the same window', async () => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      OPENROUTER_API_KEY: 'test-key',
      AI_SUMMARY_READER_PREWARM_ENABLED: 'auto'
    };

    const article = {
      id: 'article-1',
      source: 'BBC',
      title: 'Science update',
      description: 'Short RSS text',
      url: 'https://example.com/science',
      pubDate: new Date(2026, 4, 21, 6, 0).toISOString(),
      topics: ['Scienza']
    };
    const databaseMock = {
      getThematicSummary: jest.fn(),
      listLatestThematicSummaries: jest.fn(() => []),
      getArticlesForThematicSummary: jest.fn(({ topics }) => topics.includes('Scienza') ? [article] : []),
      getReaderCache: jest.fn(() => null)
    };
    const readerServiceMock = {
      getReaderArticle: jest.fn().mockResolvedValue({
        articleId: 'article-1',
        contentText: 'Useful reader content '.repeat(30),
        fallback: false
      })
    };

    jest.doMock('./database', () => databaseMock);
    jest.doMock('./readerService', () => readerServiceMock);
    jest.doMock('./websocketService', () => ({ broadcastFeedRefresh: jest.fn() }));
    jest.doMock('../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }));

    const service = require('./thematicSummaryService');
    const window = {
      periodStart: new Date(2026, 4, 20, 19, 0).toISOString(),
      periodEnd: new Date(2026, 4, 21, 7, 0).toISOString()
    };

    await expect(service.prewarmReaderCacheForDueWindow({
      referenceDate: new Date(2026, 4, 21, 6, 45),
      window
    })).resolves.toMatchObject({ attemptedCount: 1, cachedCount: 1 });
    await expect(service.prewarmReaderCacheForDueWindow({
      referenceDate: new Date(2026, 4, 21, 6, 50),
      window
    })).resolves.toMatchObject({ attemptedCount: 0 });

    expect(readerServiceMock.getReaderArticle).toHaveBeenCalledTimes(1);
    expect(readerServiceMock.getReaderArticle).toHaveBeenCalledWith('article-1', {
      userId: null,
      maxArticleAgeHours: null
    });
  });
});

describe('thematic summary generation retries', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
  });

  test('retries failed summary rows and broadcasts only newly completed summaries', async () => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      OPENROUTER_API_KEY: 'test-key'
    };

    const summaryWindow = {
      periodStart: '2026-05-20T17:00:00.000Z',
      periodEnd: '2026-05-21T05:00:00.000Z'
    };
    const failedSummary = {
      topicKey: 'technology',
      status: 'failed',
      periodStart: summaryWindow.periodStart,
      periodEnd: summaryWindow.periodEnd
    };
    const completedSummary = {
      ...failedSummary,
      status: 'completed',
      summaryTextByLocale: { en: 'English text', it: 'Testo italiano' }
    };
    const article = {
      id: 'article-1',
      source: 'BBC',
      title: 'AI update',
      description: 'AI update description',
      url: 'https://example.com/ai',
      pubDate: '2026-05-20T18:00:00.000Z'
    };
    const databaseMock = {
      getThematicSummary: jest.fn((topicKey) => (topicKey === 'technology' ? failedSummary : null)),
      listLatestThematicSummaries: jest.fn(() => []),
      getArticlesForThematicSummary: jest.fn(({ topics }) => topics.includes('Tecnologia') ? [article] : []),
      getReaderCache: jest.fn(() => null),
      upsertThematicSummary: jest.fn(() => completedSummary)
    };
    const aiSummaryGeneratorMock = {
      isAiSummaryGenerationAvailable: jest.fn(() => true),
      generateSummaryForArticles: jest.fn().mockResolvedValue({
        title: 'AI briefing',
        summaryText: 'English text',
        titleByLocale: { en: 'AI briefing', it: 'Briefing AI' },
        summaryTextByLocale: { en: 'English text', it: 'Testo italiano' },
        model: 'test-model'
      }),
      _getConfig: jest.fn(() => ({ model: 'test-model' }))
    };
    const websocketServiceMock = { broadcastFeedRefresh: jest.fn() };

    jest.doMock('./database', () => databaseMock);
    jest.doMock('./aiSummaryGenerator', () => aiSummaryGeneratorMock);
    jest.doMock('./readerService', () => ({ getReaderArticle: jest.fn() }));
    jest.doMock('./websocketService', () => websocketServiceMock);
    jest.doMock('../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }));

    const service = require('./thematicSummaryService');
    const result = await service.generateDueSummaries({ window: summaryWindow });

    expect(result.items).toEqual([completedSummary]);
    expect(aiSummaryGeneratorMock.generateSummaryForArticles).toHaveBeenCalledTimes(1);
    expect(databaseMock.upsertThematicSummary).toHaveBeenCalledWith(expect.objectContaining({
      topicKey: 'technology',
      status: 'completed'
    }));
    expect(websocketServiceMock.broadcastFeedRefresh).toHaveBeenCalledWith({ reason: 'summaries' });
  });

  test('does not broadcast when all due summaries already exist', async () => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      OPENROUTER_API_KEY: 'test-key'
    };

    const summaryWindow = {
      periodStart: '2026-05-20T17:00:00.000Z',
      periodEnd: '2026-05-21T05:00:00.000Z'
    };
    const existingSummary = {
      topicKey: 'technology',
      status: 'completed',
      periodStart: summaryWindow.periodStart,
      periodEnd: summaryWindow.periodEnd
    };
    const databaseMock = {
      getThematicSummary: jest.fn((topicKey) => (topicKey === 'technology' ? existingSummary : null)),
      listLatestThematicSummaries: jest.fn(() => []),
      getArticlesForThematicSummary: jest.fn(() => []),
      getReaderCache: jest.fn(() => null),
      upsertThematicSummary: jest.fn()
    };
    const aiSummaryGeneratorMock = {
      isAiSummaryGenerationAvailable: jest.fn(() => true),
      generateSummaryForArticles: jest.fn(),
      _getConfig: jest.fn(() => ({ model: 'test-model' }))
    };
    const websocketServiceMock = { broadcastFeedRefresh: jest.fn() };

    jest.doMock('./database', () => databaseMock);
    jest.doMock('./aiSummaryGenerator', () => aiSummaryGeneratorMock);
    jest.doMock('./readerService', () => ({ getReaderArticle: jest.fn() }));
    jest.doMock('./websocketService', () => websocketServiceMock);
    jest.doMock('../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }));

    const service = require('./thematicSummaryService');
    const result = await service.generateDueSummaries({ window: summaryWindow });

    expect(result.items).toEqual([existingSummary]);
    expect(aiSummaryGeneratorMock.generateSummaryForArticles).not.toHaveBeenCalled();
    expect(websocketServiceMock.broadcastFeedRefresh).not.toHaveBeenCalled();
  });
});
