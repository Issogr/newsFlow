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

function mockAiPodcastGenerator(overrides = {}) {
  const mock = {
    generatePodcastForArticles: jest.fn().mockResolvedValue(null),
    generateItalianAudio: jest.fn().mockResolvedValue(null),
    _getScriptConfig: jest.fn(() => ({ model: 'test-summary-model' })),
    _getTtsConfig: jest.fn(() => ({ apiKey: 'test-key', enabled: true, model: 'test-tts-model' })),
    _getTtsVoice: jest.fn(() => 'Charon'),
    ...overrides
  };

  jest.doMock('./aiPodcastGenerator', () => mock);
  return mock;
}

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
      pubDate: '2026-05-21T04:00:00.000Z',
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
    const firstReferenceDate = new Date('2026-05-21T04:45:00.000Z');
    const window = service._getNextDueWindow(firstReferenceDate);

    await expect(service.prewarmReaderCacheForDueWindow({
      referenceDate: firstReferenceDate,
      window
    })).resolves.toMatchObject({ attemptedCount: 1, cachedCount: 1 });
    await expect(service.prewarmReaderCacheForDueWindow({
      referenceDate: new Date('2026-05-21T04:50:00.000Z'),
      window
    })).resolves.toMatchObject({ attemptedCount: 0 });

    expect(readerServiceMock.getReaderArticle).toHaveBeenCalledTimes(1);
    expect(readerServiceMock.getReaderArticle).toHaveBeenCalledWith('article-1', {
      userId: null,
      maxArticleAgeHours: null
    });
  });

  test('retains prewarm attempts only for the current and next summary windows', async () => {
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
      pubDate: '2026-05-21T04:00:00.000Z',
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
    const firstReference = new Date('2026-05-21T04:45:00.000Z');
    const secondReference = new Date('2026-05-21T10:45:00.000Z');
    const thirdReference = new Date('2026-05-21T16:45:00.000Z');

    await service.prewarmReaderCacheForDueWindow({
      force: true,
      referenceDate: firstReference,
      window: service._getNextDueWindow(firstReference)
    });
    await service.prewarmReaderCacheForDueWindow({
      force: true,
      referenceDate: secondReference,
      window: service._getNextDueWindow(secondReference)
    });

    expect(service._getPrewarmAttemptWindowCount()).toBe(2);

    service._prunePrewarmAttempts(thirdReference);

    expect(service._getPrewarmAttemptWindowCount()).toBe(1);

    await service.prewarmReaderCacheForDueWindow({
      force: true,
      referenceDate: thirdReference,
      window: service._getNextDueWindow(thirdReference)
    });

    expect(service._getPrewarmAttemptWindowCount()).toBe(2);
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
      getPodcastSummary: jest.fn(() => null),
      upsertPodcastSummary: jest.fn(),
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
    mockAiPodcastGenerator();
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
      getPodcastSummary: jest.fn(() => null),
      upsertPodcastSummary: jest.fn(),
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
    mockAiPodcastGenerator();
    jest.doMock('./readerService', () => ({ getReaderArticle: jest.fn() }));
    jest.doMock('./websocketService', () => websocketServiceMock);
    jest.doMock('../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }));

    const service = require('./thematicSummaryService');
    const result = await service.generateDueSummaries({ window: summaryWindow });

    expect(result.items).toEqual([existingSummary]);
    expect(aiSummaryGeneratorMock.generateSummaryForArticles).not.toHaveBeenCalled();
    expect(websocketServiceMock.broadcastFeedRefresh).not.toHaveBeenCalled();
  });

  test('does not retry recently failed summaries on every scheduler tick', async () => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      OPENROUTER_API_KEY: 'test-key',
      AI_SUMMARY_FAILED_RETRY_COOLDOWN_MS: String(10 * 60 * 1000)
    };

    const summaryWindow = {
      periodStart: '2026-05-20T17:00:00.000Z',
      periodEnd: '2026-05-21T05:00:00.000Z'
    };
    const failedSummary = {
      topicKey: 'technology',
      status: 'failed',
      periodStart: summaryWindow.periodStart,
      periodEnd: summaryWindow.periodEnd,
      generatedAt: '2026-05-21T05:00:00.000Z'
    };
    const existingPodcastSummary = { id: 'podcast-existing', status: 'completed' };
    const databaseMock = {
      getThematicSummary: jest.fn((topicKey) => (topicKey === 'technology' ? failedSummary : null)),
      listLatestThematicSummaries: jest.fn(() => []),
      getPodcastSummary: jest.fn(() => existingPodcastSummary),
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
    mockAiPodcastGenerator();
    jest.doMock('./readerService', () => ({ getReaderArticle: jest.fn() }));
    jest.doMock('./websocketService', () => websocketServiceMock);
    jest.doMock('../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }));

    const service = require('./thematicSummaryService');
    const result = await service.generateDueSummaries({
      window: summaryWindow,
      referenceDate: new Date('2026-05-21T05:01:00.000Z')
    });

    expect(result.items).toEqual([existingPodcastSummary]);
    expect(databaseMock.getArticlesForThematicSummary).toHaveBeenCalled();
    expect(databaseMock.getArticlesForThematicSummary).not.toHaveBeenCalledWith(expect.objectContaining({ topics: ['Tecnologia'] }));
    expect(aiSummaryGeneratorMock.generateSummaryForArticles).not.toHaveBeenCalled();
    expect(websocketServiceMock.broadcastFeedRefresh).not.toHaveBeenCalled();
  });

  test('generates the podcast from the deduplicated summary prewarm article set', async () => {
    jest.resetModules();

    const summaryWindow = {
      periodStart: '2026-05-20T17:00:00.000Z',
      periodEnd: '2026-05-21T05:00:00.000Z'
    };
    const articleOne = {
      id: 'article-1',
      source: 'BBC',
      title: 'AI update',
      description: 'AI update description',
      url: 'https://example.com/ai',
      pubDate: '2026-05-20T18:00:00.000Z'
    };
    const articleTwo = {
      id: 'article-2',
      source: 'Wired',
      title: 'Science update',
      description: 'Science RSS description',
      url: 'https://example.com/science',
      pubDate: '2026-05-20T19:00:00.000Z'
    };
    const databaseMock = {
      getPodcastSummary: jest.fn(() => null),
      getArticlesForThematicSummary: jest.fn(({ topics }) => {
        if (topics.includes('Tecnologia')) {
          return [articleOne];
        }
        if (topics.includes('Scienza')) {
          return [articleOne, articleTwo];
        }
        return [];
      }),
      getReaderCache: jest.fn((articleId) => articleId === 'article-2'
        ? { contentText: 'Useful cached reader text. '.repeat(20) }
        : null),
      upsertPodcastSummary: jest.fn((payload) => ({ ...payload, type: 'podcast', status: 'completed' }))
    };
    const aiPodcastGeneratorMock = mockAiPodcastGenerator({
      generatePodcastForArticles: jest.fn().mockResolvedValue({
        title: 'News podcast',
        scriptText: 'English script',
        titleByLocale: { en: 'News podcast', it: 'Podcast news' },
        scriptTextByLocale: { en: 'English script', it: 'Testo italiano' },
        model: 'test-summary-model',
        audio: null,
        audioStatus: 'not_available',
        audioErrorMessage: ''
      })
    });

    jest.doMock('./database', () => databaseMock);
    jest.doMock('./aiSummaryGenerator', () => ({
      isAiSummaryGenerationAvailable: jest.fn(() => true),
      _getConfig: jest.fn(() => ({ model: 'test-summary-model' }))
    }));
    jest.doMock('./readerService', () => ({ getReaderArticle: jest.fn() }));
    jest.doMock('./websocketService', () => ({ broadcastFeedRefresh: jest.fn() }));
    jest.doMock('../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }));

    const service = require('./thematicSummaryService');
    const result = await service._generatePodcastForWindow(summaryWindow);

    expect(result.generatedNow).toBe(true);
    expect(aiPodcastGeneratorMock.generatePodcastForArticles).toHaveBeenCalledTimes(1);
    const generatedArticles = aiPodcastGeneratorMock.generatePodcastForArticles.mock.calls[0][1];
    expect(generatedArticles.map((article) => article.id)).toEqual(['article-2', 'article-1']);
    expect(generatedArticles[0].readerText).toContain('Useful cached reader text.');
    expect(databaseMock.upsertPodcastSummary).toHaveBeenCalledWith(expect.objectContaining({
      articleCount: 2,
      sources: expect.arrayContaining([
        expect.objectContaining({ articleId: 'article-1' }),
        expect.objectContaining({ articleId: 'article-2' })
      ]),
      scriptTextByLocale: expect.objectContaining({ it: 'Testo italiano' }),
      status: 'completed'
    }));
  });

  test('retries missing podcast audio using the stored Italian script without regenerating text', async () => {
    jest.resetModules();

    const summaryWindow = {
      periodStart: '2026-05-20T17:00:00.000Z',
      periodEnd: '2026-05-21T05:00:00.000Z'
    };
    const existingPodcast = {
      id: 'podcast-existing',
      type: 'podcast',
      topicKey: 'podcast',
      status: 'completed',
      audioStatus: 'failed',
      periodStart: summaryWindow.periodStart,
      periodEnd: summaryWindow.periodEnd,
      title: 'News podcast',
      titleByLocale: { en: 'News podcast', it: 'Podcast news' },
      summaryText: 'English script',
      summaryTextByLocale: { en: 'English script', it: 'Testo italiano gia generato' },
      sources: [{ index: 1, articleId: 'article-1', title: 'AI update', source: 'BBC' }],
      articleCount: 1,
      model: 'test-summary-model',
      generatedAt: '2026-05-21T05:00:00.000Z'
    };
    const completedPodcast = {
      ...existingPodcast,
      audioStatus: 'completed',
      audioUrl: '/api/podcast-summary/podcast-existing/audio'
    };
    const databaseMock = {
      getPodcastSummary: jest.fn(() => existingPodcast),
      getArticlesForThematicSummary: jest.fn(() => []),
      getReaderCache: jest.fn(() => null),
      upsertPodcastSummary: jest.fn(() => completedPodcast)
    };
    const aiPodcastGeneratorMock = mockAiPodcastGenerator({
      generateItalianAudio: jest.fn().mockResolvedValue({
        data: Buffer.from('audio').toString('base64'),
        mimeType: 'audio/mpeg',
        model: 'test-tts-model',
        voice: 'Charon'
      })
    });

    jest.doMock('./database', () => databaseMock);
    jest.doMock('./aiSummaryGenerator', () => ({
      isAiSummaryGenerationAvailable: jest.fn(() => true),
      _getConfig: jest.fn(() => ({ model: 'test-summary-model' }))
    }));
    jest.doMock('./readerService', () => ({ getReaderArticle: jest.fn() }));
    jest.doMock('./websocketService', () => ({ broadcastFeedRefresh: jest.fn() }));
    jest.doMock('../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }));

    const service = require('./thematicSummaryService');
    const result = await service._generatePodcastForWindow(summaryWindow, {
      referenceDate: new Date('2026-05-21T05:20:00.000Z')
    });

    expect(result).toEqual({ summary: completedPodcast, generatedNow: true });
    expect(aiPodcastGeneratorMock.generatePodcastForArticles).not.toHaveBeenCalled();
    expect(aiPodcastGeneratorMock.generateItalianAudio).toHaveBeenCalledWith('Testo italiano gia generato');
    expect(databaseMock.upsertPodcastSummary).toHaveBeenCalledWith(expect.objectContaining({
      id: 'podcast-existing',
      titleByLocale: existingPodcast.titleByLocale,
      scriptTextByLocale: existingPodcast.summaryTextByLocale,
      audioStatus: 'completed',
      audioModel: 'test-tts-model',
      audioVoice: 'Charon',
      status: 'completed'
    }));
  });

  test('broadcasts podcast audio retry progress and failure states', async () => {
    jest.resetModules();

    const summaryWindow = {
      periodStart: '2026-05-20T17:00:00.000Z',
      periodEnd: '2026-05-21T05:00:00.000Z'
    };
    const existingPodcast = {
      id: 'podcast-existing',
      type: 'podcast',
      topicKey: 'podcast',
      status: 'completed',
      audioStatus: 'not_available',
      periodStart: summaryWindow.periodStart,
      periodEnd: summaryWindow.periodEnd,
      title: 'News podcast',
      titleByLocale: { en: 'News podcast', it: 'Podcast news' },
      summaryText: 'English script',
      summaryTextByLocale: { en: 'English script', it: 'Testo italiano gia generato' },
      sources: [{ index: 1, articleId: 'article-1', title: 'AI update', source: 'BBC' }],
      articleCount: 1,
      model: 'test-summary-model',
      generatedAt: '2026-05-21T05:00:00.000Z'
    };
    const databaseMock = {
      getPodcastSummary: jest.fn(() => existingPodcast),
      getArticlesForThematicSummary: jest.fn(() => []),
      getReaderCache: jest.fn(() => null),
      upsertPodcastSummary: jest.fn((payload) => ({ ...payload, type: 'podcast' }))
    };
    const aiPodcastGeneratorMock = mockAiPodcastGenerator({
      generateItalianAudio: jest.fn().mockRejectedValue(new Error('Provider rejected audio'))
    });
    const websocketServiceMock = { broadcastFeedRefresh: jest.fn() };

    jest.doMock('./database', () => databaseMock);
    jest.doMock('./aiSummaryGenerator', () => ({
      isAiSummaryGenerationAvailable: jest.fn(() => true),
      _getConfig: jest.fn(() => ({ model: 'test-summary-model' }))
    }));
    jest.doMock('./readerService', () => ({ getReaderArticle: jest.fn() }));
    jest.doMock('./websocketService', () => websocketServiceMock);
    jest.doMock('../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }));

    const service = require('./thematicSummaryService');
    const result = await service._generatePodcastForWindow(summaryWindow);

    expect(result.summary).toEqual(expect.objectContaining({
      audioStatus: 'failed',
      audioErrorMessage: 'Provider rejected audio'
    }));
    expect(result.generatedNow).toBe(false);
    expect(aiPodcastGeneratorMock.generatePodcastForArticles).not.toHaveBeenCalled();
    expect(aiPodcastGeneratorMock.generateItalianAudio).toHaveBeenCalledWith('Testo italiano gia generato');
    expect(databaseMock.upsertPodcastSummary).toHaveBeenNthCalledWith(1, expect.objectContaining({
      audioStatus: 'generating',
      audioModel: 'test-tts-model',
      audioVoice: 'Charon'
    }));
    expect(databaseMock.upsertPodcastSummary).toHaveBeenNthCalledWith(2, expect.objectContaining({
      audioStatus: 'failed',
      audioErrorMessage: 'Provider rejected audio',
      audioModel: 'test-tts-model',
      audioVoice: 'Charon'
    }));
    expect(websocketServiceMock.broadcastFeedRefresh).toHaveBeenCalledTimes(2);
    expect(websocketServiceMock.broadcastFeedRefresh).toHaveBeenNthCalledWith(1, { reason: 'summaries' });
    expect(websocketServiceMock.broadcastFeedRefresh).toHaveBeenNthCalledWith(2, { reason: 'summaries' });
  });

  test('regenerates completed podcast audio when the stored voice is stale', async () => {
    jest.resetModules();

    const summaryWindow = {
      periodStart: '2026-05-20T17:00:00.000Z',
      periodEnd: '2026-05-21T05:00:00.000Z'
    };
    const existingPodcast = {
      id: 'podcast-existing',
      type: 'podcast',
      topicKey: 'podcast',
      status: 'completed',
      audioStatus: 'completed',
      audioModel: 'test-tts-model',
      audioVoice: 'if_sara',
      periodStart: summaryWindow.periodStart,
      periodEnd: summaryWindow.periodEnd,
      title: 'News podcast',
      titleByLocale: { en: 'News podcast', it: 'Podcast news' },
      summaryText: 'English script',
      summaryTextByLocale: { en: 'English script', it: 'Testo italiano gia generato' },
      sources: [{ index: 1, articleId: 'article-1', title: 'AI update', source: 'BBC' }],
      articleCount: 1,
      model: 'test-summary-model',
      generatedAt: '2026-05-21T05:00:00.000Z'
    };
    const databaseMock = {
      getPodcastSummary: jest.fn(() => existingPodcast),
      getArticlesForThematicSummary: jest.fn(() => []),
      getReaderCache: jest.fn(() => null),
      upsertPodcastSummary: jest.fn((payload) => ({ ...existingPodcast, ...payload, audioStatus: 'completed' }))
    };
    const aiPodcastGeneratorMock = mockAiPodcastGenerator({
      generateItalianAudio: jest.fn().mockResolvedValue({
        data: Buffer.from('audio').toString('base64'),
        mimeType: 'audio/mpeg',
        model: 'test-tts-model',
        voice: 'Charon'
      })
    });

    jest.doMock('./database', () => databaseMock);
    jest.doMock('./aiSummaryGenerator', () => ({
      isAiSummaryGenerationAvailable: jest.fn(() => true),
      _getConfig: jest.fn(() => ({ model: 'test-summary-model' }))
    }));
    jest.doMock('./readerService', () => ({ getReaderArticle: jest.fn() }));
    jest.doMock('./websocketService', () => ({ broadcastFeedRefresh: jest.fn() }));
    jest.doMock('../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }));

    const service = require('./thematicSummaryService');
    const result = await service._generatePodcastForWindow(summaryWindow);

    expect(result.generatedNow).toBe(true);
    expect(aiPodcastGeneratorMock.generatePodcastForArticles).not.toHaveBeenCalled();
    expect(aiPodcastGeneratorMock.generateItalianAudio).toHaveBeenCalledWith('Testo italiano gia generato');
    expect(databaseMock.upsertPodcastSummary).toHaveBeenCalledWith(expect.objectContaining({
      audioStatus: 'completed',
      audioVoice: 'Charon'
    }));
  });
});
