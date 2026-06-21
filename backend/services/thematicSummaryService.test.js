const originalEnv = process.env;
const OPENROUTER_TEST_ENV = { OPENROUTER_API_KEY: 'test-key' };

function resetServiceRuntime(env = {}) {
  jest.resetModules();
  process.env = {
    ...originalEnv,
    AI_PODCAST_BACKGROUND_AUDIO_ENABLED: 'false',
    ...env
  };
}

function loadService({ env = {} } = {}) {
  resetServiceRuntime(env);
  return require('./thematicSummaryService');
}

afterEach(() => {
  process.env = originalEnv;
  jest.resetModules();
});

describe('thematicSummaryService', () => {
  let thematicSummaryService;

  beforeEach(() => {
    thematicSummaryService = loadService({
      env: {
        AI_SUMMARY_TIME_ZONE: 'Europe/Rome'
      }
    });
  });

  afterEach(() => {
    thematicSummaryService.stopScheduler();
  });

  test('builds the 08:00 window from the previous 20:00 slot', () => {
    const window = thematicSummaryService._getLatestDueWindow(new Date('2026-05-21T06:05:00.000Z'));

    expect(window).toEqual({
      periodStart: '2026-05-20T18:00:00.000Z',
      periodEnd: '2026-05-21T06:00:00.000Z'
    });
  });

  test('uses the same 08:00 and 20:00 schedule for summaries and podcasts', () => {
    expect(thematicSummaryService._getLatestDueWindow(new Date('2026-05-21T11:10:00.000Z'))).toEqual({
      periodStart: '2026-05-20T18:00:00.000Z',
      periodEnd: '2026-05-21T06:00:00.000Z'
    });
    expect(thematicSummaryService._getLatestDueWindow(new Date('2026-05-21T18:01:00.000Z'))).toEqual({
      periodStart: '2026-05-21T06:00:00.000Z',
      periodEnd: '2026-05-21T18:00:00.000Z'
    });
  });

  test('builds podcast windows for morning and evening only', () => {
    expect(thematicSummaryService._getLatestDuePodcastWindow(new Date('2026-05-21T11:10:00.000Z'))).toEqual({
      periodStart: '2026-05-20T18:00:00.000Z',
      periodEnd: '2026-05-21T06:00:00.000Z'
    });
    expect(thematicSummaryService._getLatestDuePodcastWindow(new Date('2026-05-21T18:01:00.000Z'))).toEqual({
      periodStart: '2026-05-21T06:00:00.000Z',
      periodEnd: '2026-05-21T18:00:00.000Z'
    });
  });

  test('defaults summary scheduling to Europe/Rome instead of the container UTC clock', () => {
    expect(thematicSummaryService._getSummaryTimeZone()).toBe('Europe/Rome');
    expect(thematicSummaryService._getLatestDueWindow(new Date('2026-01-21T07:05:00.000Z'))).toEqual({
      periodStart: '2026-01-20T19:00:00.000Z',
      periodEnd: '2026-01-21T07:00:00.000Z'
    });
  });

  test('keeps entertainment and science as separate summaries', () => {
    const topicKeys = thematicSummaryService._getSummaryTopics().map((topic) => topic.key);

    expect(topicKeys).toEqual(['technology', 'politics', 'crime', 'sport', 'entertainment', 'science']);
  });

  test('classifies promotional shopping deal posts without blocking price-related news', () => {
    expect(thematicSummaryService._isPromotionalDealArticle({
      title: 'Govee Table Lamp 2 Pro hits its lowest price yet',
      description: 'The TV OLED LG B5 is $1,499.99 with a $200 gift card at Best Buy.',
      url: 'https://example.com/deals/govee-lg-oled-best-buy'
    })).toBe(true);
    expect(thematicSummaryService._isPromotionalDealArticle({
      title: 'Twelve South AirFly Pro 2 reaches one of its best prices before summer travel',
      description: 'The Bluetooth adapter lets travelers use wireless headphones with in-flight entertainment systems.'
    })).toBe(true);
    expect(thematicSummaryService._isPromotionalDealArticle({
      title: 'Inflation pressures household budgets as energy prices rise',
      description: 'Economists say the price increase is tied to lower supply and higher demand.'
    })).toBe(false);
  });

  test('builds the next due window for reader prewarm', () => {
    expect(thematicSummaryService._getNextDueWindow(new Date('2026-05-21T05:30:00.000Z'))).toEqual({
      periodStart: '2026-05-20T18:00:00.000Z',
      periodEnd: '2026-05-21T06:00:00.000Z'
    });
    expect(thematicSummaryService._getNextDueWindow(new Date('2026-05-21T18:00:00.000Z'))).toEqual({
      periodStart: '2026-05-21T18:00:00.000Z',
      periodEnd: '2026-05-22T06:00:00.000Z'
    });
  });
});

function mockAiPodcastGenerator(overrides = {}) {
  const podcastScriptGenerator = overrides.generatePodcastScriptForArticles
    || overrides.generatePodcastForArticles
    || jest.fn().mockResolvedValue(null);
  const mock = {
    generatePodcastForArticles: podcastScriptGenerator,
    generatePodcastScriptForArticles: podcastScriptGenerator,
    generateAudioForLocale: jest.fn().mockResolvedValue(null),
    isAiPodcastGenerationAvailable: jest.fn(() => true),
    _getScriptConfig: jest.fn(() => ({ model: 'test-summary-model' })),
    _getTtsConfig: jest.fn(() => ({ apiKey: 'test-key', enabled: true, model: 'test-tts-model' })),
    _getTtsVoice: jest.fn(() => 'Charon'),
    _getEnabledPodcastLocales: jest.fn(() => ['en']),
    ...overrides
  };
  if (!overrides.generatePodcastScriptForArticles && overrides.generatePodcastForArticles) {
    mock.generatePodcastScriptForArticles = mock.generatePodcastForArticles;
  }

  jest.doMock('./aiPodcastGenerator', () => mock);
  return mock;
}

function createLoggerMock() {
  return { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
}

function loadServiceWithMocks({
  databaseMock,
  env = {},
  aiSummaryGeneratorMock,
  aiPodcastGeneratorOverrides,
  readerServiceMock,
  websocketServiceMock,
  loggerMock
} = {}) {
  resetServiceRuntime(env);

  const mocks = {
    aiPodcastGeneratorMock: mockAiPodcastGenerator(aiPodcastGeneratorOverrides),
    readerServiceMock: readerServiceMock || { getReaderArticle: jest.fn() },
    websocketServiceMock: websocketServiceMock || { broadcastFeedRefresh: jest.fn() },
    loggerMock: loggerMock || createLoggerMock()
  };

  if (databaseMock) {
    jest.doMock('./database', () => databaseMock);
  }
  if (aiSummaryGeneratorMock) {
    jest.doMock('./aiSummaryGenerator', () => aiSummaryGeneratorMock);
  }
  jest.doMock('./readerService', () => mocks.readerServiceMock);
  jest.doMock('./websocketService', () => mocks.websocketServiceMock);
  jest.doMock('../utils/logger', () => mocks.loggerMock);

  return {
    service: require('./thematicSummaryService'),
    ...mocks
  };
}

describe('thematic summary listing', () => {
  test('adds generic slots to latest topic summaries', () => {
    const databaseMock = {
      listLatestThematicSummaries: jest.fn(() => [
        {
          id: 'summary-technology',
          topicKey: 'technology',
          periodStart: '2026-05-21T05:00:00.000Z',
          periodEnd: '2026-05-21T17:00:00.000Z',
          status: 'completed'
        }
      ]),
      listLatestPodcastSummaries: jest.fn(() => [])
    };

    const { service } = loadServiceWithMocks({
      databaseMock,
      env: {
        OPENROUTER_API_KEY: 'test-key',
        AI_SUMMARY_TIME_ZONE: 'Europe/Rome'
      }
    });

    expect(service.getLatestSummaries().items).toEqual([
      expect.objectContaining({
        id: 'summary-technology',
        topicKey: 'technology',
        topicLabel: 'Technology',
        summarySlot: 'evening'
      })
    ]);
  });

  test('keeps latest topic summaries on one coherent window', () => {
    const databaseMock = {
      listLatestThematicSummaries: jest.fn(() => [
        {
          id: 'summary-technology-current',
          topicKey: 'technology',
          periodStart: '2026-05-21T06:00:00.000Z',
          periodEnd: '2026-05-21T18:00:00.000Z',
          status: 'completed'
        },
        {
          id: 'summary-science-old',
          topicKey: 'science',
          periodStart: '2026-05-20T18:00:00.000Z',
          periodEnd: '2026-05-21T06:00:00.000Z',
          status: 'completed'
        }
      ]),
      listLatestPodcastSummaries: jest.fn(() => [])
    };

    const { service } = loadServiceWithMocks({
      databaseMock,
      env: {
        OPENROUTER_API_KEY: 'test-key',
        AI_SUMMARY_TIME_ZONE: 'Europe/Rome'
      }
    });
    const items = service.getLatestSummaries({ referenceDate: new Date('2026-05-21T18:05:00.000Z') }).items;

    expect(items).toEqual([
      expect.objectContaining({
        id: 'summary-technology-current',
        topicKey: 'technology',
        isStale: false
      })
    ]);
    expect(items).toHaveLength(1);
  });

  test('returns one latest podcast per slot and keeps failed slot entries visible', () => {
    const databaseMock = {
      listLatestThematicSummaries: jest.fn(() => []),
      listLatestPodcastSummaries: jest.fn(() => [
        {
          id: 'evening-new',
          periodStart: '2026-05-22T05:00:00.000Z',
          periodEnd: '2026-05-22T17:00:00.000Z',
          status: 'completed'
        },
        {
          id: 'morning-failed',
          periodStart: '2026-05-21T17:00:00.000Z',
          periodEnd: '2026-05-22T05:00:00.000Z',
          status: 'failed'
        },
        {
          id: 'evening-old',
          periodStart: '2026-05-21T05:00:00.000Z',
          periodEnd: '2026-05-21T17:00:00.000Z',
          status: 'completed'
        }
      ])
    };

    const { service } = loadServiceWithMocks({
      databaseMock,
      env: {
        OPENROUTER_API_KEY: 'test-key',
        AI_SUMMARY_TIME_ZONE: 'Europe/Rome'
      }
    });

    expect(service.getLatestSummaries().items).toEqual([
      expect.objectContaining({ id: 'evening-new', podcastSlot: 'evening', status: 'completed' }),
      expect.objectContaining({ id: 'morning-failed', podcastSlot: 'morning', status: 'failed' })
    ]);
    expect(databaseMock.listLatestPodcastSummaries).toHaveBeenCalledWith(6);
  });
});

describe('thematic summary reader prewarm', () => {
  test('prewarms uncached candidate reader content without retrying the same article in the same window', async () => {
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

    const { service } = loadServiceWithMocks({
      databaseMock,
      env: {
        OPENROUTER_API_KEY: 'test-key',
        AI_SUMMARY_READER_PREWARM_ENABLED: 'true'
      },
      readerServiceMock
    });
    const firstReferenceDate = new Date('2026-05-21T05:45:00.000Z');
    const window = service._getNextDueWindow(firstReferenceDate);

    await expect(service.prewarmReaderCacheForDueWindow({
      referenceDate: firstReferenceDate,
      window
    })).resolves.toMatchObject({ attemptedCount: 1, cachedCount: 1 });
    await expect(service.prewarmReaderCacheForDueWindow({
      referenceDate: new Date('2026-05-21T05:50:00.000Z'),
      window
    })).resolves.toMatchObject({ attemptedCount: 0 });

    expect(readerServiceMock.getReaderArticle).toHaveBeenCalledTimes(1);
    expect(readerServiceMock.getReaderArticle).toHaveBeenCalledWith('article-1', {
      userId: null,
      maxArticleAgeHours: null
    });
  });

  test('retries failed reader prewarm attempts after cooldown', async () => {
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
      getReaderArticle: jest.fn()
        .mockResolvedValueOnce({ articleId: 'article-1', contentText: '', fallback: true })
        .mockResolvedValueOnce({
          articleId: 'article-1',
          contentText: 'Useful reader content '.repeat(30),
          fallback: false
        })
    };

    const { service } = loadServiceWithMocks({
      databaseMock,
      env: {
        OPENROUTER_API_KEY: 'test-key',
        AI_SUMMARY_READER_PREWARM_ENABLED: 'true',
        AI_SUMMARY_READER_PREWARM_RETRY_COOLDOWN_MS: String(10 * 60 * 1000)
      },
      readerServiceMock
    });
    const firstReferenceDate = new Date('2026-05-21T05:45:00.000Z');
    const window = service._getNextDueWindow(firstReferenceDate);

    await expect(service.prewarmReaderCacheForDueWindow({
      referenceDate: firstReferenceDate,
      window
    })).resolves.toMatchObject({ attemptedCount: 1, cachedCount: 0 });
    await expect(service.prewarmReaderCacheForDueWindow({
      referenceDate: new Date('2026-05-21T05:50:00.000Z'),
      window
    })).resolves.toMatchObject({ attemptedCount: 0 });
    await expect(service.prewarmReaderCacheForDueWindow({
      referenceDate: new Date('2026-05-21T05:56:00.000Z'),
      window
    })).resolves.toMatchObject({ attemptedCount: 1, cachedCount: 1 });

    expect(readerServiceMock.getReaderArticle).toHaveBeenCalledTimes(2);
  });

  test('retains prewarm attempts only for the current and next summary windows', async () => {
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

    const { service } = loadServiceWithMocks({
      databaseMock,
      env: {
        OPENROUTER_API_KEY: 'test-key',
        AI_SUMMARY_READER_PREWARM_ENABLED: 'true'
      },
      readerServiceMock
    });
    const firstReference = new Date('2026-05-21T05:45:00.000Z');
    const secondReference = new Date('2026-05-21T11:45:00.000Z');
    const thirdReference = new Date('2026-05-21T18:45:00.000Z');

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
  test('retries failed summary rows and broadcasts only newly completed summaries', async () => {
    const summaryWindow = {
      periodStart: '2026-05-20T18:00:00.000Z',
      periodEnd: '2026-05-21T06:00:00.000Z'
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
    const dealArticle = {
      id: 'deal-article',
      source: 'The Verge',
      title: 'The best OLED TV deals are at a new low',
      description: 'The LG OLED TV is down to $1,499.99 with a $200 gift card at Best Buy.',
      url: 'https://example.com/deals/lg-oled-tv-best-buy',
      pubDate: '2026-05-20T19:00:00.000Z'
    };
    const databaseMock = {
      getThematicSummary: jest.fn((topicKey) => (topicKey === 'technology'
        ? failedSummary
        : { topicKey, status: 'empty', periodStart: summaryWindow.periodStart, periodEnd: summaryWindow.periodEnd })),
      listLatestThematicSummaries: jest.fn(() => []),
      getPodcastSummary: jest.fn(() => ({ id: 'podcast-existing', status: 'completed' })),
      upsertPodcastSummary: jest.fn(),
      getArticlesForThematicSummary: jest.fn(({ topics }) => topics.includes('Tecnologia') ? [dealArticle, article] : []),
      getReaderCache: jest.fn(() => null),
      upsertThematicSummary: jest.fn(() => completedSummary),
      pruneSummaryHistory: jest.fn(() => ({ thematicSummaries: 1, podcastSummaries: 0 }))
    };
    const aiSummaryGeneratorMock = {
      isAiSummaryGenerationAvailable: jest.fn(() => true),
      generateSummaryForArticles: jest.fn().mockResolvedValue({
        summaryText: 'English text',
        summaryTextByLocale: { en: 'English text', it: 'Testo italiano' },
        model: 'test-model'
      }),
      _getConfig: jest.fn(() => ({ model: 'test-model' }))
    };
    const websocketServiceMock = { broadcastFeedRefresh: jest.fn() };

    const { service } = loadServiceWithMocks({
      databaseMock,
      env: OPENROUTER_TEST_ENV,
      aiSummaryGeneratorMock,
      websocketServiceMock
    });
    const result = await service.generateDueSummaries({ window: summaryWindow });

    expect(result.items).toEqual(expect.arrayContaining([completedSummary]));
    expect(aiSummaryGeneratorMock.generateSummaryForArticles).toHaveBeenCalledTimes(1);
    expect(aiSummaryGeneratorMock.generateSummaryForArticles.mock.calls[0][1]).toEqual([
      expect.objectContaining({ id: article.id })
    ]);
    expect(databaseMock.upsertThematicSummary).toHaveBeenCalledWith(expect.objectContaining({
      topicKey: 'technology',
      status: 'completed'
    }));
    expect(databaseMock.upsertThematicSummary.mock.calls[0][0]).not.toHaveProperty('title');
    expect(databaseMock.upsertThematicSummary.mock.calls[0][0]).not.toHaveProperty('titleByLocale');
    expect(databaseMock.pruneSummaryHistory).toHaveBeenCalledWith({
      periodEnd: summaryWindow.periodEnd,
      topicKeys: ['technology'],
      podcast: false
    });
    expect(websocketServiceMock.broadcastFeedRefresh).toHaveBeenCalledWith({ reason: 'summaries' });
  });

  test('does not broadcast when all due summaries already exist', async () => {
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
      getThematicSummary: jest.fn((topicKey) => ({ ...existingSummary, topicKey })),
      listLatestThematicSummaries: jest.fn(() => []),
      getPodcastSummary: jest.fn(() => ({ id: 'podcast-existing', status: 'completed' })),
      upsertPodcastSummary: jest.fn(),
      getArticlesForThematicSummary: jest.fn(() => []),
      getReaderCache: jest.fn(() => null),
      upsertThematicSummary: jest.fn(),
      pruneSummaryHistory: jest.fn()
    };
    const aiSummaryGeneratorMock = {
      isAiSummaryGenerationAvailable: jest.fn(() => true),
      generateSummaryForArticles: jest.fn(),
      _getConfig: jest.fn(() => ({ model: 'test-model' }))
    };
    const websocketServiceMock = { broadcastFeedRefresh: jest.fn() };

    const { service } = loadServiceWithMocks({
      databaseMock,
      env: OPENROUTER_TEST_ENV,
      aiSummaryGeneratorMock,
      websocketServiceMock
    });
    const result = await service.generateDueSummaries({ window: summaryWindow });

    expect(result.items).toEqual(expect.arrayContaining([existingSummary]));
    expect(aiSummaryGeneratorMock.generateSummaryForArticles).not.toHaveBeenCalled();
    expect(databaseMock.pruneSummaryHistory).not.toHaveBeenCalled();
    expect(websocketServiceMock.broadcastFeedRefresh).not.toHaveBeenCalled();
  });

  test('uses the same morning and evening windows for topic summaries and podcasts', async () => {
    const existingSummary = {
      status: 'completed',
      periodStart: '2026-05-20T17:00:00.000Z',
      periodEnd: '2026-05-21T05:00:00.000Z'
    };
    const existingPodcastSummary = {
      id: 'podcast-morning',
      status: 'completed',
      periodStart: '2026-05-20T17:00:00.000Z',
      periodEnd: '2026-05-21T05:00:00.000Z'
    };
    const databaseMock = {
      getThematicSummary: jest.fn((topicKey) => ({ ...existingSummary, topicKey })),
      listLatestThematicSummaries: jest.fn(() => []),
      getPodcastSummary: jest.fn(() => existingPodcastSummary),
      getArticlesForThematicSummary: jest.fn(() => []),
      getReaderCache: jest.fn(() => null),
      upsertThematicSummary: jest.fn(),
      pruneSummaryHistory: jest.fn()
    };
    const aiSummaryGeneratorMock = {
      isAiSummaryGenerationAvailable: jest.fn(() => true),
      generateSummaryForArticles: jest.fn(),
      _getConfig: jest.fn(() => ({ model: 'test-model' }))
    };

    const { service } = loadServiceWithMocks({ databaseMock, env: OPENROUTER_TEST_ENV, aiSummaryGeneratorMock });
    await service.generateDueSummaries({ referenceDate: new Date('2026-05-21T11:10:00.000Z') });

    expect(databaseMock.getThematicSummary).toHaveBeenCalledWith('technology', '2026-05-20T18:00:00.000Z', '2026-05-21T06:00:00.000Z');
    expect(databaseMock.getPodcastSummary).toHaveBeenCalledWith('2026-05-20T18:00:00.000Z', '2026-05-21T06:00:00.000Z');
    expect(databaseMock.pruneSummaryHistory).not.toHaveBeenCalled();
  });

  test('persists empty summary windows without calling the model', async () => {
    const summaryWindow = {
      periodStart: '2026-05-20T17:00:00.000Z',
      periodEnd: '2026-05-21T05:00:00.000Z'
    };
    const databaseMock = {
      getThematicSummary: jest.fn(() => null),
      listLatestThematicSummaries: jest.fn(() => []),
      getPodcastSummary: jest.fn(() => null),
      getArticlesForThematicSummary: jest.fn(() => []),
      getReaderCache: jest.fn(() => null),
      upsertThematicSummary: jest.fn((payload) => payload),
      upsertPodcastSummary: jest.fn((payload) => ({ ...payload, type: 'podcast' }))
    };
    const aiSummaryGeneratorMock = {
      isAiSummaryGenerationAvailable: jest.fn(() => true),
      generateSummaryForArticles: jest.fn(),
      _getConfig: jest.fn(() => ({ model: 'test-model' }))
    };
    const websocketServiceMock = { broadcastFeedRefresh: jest.fn() };

    const { service } = loadServiceWithMocks({
      databaseMock,
      aiSummaryGeneratorMock,
      websocketServiceMock
    });
    const result = await service.generateDueSummaries({ window: summaryWindow });

    expect(result.items).toHaveLength(7);
    expect(result.items.filter((summary) => summary.type === 'podcast')).toEqual([
      expect.objectContaining({ status: 'empty' })
    ]);
    expect(result.items.filter((summary) => summary.type !== 'podcast')).toHaveLength(6);
    expect(result.items.every((summary) => summary.status === 'empty')).toBe(true);
    expect(aiSummaryGeneratorMock.generateSummaryForArticles).not.toHaveBeenCalled();
    expect(databaseMock.upsertThematicSummary).toHaveBeenCalledWith(expect.objectContaining({
      topicKey: 'technology',
      status: 'empty',
      articleCount: 0,
      summaryTextByLocale: expect.objectContaining({
        en: expect.stringContaining('No technology stories'),
        it: expect.stringContaining('Nessuna notizia')
      })
    }));
    expect(databaseMock.upsertThematicSummary.mock.calls[0][0]).not.toHaveProperty('title');
    expect(databaseMock.upsertThematicSummary.mock.calls[0][0]).not.toHaveProperty('titleByLocale');
    expect(websocketServiceMock.broadcastFeedRefresh).toHaveBeenCalledWith({ reason: 'summaries' });
  });

  test('regenerates an empty summary when articles arrive later for the same window', async () => {
    const summaryWindow = {
      periodStart: '2026-05-20T17:00:00.000Z',
      periodEnd: '2026-05-21T05:00:00.000Z'
    };
    const emptyTechnologySummary = {
      topicKey: 'technology',
      status: 'empty',
      periodStart: summaryWindow.periodStart,
      periodEnd: summaryWindow.periodEnd
    };
    const completedSummary = {
      ...emptyTechnologySummary,
      status: 'completed',
      summaryTextByLocale: { en: 'English text [1]', it: 'Testo italiano [1]' }
    };
    const article = {
      id: 'article-1',
      source: 'BBC',
      title: 'Late AI update',
      description: 'Late article description',
      url: 'https://example.com/late-ai',
      pubDate: '2026-05-20T18:00:00.000Z'
    };
    const databaseMock = {
      getThematicSummary: jest.fn((topicKey) => (topicKey === 'technology'
        ? emptyTechnologySummary
        : { topicKey, status: 'completed', periodStart: summaryWindow.periodStart, periodEnd: summaryWindow.periodEnd })),
      listLatestThematicSummaries: jest.fn(() => []),
      getPodcastSummary: jest.fn(() => ({ id: 'podcast-existing', status: 'completed' })),
      getArticlesForThematicSummary: jest.fn(({ topics }) => topics.includes('Tecnologia') ? [article] : []),
      getReaderCache: jest.fn(() => null),
      upsertThematicSummary: jest.fn(() => completedSummary),
      pruneSummaryHistory: jest.fn(() => ({ thematicSummaries: 1, podcastSummaries: 0 }))
    };
    const aiSummaryGeneratorMock = {
      isAiSummaryGenerationAvailable: jest.fn(() => true),
      generateSummaryForArticles: jest.fn().mockResolvedValue({
        summaryText: 'English text [1]',
        summaryTextByLocale: { en: 'English text [1]', it: 'Testo italiano [1]' },
        model: 'test-model'
      }),
      _getConfig: jest.fn(() => ({ model: 'test-model' }))
    };
    const websocketServiceMock = { broadcastFeedRefresh: jest.fn() };

    const { service } = loadServiceWithMocks({
      databaseMock,
      env: OPENROUTER_TEST_ENV,
      aiSummaryGeneratorMock,
      websocketServiceMock
    });
    const result = await service.generateDueSummaries({ window: summaryWindow });

    expect(result.items).toEqual(expect.arrayContaining([completedSummary]));
    expect(aiSummaryGeneratorMock.generateSummaryForArticles).toHaveBeenCalledTimes(1);
    expect(aiSummaryGeneratorMock.generateSummaryForArticles.mock.calls[0][1]).toEqual([expect.objectContaining({ id: 'article-1' })]);
    expect(databaseMock.upsertThematicSummary).toHaveBeenCalledWith(expect.objectContaining({
      topicKey: 'technology',
      status: 'completed',
      articleCount: 1
    }));
    expect(databaseMock.pruneSummaryHistory).toHaveBeenCalledWith({
      periodEnd: summaryWindow.periodEnd,
      topicKeys: ['technology'],
      podcast: false
    });
    expect(websocketServiceMock.broadcastFeedRefresh).toHaveBeenCalledWith({ reason: 'summaries' });
  });

  test('deduplicates topic summaries and reuses topic article queries for podcasts', async () => {
    const summaryWindow = {
      periodStart: '2026-05-20T17:00:00.000Z',
      periodEnd: '2026-05-21T05:00:00.000Z'
    };
    const techArticle = {
      id: 'tech-1',
      source: 'BBC',
      title: 'AI chips accelerate',
      description: 'AI chips update description',
      canonicalUrl: 'https://example.com/ai-chips',
      url: 'https://example.com/ai-chips?utm_source=rss',
      pubDate: '2026-05-20T18:00:00.000Z'
    };
    const duplicateTechArticle = {
      ...techArticle,
      id: 'tech-duplicate',
      url: 'https://example.com/ai-chips?utm_campaign=duplicate'
    };
    const scienceArticle = {
      id: 'science-1',
      source: 'Nature',
      title: 'Space telescope discovery',
      description: 'Space telescope update description',
      url: 'https://example.com/space-telescope',
      pubDate: '2026-05-20T19:00:00.000Z'
    };
    const databaseMock = {
      getThematicSummary: jest.fn(() => null),
      listLatestThematicSummaries: jest.fn(() => []),
      getPodcastSummary: jest.fn(() => null),
      getArticlesForThematicSummary: jest.fn(({ topics }) => {
        if (topics.includes('Tecnologia')) {
          return [techArticle, duplicateTechArticle];
        }
        if (topics.includes('Scienza')) {
          return [scienceArticle];
        }
        return [];
      }),
      getReaderCache: jest.fn(() => null),
      hasPendingTopicProcessingForThematicSummary: jest.fn(() => false),
      upsertThematicSummary: jest.fn((payload) => payload),
      upsertPodcastSummary: jest.fn((payload) => ({ ...payload, type: 'podcast', status: 'completed' })),
      pruneSummaryHistory: jest.fn(() => ({ thematicSummaries: 0, podcastSummaries: 0 }))
    };
    const aiSummaryGeneratorMock = {
      isAiSummaryGenerationAvailable: jest.fn(() => true),
      generateSummaryForArticles: jest.fn().mockResolvedValue({
        summaryText: 'English text [1]',
        summaryTextByLocale: { en: 'English text [1]', it: 'Testo italiano [1]' },
        model: 'test-model'
      }),
      _getConfig: jest.fn(() => ({ model: 'test-model' }))
    };

    const { service, aiPodcastGeneratorMock } = loadServiceWithMocks({
      databaseMock,
      env: OPENROUTER_TEST_ENV,
      aiSummaryGeneratorMock,
      aiPodcastGeneratorOverrides: {
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
      }
    });

    await service.generateDueSummaries({ window: summaryWindow });

    expect(databaseMock.getArticlesForThematicSummary).toHaveBeenCalledTimes(6);
    const technologySummaryCall = aiSummaryGeneratorMock.generateSummaryForArticles.mock.calls
      .find(([topicConfig]) => topicConfig.key === 'technology');
    expect(technologySummaryCall[1].map((article) => article.id)).toEqual(['tech-1']);
    expect(aiPodcastGeneratorMock.generatePodcastForArticles).toHaveBeenCalledTimes(1);
    expect(aiPodcastGeneratorMock.generatePodcastForArticles.mock.calls[0][1].map((article) => article.id)).toEqual(['science-1', 'tech-1']);
  });

  test('does not retry recently failed summaries on every scheduler tick', async () => {
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
      getThematicSummary: jest.fn((topicKey) => (topicKey === 'technology'
        ? failedSummary
        : { topicKey, status: 'empty', periodStart: summaryWindow.periodStart, periodEnd: summaryWindow.periodEnd })),
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

    const { service } = loadServiceWithMocks({
      databaseMock,
      env: {
        ...OPENROUTER_TEST_ENV,
        AI_SUMMARY_FAILED_RETRY_COOLDOWN_MS: String(10 * 60 * 1000)
      },
      aiSummaryGeneratorMock,
      websocketServiceMock
    });
    const result = await service.generateDueSummaries({
      window: summaryWindow,
      referenceDate: new Date('2026-05-21T05:01:00.000Z')
    });

    expect(result.items).toEqual(expect.arrayContaining([existingPodcastSummary]));
    expect(databaseMock.getArticlesForThematicSummary).not.toHaveBeenCalledWith(expect.objectContaining({ topics: ['Tecnologia'] }));
    expect(aiSummaryGeneratorMock.generateSummaryForArticles).not.toHaveBeenCalled();
    expect(websocketServiceMock.broadcastFeedRefresh).not.toHaveBeenCalled();
  });

  test('retries invalid output failures until the retry limit', async () => {
    const summaryWindow = {
      periodStart: '2026-05-20T17:00:00.000Z',
      periodEnd: '2026-05-21T05:00:00.000Z'
    };
    const failedSummary = {
      topicKey: 'technology',
      status: 'failed',
      failureCategory: 'invalid_output',
      retryCount: 1,
      periodStart: summaryWindow.periodStart,
      periodEnd: summaryWindow.periodEnd,
      generatedAt: '2026-05-21T05:00:00.000Z'
    };
    const completedSummary = {
      ...failedSummary,
      status: 'completed',
      summaryTextByLocale: { en: 'English text [1]', it: 'Testo italiano [1]' }
    };
    const databaseMock = {
      getThematicSummary: jest.fn((topicKey) => (topicKey === 'technology'
        ? failedSummary
        : { topicKey, status: 'empty', periodStart: summaryWindow.periodStart, periodEnd: summaryWindow.periodEnd })),
      listLatestThematicSummaries: jest.fn(() => []),
      getPodcastSummary: jest.fn(() => ({ id: 'podcast-existing', status: 'completed' })),
      getArticlesForThematicSummary: jest.fn(({ topics }) => topics.includes('Tecnologia') ? [{ id: 'article-1' }] : []),
      getReaderCache: jest.fn(() => null),
      upsertThematicSummary: jest.fn(() => completedSummary),
      pruneSummaryHistory: jest.fn(() => ({ thematicSummaries: 0, podcastSummaries: 0 }))
    };
    const aiSummaryGeneratorMock = {
      isAiSummaryGenerationAvailable: jest.fn(() => true),
      generateSummaryForArticles: jest.fn().mockResolvedValue({
        summaryText: 'English text [1]',
        summaryTextByLocale: { en: 'English text [1]', it: 'Testo italiano [1]' },
        model: 'test-model'
      }),
      _getConfig: jest.fn(() => ({ model: 'test-model' }))
    };

    const { service } = loadServiceWithMocks({
      databaseMock,
      env: {
        ...OPENROUTER_TEST_ENV,
        AI_SUMMARY_FAILED_RETRY_COOLDOWN_MS: '0',
        AI_SUMMARY_INVALID_OUTPUT_MAX_RETRIES: '2'
      },
      aiSummaryGeneratorMock
    });
    await service.generateDueSummaries({ window: summaryWindow });

    expect(databaseMock.getArticlesForThematicSummary).toHaveBeenCalledWith(expect.objectContaining({ topics: ['Tecnologia'] }));
    expect(aiSummaryGeneratorMock.generateSummaryForArticles).toHaveBeenCalledTimes(1);
  });

  test('does not retry invalid output failures after the retry limit', async () => {
    const summaryWindow = {
      periodStart: '2026-05-20T17:00:00.000Z',
      periodEnd: '2026-05-21T05:00:00.000Z'
    };
    const failedSummary = {
      topicKey: 'technology',
      status: 'failed',
      failureCategory: 'invalid_output',
      retryCount: 3,
      periodStart: summaryWindow.periodStart,
      periodEnd: summaryWindow.periodEnd,
      generatedAt: '2026-05-21T05:00:00.000Z'
    };
    const databaseMock = {
      getThematicSummary: jest.fn((topicKey) => (topicKey === 'technology'
        ? failedSummary
        : { topicKey, status: 'empty', periodStart: summaryWindow.periodStart, periodEnd: summaryWindow.periodEnd })),
      listLatestThematicSummaries: jest.fn(() => []),
      getPodcastSummary: jest.fn(() => ({ id: 'podcast-existing', status: 'completed' })),
      getArticlesForThematicSummary: jest.fn(({ topics }) => topics.includes('Tecnologia') ? [{ id: 'article-1' }] : []),
      getReaderCache: jest.fn(() => null),
      upsertThematicSummary: jest.fn()
    };
    const aiSummaryGeneratorMock = {
      isAiSummaryGenerationAvailable: jest.fn(() => true),
      generateSummaryForArticles: jest.fn(),
      _getConfig: jest.fn(() => ({ model: 'test-model' }))
    };

    const { service } = loadServiceWithMocks({
      databaseMock,
      env: {
        ...OPENROUTER_TEST_ENV,
        AI_SUMMARY_FAILED_RETRY_COOLDOWN_MS: '0',
        AI_SUMMARY_INVALID_OUTPUT_MAX_RETRIES: '2'
      },
      aiSummaryGeneratorMock
    });
    await service.generateDueSummaries({ window: summaryWindow });

    expect(databaseMock.getArticlesForThematicSummary).not.toHaveBeenCalledWith(expect.objectContaining({ topics: ['Tecnologia'] }));
    expect(aiSummaryGeneratorMock.generateSummaryForArticles).not.toHaveBeenCalled();
  });

  test('stores invalid output failures with a non-retryable category', async () => {
    const summaryWindow = {
      periodStart: '2026-05-20T17:00:00.000Z',
      periodEnd: '2026-05-21T05:00:00.000Z'
    };
    const validationError = new Error('AI summary English text has no citations');
    validationError.code = 'SUMMARY_VALIDATION_FAILED';
    const article = {
      id: 'article-1',
      source: 'BBC',
      title: 'AI update',
      description: 'AI update description',
      pubDate: '2026-05-20T18:00:00.000Z'
    };
    const databaseMock = {
      getThematicSummary: jest.fn((topicKey) => (topicKey === 'technology'
        ? { topicKey, status: 'failed', retryCount: 2, periodStart: summaryWindow.periodStart, periodEnd: summaryWindow.periodEnd }
        : { topicKey, status: 'empty', periodStart: summaryWindow.periodStart, periodEnd: summaryWindow.periodEnd })),
      listLatestThematicSummaries: jest.fn(() => []),
      getPodcastSummary: jest.fn(() => null),
      getArticlesForThematicSummary: jest.fn(({ topics }) => topics.includes('Tecnologia') ? [article] : []),
      getReaderCache: jest.fn(() => null),
      upsertThematicSummary: jest.fn()
    };
    const aiSummaryGeneratorMock = {
      isAiSummaryGenerationAvailable: jest.fn(() => true),
      generateSummaryForArticles: jest.fn().mockRejectedValue(validationError),
      _getConfig: jest.fn(() => ({ model: 'test-model' }))
    };

    const { service } = loadServiceWithMocks({ databaseMock, env: OPENROUTER_TEST_ENV, aiSummaryGeneratorMock });
    await service.generateDueSummaries({ window: summaryWindow });

    expect(databaseMock.upsertThematicSummary).toHaveBeenCalledWith(expect.objectContaining({
      topicKey: 'technology',
      status: 'failed',
      failureCategory: 'invalid_output',
      retryCount: 3,
      errorMessage: 'AI summary English text has no citations'
    }));
  });

  test('generates the podcast from the deduplicated summary prewarm article set', async () => {
    const summaryWindow = {
      periodStart: '2026-05-20T17:00:00.000Z',
      periodEnd: '2026-05-21T05:00:00.000Z'
    };
    const articleOne = {
      id: 'article-1',
      source: 'BBC',
      title: 'AI update',
      description: 'AI update description',
      canonicalUrl: 'https://example.com/ai',
      url: 'https://example.com/ai?utm_source=rss',
      storyGroupId: 'story-ai-update',
      pubDate: '2026-05-20T18:00:00.000Z'
    };
    const articleOneSameUrl = {
      ...articleOne,
      id: 'article-1-same-url',
      url: 'https://example.com/ai?utm_campaign=topic-science',
      canonicalUrl: 'https://example.com/ai'
    };
    const articleOneSameStory = {
      ...articleOne,
      id: 'article-1-same-story',
      source: 'Wired',
      url: 'https://wired.example.com/ai-update',
      canonicalUrl: 'https://wired.example.com/ai-update'
    };
    const articleOneSameTitleSource = {
      ...articleOne,
      id: 'article-1-same-title-source',
      url: '',
      canonicalUrl: '',
      storyGroupId: ''
    };
    const articleTwo = {
      id: 'article-2',
      source: 'Wired',
      title: 'Science update',
      description: 'Science RSS description',
      url: 'https://example.com/science',
      pubDate: '2026-05-20T19:00:00.000Z'
    };
    const dealArticle = {
      id: 'deal-article',
      source: 'The Verge',
      title: 'Govee Table Lamp 2 Pro drops to its lowest price',
      description: 'The desk lamp is now $134.99 and an LG OLED TV includes a $200 gift card at Best Buy.',
      url: 'https://example.com/deals/govee-table-lamp-lg-oled-tv'
    };
    const databaseMock = {
      getPodcastSummary: jest.fn(() => null),
      getArticlesForThematicSummary: jest.fn(({ topics }) => {
        if (topics.includes('Tecnologia')) {
          return [articleOne, articleOneSameUrl, articleOneSameTitleSource, dealArticle];
        }
        if (topics.includes('Scienza')) {
          return [articleOneSameStory, articleOne, articleTwo, dealArticle];
        }
        return [];
      }),
      getReaderCache: jest.fn((articleId) => articleId === 'article-2'
        ? { contentText: 'Useful cached reader text. '.repeat(20) }
        : null),
      upsertPodcastSummary: jest.fn((payload) => ({ ...payload, type: 'podcast', status: 'completed' }))
    };
    const aiSummaryGeneratorMock = {
      isAiSummaryGenerationAvailable: jest.fn(() => true),
      _getConfig: jest.fn(() => ({ model: 'test-summary-model' }))
    };
    const { service, aiPodcastGeneratorMock } = loadServiceWithMocks({
      databaseMock,
      aiSummaryGeneratorMock,
      aiPodcastGeneratorOverrides: {
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
      }
    });
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
      failureCategory: '',
      retryCount: 0,
      audioFailureCategory: '',
      audioRetryCount: 0,
      status: 'completed'
    }));
  });

  test('persists empty podcast windows without retrying the same window', async () => {
    const summaryWindow = {
      periodStart: '2026-05-20T17:00:00.000Z',
      periodEnd: '2026-05-21T05:00:00.000Z'
    };
    const emptyPodcast = {
      id: 'podcast-empty',
      status: 'empty',
      periodStart: summaryWindow.periodStart,
      periodEnd: summaryWindow.periodEnd
    };
    const databaseMock = {
      getPodcastSummary: jest.fn()
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(emptyPodcast),
      getArticlesForThematicSummary: jest.fn(() => []),
      getReaderCache: jest.fn(() => null),
      upsertPodcastSummary: jest.fn(() => emptyPodcast)
    };
    const aiSummaryGeneratorMock = {
      isAiSummaryGenerationAvailable: jest.fn(() => true),
      _getConfig: jest.fn(() => ({ model: 'test-summary-model' }))
    };
    const { service, aiPodcastGeneratorMock } = loadServiceWithMocks({ databaseMock, aiSummaryGeneratorMock });

    await expect(service._generatePodcastForWindow(summaryWindow)).resolves.toEqual({ summary: emptyPodcast, generatedNow: true });
    await expect(service._generatePodcastForWindow(summaryWindow)).resolves.toEqual({ summary: emptyPodcast, generatedNow: false });
    expect(aiPodcastGeneratorMock.generatePodcastForArticles).not.toHaveBeenCalled();
    expect(databaseMock.upsertPodcastSummary).toHaveBeenCalledWith(expect.objectContaining({
      status: 'empty',
      failureCategory: 'empty_window',
      audioStatus: 'not_available'
    }));
  });

  test('regenerates a previously empty podcast window when articles become available', async () => {
    const summaryWindow = {
      periodStart: '2026-05-20T17:00:00.000Z',
      periodEnd: '2026-05-21T05:00:00.000Z'
    };
    const article = {
      id: 'article-1',
      source: 'BBC',
      title: 'AI update',
      description: 'AI update description',
      pubDate: '2026-05-20T18:00:00.000Z',
      topics: ['Tecnologia']
    };
    const completedPodcast = {
      id: 'podcast-completed',
      status: 'completed',
      periodStart: summaryWindow.periodStart,
      periodEnd: summaryWindow.periodEnd
    };
    const databaseMock = {
      getPodcastSummary: jest.fn(() => ({
        id: 'podcast-empty',
        status: 'empty',
        periodStart: summaryWindow.periodStart,
        periodEnd: summaryWindow.periodEnd
      })),
      getArticlesForThematicSummary: jest.fn(({ topics }) => topics.includes('Tecnologia') ? [article] : []),
      getReaderCache: jest.fn(() => null),
      hasPendingTopicProcessingForThematicSummary: jest.fn(() => false),
      upsertPodcastSummary: jest.fn(() => completedPodcast)
    };
    const { service, aiPodcastGeneratorMock } = loadServiceWithMocks({
      databaseMock,
      aiPodcastGeneratorOverrides: {
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
      }
    });

    const result = await service._generatePodcastForWindow(summaryWindow);

    expect(result).toEqual({ summary: completedPodcast, generatedNow: true });
    expect(aiPodcastGeneratorMock.generatePodcastForArticles).toHaveBeenCalledWith(summaryWindow, [expect.objectContaining({ id: 'article-1' })]);
    expect(databaseMock.upsertPodcastSummary).toHaveBeenCalledWith(expect.objectContaining({
      status: 'completed',
      articleCount: 1
    }));
  });

  test('does not persist empty podcast windows while topic processing is pending', async () => {
    const summaryWindow = {
      periodStart: '2026-05-20T17:00:00.000Z',
      periodEnd: '2026-05-21T05:00:00.000Z'
    };
    const databaseMock = {
      getPodcastSummary: jest.fn(() => null),
      getArticlesForThematicSummary: jest.fn(() => []),
      getReaderCache: jest.fn(() => null),
      hasPendingTopicProcessingForThematicSummary: jest.fn(() => true),
      upsertPodcastSummary: jest.fn()
    };
    const { service, aiPodcastGeneratorMock } = loadServiceWithMocks({ databaseMock });

    await expect(service._generatePodcastForWindow(summaryWindow, {
      referenceDate: new Date('2026-05-21T05:05:00.000Z')
    })).resolves.toEqual({ summary: null, generatedNow: false });
    expect(aiPodcastGeneratorMock.generatePodcastForArticles).not.toHaveBeenCalled();
    expect(databaseMock.upsertPodcastSummary).not.toHaveBeenCalled();
  });

  test('persists empty podcast windows after the pending topic grace period', async () => {
    const summaryWindow = {
      periodStart: '2026-05-20T17:00:00.000Z',
      periodEnd: '2026-05-21T05:00:00.000Z'
    };
    const emptyPodcast = {
      id: 'podcast-empty',
      status: 'empty',
      periodStart: summaryWindow.periodStart,
      periodEnd: summaryWindow.periodEnd
    };
    const databaseMock = {
      getPodcastSummary: jest.fn(() => null),
      getArticlesForThematicSummary: jest.fn(() => []),
      getReaderCache: jest.fn(() => null),
      hasPendingTopicProcessingForThematicSummary: jest.fn(() => true),
      upsertPodcastSummary: jest.fn(() => emptyPodcast)
    };
    const { service, aiPodcastGeneratorMock } = loadServiceWithMocks({ databaseMock });

    await expect(service._generatePodcastForWindow(summaryWindow, {
      referenceDate: new Date('2026-05-21T05:20:00.000Z')
    })).resolves.toEqual({ summary: emptyPodcast, generatedNow: true });
    expect(aiPodcastGeneratorMock.generatePodcastForArticles).not.toHaveBeenCalled();
    expect(databaseMock.upsertPodcastSummary).toHaveBeenCalledWith(expect.objectContaining({ status: 'empty' }));
  });

  test('stores invalid podcast scripts as non-retryable failures', async () => {
    const summaryWindow = {
      periodStart: '2026-05-20T17:00:00.000Z',
      periodEnd: '2026-05-21T05:00:00.000Z'
    };
    const validationError = new Error('AI podcast English script contains bracket citations');
    validationError.code = 'PODCAST_SCRIPT_VALIDATION_FAILED';
    const article = {
      id: 'article-1',
      source: 'BBC',
      title: 'AI update',
      description: 'AI update description',
      pubDate: '2026-05-20T18:00:00.000Z'
    };
    const failedPodcast = {
      id: 'podcast-failed',
      status: 'failed',
      periodStart: summaryWindow.periodStart,
      periodEnd: summaryWindow.periodEnd
    };
    const databaseMock = {
      getPodcastSummary: jest.fn(() => ({ status: 'failed', retryCount: 2, periodStart: summaryWindow.periodStart, periodEnd: summaryWindow.periodEnd })),
      getArticlesForThematicSummary: jest.fn(({ topics }) => topics.includes('Tecnologia') ? [article] : []),
      getReaderCache: jest.fn(() => null),
      upsertPodcastSummary: jest.fn(() => failedPodcast)
    };
    const aiSummaryGeneratorMock = {
      isAiSummaryGenerationAvailable: jest.fn(() => true),
      _getConfig: jest.fn(() => ({ model: 'test-summary-model' }))
    };
    const { service, aiPodcastGeneratorMock } = loadServiceWithMocks({
      databaseMock,
      aiSummaryGeneratorMock,
      aiPodcastGeneratorOverrides: {
        generatePodcastForArticles: jest.fn().mockRejectedValue(validationError)
      }
    });

    const result = await service._generatePodcastForWindow(summaryWindow, { force: true });

    expect(aiPodcastGeneratorMock.generatePodcastForArticles).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ summary: failedPodcast, generatedNow: true });
    expect(databaseMock.upsertPodcastSummary).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      failureCategory: 'invalid_script',
      retryCount: 3,
      errorMessage: 'AI podcast English script contains bracket citations'
    }));
  });

  test('retries missing podcast audio using the stored enabled-language script without regenerating text', async () => {
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
      audioByLocale: {
        en: {
          audioStatus: 'failed',
          audioModel: 'test-tts-model',
          audioVoice: 'Charon',
          audioRetryCount: 0
        }
      },
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
    const aiSummaryGeneratorMock = {
      isAiSummaryGenerationAvailable: jest.fn(() => true),
      _getConfig: jest.fn(() => ({ model: 'test-summary-model' }))
    };
    const { service, aiPodcastGeneratorMock } = loadServiceWithMocks({
      databaseMock,
      aiSummaryGeneratorMock,
      aiPodcastGeneratorOverrides: {
        generateAudioForLocale: jest.fn().mockResolvedValue({
          data: Buffer.from('audio').toString('base64'),
          mimeType: 'audio/mpeg',
          model: 'test-tts-model',
          voice: 'Charon'
        })
      }
    });
    const result = await service._generatePodcastForWindow(summaryWindow, {
      referenceDate: new Date('2026-05-21T05:20:00.000Z')
    });

    expect(result).toEqual({ summary: completedPodcast, generatedNow: true });
    expect(aiPodcastGeneratorMock.generatePodcastForArticles).not.toHaveBeenCalled();
    expect(aiPodcastGeneratorMock.generateAudioForLocale).toHaveBeenCalledWith('English script', 'en');
    expect(databaseMock.upsertPodcastSummary).toHaveBeenCalledWith(expect.objectContaining({
      id: 'podcast-existing',
      titleByLocale: existingPodcast.titleByLocale,
      scriptTextByLocale: existingPodcast.summaryTextByLocale,
      audioByLocale: {
        en: expect.objectContaining({
          audioStatus: 'completed',
          audioModel: 'test-tts-model',
          audioVoice: 'Charon',
          audioFailureCategory: '',
          audioRetryCount: 0,
          audioFailedAt: null
        })
      },
      status: 'completed'
    }));
  });

  test('broadcasts podcast audio retry progress and failure states', async () => {
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
      audioByLocale: {
        en: {
          audioStatus: 'not_available',
          audioModel: 'test-tts-model',
          audioVoice: 'Charon'
        }
      },
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
    const aiPodcastGeneratorOverrides = {
      generateAudioForLocale: jest.fn().mockRejectedValue(new Error('Provider rejected audio'))
    };
    const websocketServiceMock = { broadcastFeedRefresh: jest.fn() };

    const aiSummaryGeneratorMock = {
      isAiSummaryGenerationAvailable: jest.fn(() => true),
      _getConfig: jest.fn(() => ({ model: 'test-summary-model' }))
    };
    const { service, aiPodcastGeneratorMock } = loadServiceWithMocks({
      databaseMock,
      aiSummaryGeneratorMock,
      aiPodcastGeneratorOverrides,
      websocketServiceMock
    });
    const result = await service._generatePodcastForWindow(summaryWindow);

    expect(result.summary).toEqual(expect.objectContaining({
      audioByLocale: {
        en: expect.objectContaining({
          audioStatus: 'failed',
          audioErrorMessage: 'Provider rejected audio'
        })
      }
    }));
    expect(result.generatedNow).toBe(false);
    expect(aiPodcastGeneratorMock.generatePodcastForArticles).not.toHaveBeenCalled();
    expect(aiPodcastGeneratorMock.generateAudioForLocale).toHaveBeenCalledWith('English script', 'en');
    expect(databaseMock.upsertPodcastSummary).toHaveBeenNthCalledWith(1, expect.objectContaining({
      audioByLocale: {
        en: expect.objectContaining({
          audioStatus: 'generating',
          audioModel: 'test-tts-model',
          audioVoice: 'Charon'
        })
      }
    }));
    expect(databaseMock.upsertPodcastSummary).toHaveBeenNthCalledWith(2, expect.objectContaining({
      audioByLocale: {
        en: expect.objectContaining({
          audioStatus: 'failed',
          audioErrorMessage: 'Provider rejected audio',
          audioFailureCategory: 'tts_failed',
          audioRetryCount: 1,
          audioFailedAt: expect.any(String),
          audioModel: 'test-tts-model',
          audioVoice: 'Charon'
        })
      }
    }));
    expect(websocketServiceMock.broadcastFeedRefresh).toHaveBeenCalledTimes(2);
    expect(websocketServiceMock.broadcastFeedRefresh).toHaveBeenNthCalledWith(1, { reason: 'summaries' });
    expect(websocketServiceMock.broadcastFeedRefresh).toHaveBeenNthCalledWith(2, { reason: 'summaries' });
  });

  test('skips podcast audio retries during backoff or after the retry cap', async () => {
    const summaryWindow = {
      periodStart: '2026-05-20T17:00:00.000Z',
      periodEnd: '2026-05-21T05:00:00.000Z'
    };
    const existingPodcast = {
      id: 'podcast-existing',
      type: 'podcast',
      status: 'completed',
      audioStatus: 'failed',
      audioByLocale: {
        en: {
          audioStatus: 'failed',
          audioModel: 'test-tts-model',
          audioVoice: 'Charon',
          audioRetryCount: 2,
          audioFailedAt: '2026-05-21T05:00:00.000Z'
        }
      },
      periodStart: summaryWindow.periodStart,
      periodEnd: summaryWindow.periodEnd,
      titleByLocale: { en: 'News podcast', it: 'Podcast news' },
      summaryTextByLocale: { en: 'English script', it: 'Testo italiano gia generato' }
    };
    const databaseMock = {
      getPodcastSummary: jest.fn(() => existingPodcast),
      getArticlesForThematicSummary: jest.fn(() => []),
      getReaderCache: jest.fn(() => null),
      upsertPodcastSummary: jest.fn()
    };
    const aiSummaryGeneratorMock = {
      isAiSummaryGenerationAvailable: jest.fn(() => true),
      _getConfig: jest.fn(() => ({ model: 'test-summary-model' }))
    };
    const { service, aiPodcastGeneratorMock } = loadServiceWithMocks({
      databaseMock,
      env: {
        AI_PODCAST_TTS_RETRY_COOLDOWN_MS: String(10 * 60 * 1000),
        AI_PODCAST_TTS_MAX_RETRIES: '2'
      },
      aiSummaryGeneratorMock
    });

    const result = await service._generatePodcastForWindow(summaryWindow, {
      referenceDate: new Date('2026-05-21T05:30:00.000Z')
    });

    expect(result).toEqual({ summary: existingPodcast, generatedNow: false });
    expect(aiPodcastGeneratorMock.generateAudioForLocale).not.toHaveBeenCalled();
    expect(databaseMock.upsertPodcastSummary).not.toHaveBeenCalled();
  });

  test('regenerates completed podcast audio when the stored voice is stale', async () => {
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
      audioByLocale: {
        en: {
          audioStatus: 'completed',
          audioModel: 'test-tts-model',
          audioVoice: 'if_sara'
        }
      },
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
    const aiSummaryGeneratorMock = {
      isAiSummaryGenerationAvailable: jest.fn(() => true),
      _getConfig: jest.fn(() => ({ model: 'test-summary-model' }))
    };
    const { service, aiPodcastGeneratorMock } = loadServiceWithMocks({
      databaseMock,
      aiSummaryGeneratorMock,
      aiPodcastGeneratorOverrides: {
        generateAudioForLocale: jest.fn().mockResolvedValue({
          data: Buffer.from('audio').toString('base64'),
          mimeType: 'audio/mpeg',
          model: 'test-tts-model',
          voice: 'Charon'
        })
      }
    });
    const result = await service._generatePodcastForWindow(summaryWindow);

    expect(result.generatedNow).toBe(true);
    expect(aiPodcastGeneratorMock.generatePodcastForArticles).not.toHaveBeenCalled();
    expect(aiPodcastGeneratorMock.generateAudioForLocale).toHaveBeenCalledWith('English script', 'en');
    expect(databaseMock.upsertPodcastSummary).toHaveBeenCalledWith(expect.objectContaining({
      audioByLocale: {
        en: expect.objectContaining({
          audioStatus: 'completed',
          audioVoice: 'Charon'
        })
      }
    }));
  });
});
