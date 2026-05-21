describe('thematicSummaryService', () => {
  let thematicSummaryService;

  beforeEach(() => {
    jest.resetModules();
    thematicSummaryService = require('./thematicSummaryService');
  });

  afterEach(() => {
    thematicSummaryService.stopScheduler();
  });

  test('builds the 07:00 window from the previous 19:00 slot', () => {
    const window = thematicSummaryService._getLatestDueWindow(new Date(2026, 4, 21, 7, 5));

    expect(window).toEqual({
      periodStart: new Date(2026, 4, 20, 19, 0, 0, 0).toISOString(),
      periodEnd: new Date(2026, 4, 21, 7, 0, 0, 0).toISOString()
    });
  });

  test('builds the 13:00 and 19:00 same-day windows', () => {
    expect(thematicSummaryService._getLatestDueWindow(new Date(2026, 4, 21, 13, 10))).toEqual({
      periodStart: new Date(2026, 4, 21, 7, 0, 0, 0).toISOString(),
      periodEnd: new Date(2026, 4, 21, 13, 0, 0, 0).toISOString()
    });
    expect(thematicSummaryService._getLatestDueWindow(new Date(2026, 4, 21, 19, 1))).toEqual({
      periodStart: new Date(2026, 4, 21, 13, 0, 0, 0).toISOString(),
      periodEnd: new Date(2026, 4, 21, 19, 0, 0, 0).toISOString()
    });
  });

  test('keeps entertainment and science as separate summaries', () => {
    const topicKeys = thematicSummaryService._getSummaryTopics().map((topic) => topic.key);

    expect(topicKeys).toEqual(['technology', 'politics', 'crime', 'sport', 'entertainment', 'science']);
  });

  test('builds the next due window for reader prewarm', () => {
    expect(thematicSummaryService._getNextDueWindow(new Date(2026, 4, 21, 6, 30))).toEqual({
      periodStart: new Date(2026, 4, 20, 19, 0, 0, 0).toISOString(),
      periodEnd: new Date(2026, 4, 21, 7, 0, 0, 0).toISOString()
    });
    expect(thematicSummaryService._getNextDueWindow(new Date(2026, 4, 21, 20, 0))).toEqual({
      periodStart: new Date(2026, 4, 21, 19, 0, 0, 0).toISOString(),
      periodEnd: new Date(2026, 4, 22, 7, 0, 0, 0).toISOString()
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
