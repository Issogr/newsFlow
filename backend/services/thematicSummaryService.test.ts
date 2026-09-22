const originalEnv = process.env;
const OPENROUTER_TEST_ENV = { OPENROUTER_API_KEY: 'test-key' };
import createMockLogger from '../test-utils/mockLogger';
import promotionalContent from '../utils/promotionalContent';
const { isPromotionalDealArticle } = promotionalContent;
import { vi as jest, type Mock } from 'vitest';
import type { MockLogger } from '../test-utils/mockLogger';

type RuntimeModule = ReturnType<typeof require>;
type MockModule = Record<string, Mock>;

interface SummaryWindow {
  periodStart: string;
  periodEnd: string;
}

interface LoadServiceWithMocksOptions {
  databaseMock?: MockModule;
  env?: NodeJS.ProcessEnv;
  aiSummaryGeneratorMock?: MockModule;
  readerServiceMock?: MockModule;
  websocketServiceMock?: MockModule;
  loggerMock?: MockLogger;
}

interface AiSummaryGeneratorOptions {
  model?: string;
  generateSummaryForArticles?: Mock;
  isAiSummaryGenerationAvailable?: Mock;
}

interface Identified {
  id: string;
}

function resetServiceRuntime(env: NodeJS.ProcessEnv = {}): void {
  jest.resetModules();
  jest.doUnmock('./aiSummaryGenerator');
  jest.doUnmock('./database');
  jest.doUnmock('./readerService');
  jest.doUnmock('./websocketService');
  jest.doUnmock('../utils/logger');
  process.env = {
    ...originalEnv,
    ...env
  };
}

async function loadService({ env = {} }: { env?: NodeJS.ProcessEnv } = {}): Promise<RuntimeModule> {
  resetServiceRuntime(env);
  return (await import('./thematicSummaryService')).default;
}

afterEach(() => {
  process.env = originalEnv;
  jest.resetModules();
});

describe('thematicSummaryService', () => {
  let thematicSummaryService: RuntimeModule;

  beforeEach(async () => {
    thematicSummaryService = await loadService({
      env: {
        AI_SUMMARY_TIME_ZONE: 'Europe/Rome'
      }
    });
  });

  afterEach(() => {
    thematicSummaryService.stopScheduler();
  });

  test('builds one daily 20:00 window before and after the current slot', () => {
    expect(thematicSummaryService._getLatestDueWindow(new Date('2026-05-21T11:10:00.000Z'))).toEqual({
      periodStart: '2026-05-19T18:00:00.000Z',
      periodEnd: '2026-05-20T18:00:00.000Z'
    });

    expect(thematicSummaryService._getLatestDueWindow(new Date('2026-05-21T18:01:00.000Z'))).toEqual({
      periodStart: '2026-05-20T18:00:00.000Z',
      periodEnd: '2026-05-21T18:00:00.000Z'
    });
  });

  test('defaults summary scheduling to Europe/Rome instead of the container UTC clock', () => {
    expect(thematicSummaryService._getSummaryTimeZone()).toBe('Europe/Rome');
    expect(thematicSummaryService._getLatestDueWindow(new Date('2026-01-21T07:05:00.000Z'))).toEqual({
      periodStart: '2026-01-19T19:00:00.000Z',
      periodEnd: '2026-01-20T19:00:00.000Z'
    });
  });

  test('keeps entertainment and science as separate summaries', () => {
    const topicKeys = thematicSummaryService._getSummaryTopics().map((topic: { key: string }) => topic.key);

    expect(topicKeys).toEqual(['technology', 'politics', 'crime', 'sport', 'entertainment', 'science']);
  });

  test('classifies promotional shopping deal posts without blocking price-related news', () => {
    expect(isPromotionalDealArticle({
      title: 'Govee Table Lamp 2 Pro hits its lowest price yet',
      description: 'The TV OLED LG B5 is $1,499.99 with a $200 gift card at Best Buy.',
      url: 'https://example.com/deals/govee-lg-oled-best-buy'
    })).toBe(true);
    expect(isPromotionalDealArticle({
      title: 'Twelve South AirFly Pro 2 reaches one of its best prices before summer travel',
      description: 'The Bluetooth adapter lets travelers use wireless headphones with in-flight entertainment systems.'
    })).toBe(true);
    expect(isPromotionalDealArticle({
      title: 'Inflation pressures household budgets as energy prices rise',
      description: 'Economists say the price increase is tied to lower supply and higher demand.'
    })).toBe(false);
  });

  test('keeps daily boundaries at local 20:00 across daylight-saving changes', () => {
    expect(thematicSummaryService._getLatestDueWindow('2026-03-29T18:00:00.000Z')).toEqual({
      periodStart: '2026-03-28T19:00:00.000Z',
      periodEnd: '2026-03-29T18:00:00.000Z'
    });
    expect(thematicSummaryService._getNextDueWindow('2026-10-24T18:00:00.000Z')).toEqual({
      periodStart: '2026-10-24T18:00:00.000Z',
      periodEnd: '2026-10-25T19:00:00.000Z'
    });
  });

  test('builds the next due window for reader prewarm', () => {
    expect(thematicSummaryService._getNextDueWindow(new Date('2026-05-21T05:30:00.000Z'))).toEqual({
      periodStart: '2026-05-20T18:00:00.000Z',
      periodEnd: '2026-05-21T18:00:00.000Z'
    });
    expect(thematicSummaryService._getNextDueWindow(new Date('2026-05-21T18:00:00.000Z'))).toEqual({
      periodStart: '2026-05-21T18:00:00.000Z',
      periodEnd: '2026-05-22T18:00:00.000Z'
    });
  });
});

function createSummaryWindow(): SummaryWindow {
  return {
    periodStart: '2026-05-20T17:00:00.000Z',
    periodEnd: '2026-05-21T05:00:00.000Z'
  };
}

function createAiSummaryGeneratorMock(
  { model = 'test-model', ...overrides }: AiSummaryGeneratorOptions = {}
): MockModule {
  return {
    isAiSummaryGenerationAvailable: jest.fn(() => true),
    generateSummaryForArticles: jest.fn(),
    _getConfig: jest.fn(() => ({ model })),
    ...overrides
  };
}

function createDatabaseMock(overrides: MockModule = {}): MockModule {
  const databaseMock: MockModule = {
    getThematicSummary: jest.fn(() => null),
    listLatestThematicSummaries: jest.fn(() => []),
    getArticlesForThematicSummary: jest.fn(() => []),
    getReaderCache: jest.fn(() => null),
    hasPendingTopicProcessingForThematicSummary: jest.fn(() => false),
    upsertThematicSummary: jest.fn((payload) => payload),
    pruneSummaryHistory: jest.fn(() => ({ thematicSummaries: 0 })),
    ...overrides
  };

  databaseMock.getReaderCaches ||= jest.fn((articleIds: string[] = [], userId: string | null = null) => new Map(
    articleIds.map((articleId: string) => [articleId, databaseMock.getReaderCache(articleId, userId)])
  ));

  return databaseMock;
}

async function loadServiceWithMocks({
  databaseMock,
  env = {},
  aiSummaryGeneratorMock,
  readerServiceMock,
  websocketServiceMock,
  loggerMock
}: LoadServiceWithMocksOptions = {}) {
  resetServiceRuntime(env);

  const mocks: {
    readerServiceMock: MockModule;
    websocketServiceMock: MockModule;
    loggerMock: MockLogger;
  } = {
    readerServiceMock: readerServiceMock || { getReaderArticle: jest.fn() },
    websocketServiceMock: websocketServiceMock || { broadcastFeedRefresh: jest.fn() },
    loggerMock: loggerMock || createMockLogger()
  };

  jest.doMock('./database', () => ({ default: createDatabaseMock(databaseMock) }));
  if (aiSummaryGeneratorMock) {
    jest.doMock('./aiSummaryGenerator', () => ({ default: aiSummaryGeneratorMock }));
  }
  jest.doMock('./readerService', () => ({ default: mocks.readerServiceMock }));
  jest.doMock('./websocketService', () => ({ default: mocks.websocketServiceMock }));
  jest.doMock('../utils/logger', () => ({ default: mocks.loggerMock }));

  return {
    service: (await import('./thematicSummaryService')).default as RuntimeModule,
    ...mocks
  };
}

describe('thematic summary listing', () => {
  test('lists the latest topic summaries with their topic labels', async () => {
    const databaseMock = {
      listLatestThematicSummaries: jest.fn(() => [
        {
          id: 'summary-technology',
          topicKey: 'technology',
          periodStart: '2026-05-21T05:00:00.000Z',
          periodEnd: '2026-05-21T17:00:00.000Z',
          status: 'completed'
        }
      ])
    };

    const { service } = await loadServiceWithMocks({
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
        topicLabel: 'Technology'
      })
    ]);
    expect(databaseMock.listLatestThematicSummaries).toHaveBeenCalledWith([
      'technology',
      'politics',
      'crime',
      'sport',
      'entertainment',
      'science'
    ], 1);
  });

  test('keeps latest topic summaries on one coherent window', async () => {
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
      ])
    };

    const { service } = await loadServiceWithMocks({
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

  test('marks a current-window briefing stale after its input refresh fails', async () => {
    const { service } = await loadServiceWithMocks({
      env: OPENROUTER_TEST_ENV,
      databaseMock: { listLatestThematicSummaries: jest.fn(() => [{
        id: 'science-current', topicKey: 'science', periodStart: '2026-05-20T18:00:00.000Z',
        periodEnd: '2026-05-21T18:00:00.000Z', status: 'completed', failureCategory: 'invalid_output'
      }]) }
    });
    expect(service.getLatestSummaries({ referenceDate: '2026-05-21T18:05:00.000Z' }).items[0]).toMatchObject({ isStale: true });
  });

  test('hides topics when the latest briefing is empty', async () => {
    const databaseMock = {
      listLatestThematicSummaries: jest.fn(() => [
        {
          id: 'summary-technology-current',
          topicKey: 'technology',
          periodStart: '2026-05-21T06:00:00.000Z',
          periodEnd: '2026-05-21T18:00:00.000Z',
          status: 'empty'
        }
      ])
    };
    const { service } = await loadServiceWithMocks({
      databaseMock,
      env: { OPENROUTER_API_KEY: 'test-key' }
    });

    expect(service.getLatestSummaries().items).toEqual([]);
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

    const { service } = await loadServiceWithMocks({
      databaseMock,
      env: {
        OPENROUTER_API_KEY: 'test-key',
        AI_SUMMARY_READER_PREWARM_ENABLED: 'true'
      },
      readerServiceMock
    });
    const firstReferenceDate = new Date('2026-05-21T17:45:00.000Z');
    const window = service._getNextDueWindow(firstReferenceDate);

    await expect(service.prewarmReaderCacheForDueWindow({
      referenceDate: firstReferenceDate,
      window
    })).resolves.toMatchObject({ attemptedCount: 1, cachedCount: 1 });
    await expect(service.prewarmReaderCacheForDueWindow({
      referenceDate: new Date('2026-05-21T17:50:00.000Z'),
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

    const { service } = await loadServiceWithMocks({
      databaseMock,
      env: {
        OPENROUTER_API_KEY: 'test-key',
        AI_SUMMARY_READER_PREWARM_ENABLED: 'true',
        AI_SUMMARY_READER_PREWARM_RETRY_COOLDOWN_MS: String(10 * 60 * 1000)
      },
      readerServiceMock
    });
    const firstReferenceDate = new Date('2026-05-21T17:45:00.000Z');
    const window = service._getNextDueWindow(firstReferenceDate);

    await expect(service.prewarmReaderCacheForDueWindow({
      referenceDate: firstReferenceDate,
      window
    })).resolves.toMatchObject({ attemptedCount: 1, cachedCount: 0 });
    await expect(service.prewarmReaderCacheForDueWindow({
      referenceDate: new Date('2026-05-21T17:50:00.000Z'),
      window
    })).resolves.toMatchObject({ attemptedCount: 0 });
    await expect(service.prewarmReaderCacheForDueWindow({
      referenceDate: new Date('2026-05-21T17:56:00.000Z'),
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

    const { service } = await loadServiceWithMocks({
      databaseMock,
      env: {
        OPENROUTER_API_KEY: 'test-key',
        AI_SUMMARY_READER_PREWARM_ENABLED: 'true'
      },
      readerServiceMock
    });
    const firstReference = new Date('2026-05-21T17:45:00.000Z');
    const secondReference = new Date('2026-05-21T18:45:00.000Z');
    const thirdReference = new Date('2026-05-22T18:45:00.000Z');

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

  test('prewarms only articles selected for summary prompts', async () => {
    const articles = [
      { id: 'selected', source: 'BBC', title: 'Selected', description: 'RSS', pubDate: '2026-05-21T04:00:00.000Z' },
      { id: 'not-selected', source: 'Wired', title: 'Not selected', description: 'RSS', pubDate: '2026-05-21T03:00:00.000Z' }
    ];
    const readerServiceMock = {
      getReaderArticle: jest.fn().mockResolvedValue({ contentText: 'Useful reader content '.repeat(30), fallback: false })
    };
    const { service } = await loadServiceWithMocks({
      databaseMock: {
        getArticlesForThematicSummary: jest.fn(({ topics }) => topics.includes('Scienza') ? articles : []),
        getReaderCache: jest.fn(() => null)
      },
      env: {
        OPENROUTER_API_KEY: 'test-key',
        AI_SUMMARY_READER_PREWARM_ENABLED: 'true',
        AI_SUMMARY_PROMPT_MAX_ARTICLES: '1'
      },
      readerServiceMock
    });
    const referenceDate = new Date('2026-05-21T17:45:00.000Z');

    await expect(service.prewarmReaderCacheForDueWindow({
      referenceDate,
      window: service._getNextDueWindow(referenceDate)
    })).resolves.toMatchObject({ attemptedCount: 1 });
    expect(readerServiceMock.getReaderArticle).toHaveBeenCalledTimes(1);
    expect(readerServiceMock.getReaderArticle).toHaveBeenCalledWith('selected', expect.any(Object));
  });

  test('prioritizes independently covered stories before applying the prompt cap', async () => {
    const readerServiceMock = {
      getReaderArticle: jest.fn().mockResolvedValue({ contentText: 'Useful reader content '.repeat(30), fallback: false })
    };
    const articles = [
      { id: 'single', title: 'Latest isolated story', source: 'BBC', pubDate: '2026-05-21T17:00:00.000Z' },
      { id: 'corroborated', title: 'Major research finding', source: 'Nature', storyGroupId: 'research', pubDate: '2026-05-21T16:00:00.000Z' },
      { id: 'another-report', title: 'New research confirmed', source: 'BBC', storyGroupId: 'research', pubDate: '2026-05-21T15:00:00.000Z' }
    ];
    const { service } = await loadServiceWithMocks({
      databaseMock: { getArticlesForThematicSummary: jest.fn(({ topics }) => topics.includes('Scienza') ? articles : []) },
      env: { ...OPENROUTER_TEST_ENV, AI_SUMMARY_PROMPT_MAX_ARTICLES: '1' },
      readerServiceMock
    });
    await service.prewarmReaderCacheForDueWindow({ referenceDate: '2026-05-21T17:45:00.000Z' });
    expect(readerServiceMock.getReaderArticle).toHaveBeenCalledTimes(1);
    expect(readerServiceMock.getReaderArticle).toHaveBeenCalledWith('corroborated', expect.any(Object));
  });

  test('selects at most 24 source-balanced stories by default', async () => {
    const articles = Array.from({ length: 60 }, (_, index) => ({
      id: `article-${index}`, title: `Distinct article number ${index}`, source: `Publisher ${Math.floor(index / 10)}`,
      pubDate: '2026-05-21T16:00:00.000Z'
    }));
    const readerServiceMock = {
      getReaderArticle: jest.fn().mockResolvedValue({ contentText: 'Useful reader content '.repeat(30), fallback: false })
    };
    const { service } = await loadServiceWithMocks({
      databaseMock: { getArticlesForThematicSummary: jest.fn(({ topics }) => topics.includes('Scienza') ? articles : []) },
      env: OPENROUTER_TEST_ENV,
      readerServiceMock
    });
    await service.prewarmReaderCacheForDueWindow({ referenceDate: '2026-05-21T17:45:00.000Z' });
    const selectedIds = new Set(readerServiceMock.getReaderArticle.mock.calls.map(([id]) => id));
    const selected = articles.filter((article) => selectedIds.has(article.id));
    expect(selected).toHaveLength(24);
    expect(new Set(selected.map((article) => article.source)).size).toBe(6);
  });

  test('skips prewarm and generation when thematic summaries are disabled', async () => {
    const articles = [
      { id: 'older', source: 'BBC', title: 'Older', description: 'RSS', pubDate: '2026-05-21T03:00:00.000Z' },
      { id: 'newer', source: 'Wired', title: 'Newer', description: 'RSS', pubDate: '2026-05-21T04:00:00.000Z' }
    ];
    const readerServiceMock = {
      getReaderArticle: jest.fn().mockResolvedValue({ contentText: 'Useful reader content '.repeat(30), fallback: false })
    };
    const { service } = await loadServiceWithMocks({
      databaseMock: {
        getArticlesForThematicSummary: jest.fn(({ topics }) => topics.includes('Scienza') ? articles : []),
        getReaderCache: jest.fn(() => null)
      },
      env: {
        OPENROUTER_API_KEY: 'test-key',
        AI_SUMMARY_READER_PREWARM_ENABLED: 'true',
        AI_SUMMARY_PROMPT_MAX_ARTICLES: '1'
      },
      aiSummaryGeneratorMock: createAiSummaryGeneratorMock({
        isAiSummaryGenerationAvailable: jest.fn(() => false)
      }),
      readerServiceMock
    });
    const referenceDate = new Date('2026-05-21T17:45:00.000Z');

    await expect(service.prewarmReaderCacheForDueWindow({
      referenceDate,
      window: service._getNextDueWindow(referenceDate)
    })).resolves.toMatchObject({ skipped: true, reason: 'disabled', attemptedCount: 0 });
    expect(readerServiceMock.getReaderArticle).not.toHaveBeenCalled();
    await expect(service.generateDueSummaries({ referenceDate })).resolves.toMatchObject({ items: [] });
  });
});

describe('thematic summary generation coalescing', () => {
  test('runs one trailing generation for triggers received during active work', async () => {
    const summaryWindow = createSummaryWindow();
    const articleA = { id: 'article-a', source: 'BBC', title: 'Article A', description: 'A', pubDate: summaryWindow.periodStart };
    const articleB = { id: 'article-b', source: 'Wired', title: 'Article B', description: 'B', pubDate: summaryWindow.periodStart };
    let currentArticles = [articleA];
    let storedTechnologySummary: Record<string, unknown> | null = null;
    let resolveFirstGeneration!: (value: Record<string, unknown>) => void;
    const firstGeneration = new Promise<Record<string, unknown>>((resolve) => {
      resolveFirstGeneration = resolve;
    });
    let activeCalls = 0;
    let maxActiveCalls = 0;
    const generateSummaryForArticles = jest.fn(async () => {
      activeCalls += 1;
      maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
      try {
        if (generateSummaryForArticles.mock.calls.length === 1) {
          return await firstGeneration;
        }
        return { summaryText: 'Second', summaryTextByLocale: { en: 'Second', it: 'Secondo' }, model: 'test-model' };
      } finally {
        activeCalls -= 1;
      }
    });
    const databaseMock = {
      getThematicSummary: jest.fn((topicKey) => topicKey === 'technology'
        ? storedTechnologySummary
        : { topicKey, status: 'empty', periodStart: summaryWindow.periodStart, periodEnd: summaryWindow.periodEnd }),
      getArticlesForThematicSummary: jest.fn(({ topics }) => topics.includes('Tecnologia') ? currentArticles : []),
      getReaderCache: jest.fn(() => null),
      upsertThematicSummary: jest.fn((payload) => {
        if (payload.topicKey === 'technology') {
          storedTechnologySummary = payload;
        }
        return payload;
      })
    };
    const { service } = await loadServiceWithMocks({
      databaseMock,
      env: OPENROUTER_TEST_ENV,
      aiSummaryGeneratorMock: createAiSummaryGeneratorMock({ generateSummaryForArticles })
    });

    const firstCall = service.generateDueSummaries({ window: summaryWindow });
    await new Promise((resolve) => setTimeout(resolve, 0));
    currentArticles = [articleA, articleB];
    const secondCall = service.generateDueSummaries({ window: summaryWindow });
    const thirdCall = service.generateDueSummaries({ window: summaryWindow });
    resolveFirstGeneration({ summaryText: 'First', summaryTextByLocale: { en: 'First', it: 'Primo' }, model: 'test-model' });

    await Promise.all([firstCall, secondCall, thirdCall]);

    expect(generateSummaryForArticles).toHaveBeenCalledTimes(2);
    const firstGenerationCall = generateSummaryForArticles.mock.calls[0] as unknown as [unknown, Identified[]];
    const secondGenerationCall = generateSummaryForArticles.mock.calls[1] as unknown as [unknown, Identified[]];
    expect(firstGenerationCall[1].map((article) => article.id)).toEqual(['article-a']);
    expect(secondGenerationCall[1].map((article) => article.id)).toEqual(['article-a', 'article-b']);
    expect(maxActiveCalls).toBe(1);
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
      getArticlesForThematicSummary: jest.fn(({ topics }) => topics.includes('Tecnologia') ? [dealArticle, article] : []),
      getReaderCache: jest.fn(() => null),
      upsertThematicSummary: jest.fn(() => completedSummary),
      pruneSummaryHistory: jest.fn(() => ({ thematicSummaries: 1 }))
    };
    const aiSummaryGeneratorMock = createAiSummaryGeneratorMock({
      generateSummaryForArticles: jest.fn().mockResolvedValue({
        summaryText: 'English text',
        summaryTextByLocale: { en: 'English text', it: 'Testo italiano' },
        model: 'test-model'
      })
    });
    const websocketServiceMock = { broadcastFeedRefresh: jest.fn() };

    const { service } = await loadServiceWithMocks({
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
    const persistedSummary = (databaseMock.upsertThematicSummary.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(persistedSummary).not.toHaveProperty('title');
    expect(persistedSummary).not.toHaveProperty('titleByLocale');
    expect(databaseMock.pruneSummaryHistory).toHaveBeenCalledWith({
      periodEnd: summaryWindow.periodEnd,
      topicKeys: ['technology'],
      thematicRetainCount: 1
    });
    expect(websocketServiceMock.broadcastFeedRefresh).toHaveBeenCalledWith({ reason: 'summaries' });
  });

  test('does not broadcast when all due summaries already exist', async () => {
    const summaryWindow = createSummaryWindow();
    const existingSummary = {
      topicKey: 'technology',
      status: 'completed',
      periodStart: summaryWindow.periodStart,
      periodEnd: summaryWindow.periodEnd
    };
    const databaseMock = {
      getThematicSummary: jest.fn((topicKey) => ({ ...existingSummary, topicKey })),
      listLatestThematicSummaries: jest.fn(() => []),
      getArticlesForThematicSummary: jest.fn(() => []),
      getReaderCache: jest.fn(() => null),
      upsertThematicSummary: jest.fn(),
      pruneSummaryHistory: jest.fn()
    };
    const aiSummaryGeneratorMock = createAiSummaryGeneratorMock();
    const websocketServiceMock = { broadcastFeedRefresh: jest.fn() };

    const { service } = await loadServiceWithMocks({
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

  test('uses the daily 20:00 window for topic summaries', async () => {
    const existingSummary = {
      status: 'completed',
      periodStart: '2026-05-20T17:00:00.000Z',
      periodEnd: '2026-05-21T05:00:00.000Z'
    };
    const databaseMock = {
      getThematicSummary: jest.fn((topicKey) => ({ ...existingSummary, topicKey })),
      listLatestThematicSummaries: jest.fn(() => []),
      getArticlesForThematicSummary: jest.fn(() => []),
      getReaderCache: jest.fn(() => null),
      upsertThematicSummary: jest.fn(),
      pruneSummaryHistory: jest.fn()
    };
    const aiSummaryGeneratorMock = createAiSummaryGeneratorMock();

    const { service } = await loadServiceWithMocks({ databaseMock, env: OPENROUTER_TEST_ENV, aiSummaryGeneratorMock });
    await service.generateDueSummaries({ referenceDate: new Date('2026-05-21T11:10:00.000Z') });

    expect(databaseMock.getThematicSummary).toHaveBeenCalledWith('technology', '2026-05-19T18:00:00.000Z', '2026-05-20T18:00:00.000Z');
    expect(databaseMock.pruneSummaryHistory).not.toHaveBeenCalled();
  });

  test('persists empty summary windows without calling the model', async () => {
    const summaryWindow = createSummaryWindow();
    const databaseMock = {
      getThematicSummary: jest.fn(() => null),
      listLatestThematicSummaries: jest.fn(() => []),
      getArticlesForThematicSummary: jest.fn(() => []),
      getReaderCache: jest.fn(() => null),
      upsertThematicSummary: jest.fn((payload) => payload)
    };
    const aiSummaryGeneratorMock = createAiSummaryGeneratorMock();
    const websocketServiceMock = { broadcastFeedRefresh: jest.fn() };

    const { service } = await loadServiceWithMocks({
      databaseMock,
      aiSummaryGeneratorMock,
      websocketServiceMock
    });
    const result = await service.generateDueSummaries({ window: summaryWindow });

    expect(result.items).toHaveLength(6);
    expect(result.items.every((summary: { status: string }) => summary.status === 'empty')).toBe(true);
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
    const summaryWindow = createSummaryWindow();
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
      getArticlesForThematicSummary: jest.fn(({ topics }) => topics.includes('Tecnologia') ? [article] : []),
      getReaderCache: jest.fn(() => null),
      upsertThematicSummary: jest.fn(() => completedSummary),
      pruneSummaryHistory: jest.fn(() => ({ thematicSummaries: 1 }))
    };
    const aiSummaryGeneratorMock = createAiSummaryGeneratorMock({
      generateSummaryForArticles: jest.fn().mockResolvedValue({
        summaryText: 'English text [1]',
        summaryTextByLocale: { en: 'English text [1]', it: 'Testo italiano [1]' },
        model: 'test-model'
      })
    });
    const websocketServiceMock = { broadcastFeedRefresh: jest.fn() };

    const { service } = await loadServiceWithMocks({
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
      thematicRetainCount: 1
    });
    expect(websocketServiceMock.broadcastFeedRefresh).toHaveBeenCalledWith({ reason: 'summaries' });
  });

  test('regenerates a completed summary when later articles change the selected source set', async () => {
    const summaryWindow = createSummaryWindow();
    const oldArticle = {
      id: 'article-old',
      source: 'BBC',
      title: 'Earlier AI update',
      description: 'Earlier article description',
      url: 'https://example.com/earlier-ai',
      pubDate: '2026-05-20T18:00:00.000Z'
    };
    const newArticle = {
      id: 'article-new',
      source: 'Reuters',
      title: 'Later AI update',
      description: 'Later article description',
      url: 'https://example.com/later-ai',
      pubDate: '2026-05-20T19:00:00.000Z'
    };
    const staleTechnologySummary = {
      topicKey: 'technology',
      status: 'completed',
      periodStart: summaryWindow.periodStart,
      periodEnd: summaryWindow.periodEnd,
      sources: [{ index: 1, articleId: 'article-old', title: oldArticle.title, source: oldArticle.source }]
    };
    const completedSummary = {
      ...staleTechnologySummary,
      sources: [
        { index: 1, articleId: 'article-old', title: oldArticle.title, source: oldArticle.source },
        { index: 2, articleId: 'article-new', title: newArticle.title, source: newArticle.source }
      ],
      articleCount: 2,
      summaryTextByLocale: { en: 'English text [1]', it: 'Testo italiano [1]' }
    };
    const databaseMock = {
      getThematicSummary: jest.fn((topicKey) => (topicKey === 'technology'
        ? staleTechnologySummary
        : { topicKey, status: 'completed', periodStart: summaryWindow.periodStart, periodEnd: summaryWindow.periodEnd, sources: [] })),
      listLatestThematicSummaries: jest.fn(() => []),
      getArticlesForThematicSummary: jest.fn(({ topics }) => topics.includes('Tecnologia') ? [oldArticle, newArticle] : []),
      getReaderCache: jest.fn(() => null),
      upsertThematicSummary: jest.fn(() => completedSummary),
      pruneSummaryHistory: jest.fn(() => ({ thematicSummaries: 1 }))
    };
    const aiSummaryGeneratorMock = createAiSummaryGeneratorMock({
      generateSummaryForArticles: jest.fn().mockResolvedValue({
        summaryText: 'English text [1]',
        summaryTextByLocale: { en: 'English text [1]', it: 'Testo italiano [1]' },
        model: 'test-model'
      })
    });
    const websocketServiceMock = { broadcastFeedRefresh: jest.fn() };

    const { service } = await loadServiceWithMocks({
      databaseMock,
      env: OPENROUTER_TEST_ENV,
      aiSummaryGeneratorMock,
      websocketServiceMock
    });
    const result = await service.generateDueSummaries({ window: summaryWindow });

    expect(result.items).toEqual(expect.arrayContaining([completedSummary]));
    expect(aiSummaryGeneratorMock.generateSummaryForArticles).toHaveBeenCalledTimes(1);
    const generatedArticles = (aiSummaryGeneratorMock.generateSummaryForArticles.mock.calls[0] as unknown as [unknown, Identified[]])[1];
    expect(generatedArticles.map((article) => article.id)).toEqual(['article-old', 'article-new']);
    expect(databaseMock.upsertThematicSummary).toHaveBeenCalledWith(expect.objectContaining({
      topicKey: 'technology',
      status: 'completed',
      articleCount: 2,
      sources: [
        expect.objectContaining({ articleId: 'article-old' }),
        expect.objectContaining({ articleId: 'article-new' })
      ]
    }));
    expect(databaseMock.pruneSummaryHistory).toHaveBeenCalledWith({
      periodEnd: summaryWindow.periodEnd,
      topicKeys: ['technology'],
      thematicRetainCount: 1
    });
    expect(websocketServiceMock.broadcastFeedRefresh).toHaveBeenCalledWith({ reason: 'summaries' });
  });

  test.each(['replacement at cap', 'RSS correction', 'reader enrichment', 'retention only'])('tracks input revisions: %s', async (change) => {
    const window = createSummaryWindow();
    let articles = [
      { id: 'one', title: 'First article', description: 'Original report', source: 'BBC', pubDate: window.periodStart },
      { id: 'two', title: 'Second article', description: 'Another report', source: 'Reuters', pubDate: window.periodStart }
    ];
    let readerText = '';
    let stored: Record<string, unknown> | null = null;
    const generator = createAiSummaryGeneratorMock({ generateSummaryForArticles: jest.fn().mockResolvedValue({
      summaryText: 'Grounded summary [1].', summaryTextByLocale: { en: 'Grounded summary [1].', it: 'Sintesi verificata [1].' },
      inputArticles: [{ ref: 1, description: 'Exact model evidence' }], model: 'test-model'
    }) });
    const { service } = await loadServiceWithMocks({
      env: { ...OPENROUTER_TEST_ENV, AI_SUMMARY_PROMPT_MAX_ARTICLES: '2' },
      databaseMock: {
        getThematicSummary: jest.fn((key) => key === 'technology' ? stored : null),
        getArticlesForThematicSummary: jest.fn(({ topics }) => topics.includes('Tecnologia') ? articles : []),
        getReaderCache: jest.fn(() => ({ contentText: readerText })),
        upsertThematicSummary: jest.fn((payload) => {
          if (payload.topicKey === 'technology') stored = payload;
          return payload;
        })
      },
      aiSummaryGeneratorMock: generator
    });
    await service.generateDueSummaries({ window });
    await service.generateDueSummaries({ window });
    expect(generator.generateSummaryForArticles).toHaveBeenCalledTimes(1);
    expect(stored).toMatchObject({ inputArticles: [{ ref: 1, description: 'Exact model evidence' }] });
    if (change === 'replacement at cap') articles = [{ ...articles[0], id: 'new', title: 'Late arriving report' }, articles[1]];
    if (change === 'RSS correction') articles = [{ ...articles[0], description: 'Correction: no funding was approved.' }, articles[1]];
    if (change === 'reader enrichment') readerText = 'New full article evidence. '.repeat(30);
    if (change === 'retention only') articles = [articles[1]];
    await service.generateDueSummaries({ window });
    await service.generateDueSummaries({ window });
    expect(generator.generateSummaryForArticles).toHaveBeenCalledTimes(change === 'retention only' ? 1 : 2);
  });

  test('keeps a completed summary when retention only removes selected articles', async () => {
    const summaryWindow = createSummaryWindow();
    const retainedArticle = {
      id: 'article-retained',
      source: 'BBC',
      title: 'Retained AI update',
      description: 'Retained article description',
      pubDate: summaryWindow.periodStart
    };
    const completedTechnologySummary = {
      topicKey: 'technology',
      status: 'completed',
      periodStart: summaryWindow.periodStart,
      periodEnd: summaryWindow.periodEnd,
      sources: [
        { articleId: 'article-expired' },
        { articleId: retainedArticle.id }
      ]
    };
    const databaseMock = {
      getThematicSummary: jest.fn((topicKey) => topicKey === 'technology'
        ? completedTechnologySummary
        : { topicKey, status: 'completed', periodStart: summaryWindow.periodStart, periodEnd: summaryWindow.periodEnd, sources: [] }),
      getArticlesForThematicSummary: jest.fn(({ topics }) => topics.includes('Tecnologia') ? [retainedArticle] : []),
      upsertThematicSummary: jest.fn()
    };
    const aiSummaryGeneratorMock = createAiSummaryGeneratorMock();

    const { service } = await loadServiceWithMocks({ databaseMock, env: OPENROUTER_TEST_ENV, aiSummaryGeneratorMock });
    const result = await service.generateDueSummaries({ window: summaryWindow });

    expect(result.items).toEqual(expect.arrayContaining([completedTechnologySummary]));
    expect(aiSummaryGeneratorMock.generateSummaryForArticles).not.toHaveBeenCalled();
    expect(databaseMock.upsertThematicSummary).not.toHaveBeenCalled();
  });

  test('waits for pending topic processing before generating non-empty summaries', async () => {
    const summaryWindow = createSummaryWindow();
    const databaseMock = {
      getThematicSummary: jest.fn(() => null),
      getArticlesForThematicSummary: jest.fn(() => [{ id: 'article-1' }]),
      hasPendingTopicProcessingForThematicSummary: jest.fn(() => true),
      upsertThematicSummary: jest.fn()
    };
    const aiSummaryGeneratorMock = createAiSummaryGeneratorMock();
    const { service } = await loadServiceWithMocks({ databaseMock, env: OPENROUTER_TEST_ENV, aiSummaryGeneratorMock });

    const result = await service.generateDueSummaries({
      window: summaryWindow,
      referenceDate: new Date('2026-05-21T05:05:00.000Z')
    });

    expect(result.items).toEqual([]);
    expect(aiSummaryGeneratorMock.generateSummaryForArticles).not.toHaveBeenCalled();
    expect(databaseMock.upsertThematicSummary).not.toHaveBeenCalled();
  });

  test('keeps a completed summary when regenerating its stale article set fails', async () => {
    const summaryWindow = createSummaryWindow();
    const oldArticle = {
      id: 'article-old',
      source: 'BBC',
      title: 'Earlier AI update',
      description: 'Earlier article description',
      pubDate: summaryWindow.periodStart
    };
    const newArticle = {
      id: 'article-new',
      source: 'Reuters',
      title: 'Later AI update',
      description: 'Later article description',
      pubDate: summaryWindow.periodStart
    };
    let storedTechnologySummary = {
      id: 'summary-technology',
      topicKey: 'technology',
      topicLabel: 'Technology',
      topics: ['Tecnologia'],
      status: 'completed',
      periodStart: summaryWindow.periodStart,
      periodEnd: summaryWindow.periodEnd,
      summaryText: 'Previous summary [1].',
      summaryTextByLocale: { en: 'Previous summary [1].', it: 'Riepilogo precedente [1].' },
      sources: [{ index: 1, articleId: oldArticle.id, title: oldArticle.title, source: oldArticle.source }],
      articleCount: 1,
      model: 'old-model',
      generatedAt: '2026-05-21T05:00:00.000Z'
    };
    const databaseMock = {
      getThematicSummary: jest.fn((topicKey) => topicKey === 'technology'
        ? storedTechnologySummary
        : { topicKey, status: 'completed', periodStart: summaryWindow.periodStart, periodEnd: summaryWindow.periodEnd, sources: [] }),
      getArticlesForThematicSummary: jest.fn(({ topics }) => topics.includes('Tecnologia') ? [oldArticle, newArticle] : []),
      upsertThematicSummary: jest.fn((payload) => {
        storedTechnologySummary = payload;
        return payload;
      }),
      pruneSummaryHistory: jest.fn()
    };
    const aiSummaryGeneratorMock = createAiSummaryGeneratorMock({
      generateSummaryForArticles: jest.fn().mockRejectedValue(new Error('OpenRouter network timeout'))
    });
    const websocketServiceMock = { broadcastFeedRefresh: jest.fn() };
    const { service } = await loadServiceWithMocks({
      databaseMock,
      env: OPENROUTER_TEST_ENV,
      aiSummaryGeneratorMock,
      websocketServiceMock
    });

    const result = await service.generateDueSummaries({ window: summaryWindow });
    await service.generateDueSummaries({ window: summaryWindow });

    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'summary-technology',
        status: 'completed',
        summaryText: 'Previous summary [1].',
        sources: [expect.objectContaining({ articleId: 'article-old' })],
        failureCategory: 'provider_unavailable',
        retryCount: 1,
        generatedAt: '2026-05-21T05:00:00.000Z',
        lastAttemptAt: expect.any(String)
      })
    ]));
    expect(aiSummaryGeneratorMock.generateSummaryForArticles).toHaveBeenCalledTimes(1);
    expect(databaseMock.upsertThematicSummary).toHaveBeenCalledTimes(1);
    expect(databaseMock.pruneSummaryHistory).not.toHaveBeenCalled();
    expect(websocketServiceMock.broadcastFeedRefresh).toHaveBeenCalledTimes(1);
    expect(websocketServiceMock.broadcastFeedRefresh).toHaveBeenCalledWith({ reason: 'summaries' });
  });

  test('deduplicates topic summaries and queries each topic once', async () => {
    const summaryWindow = createSummaryWindow();
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
      pruneSummaryHistory: jest.fn(() => ({ thematicSummaries: 0 }))
    };
    const aiSummaryGeneratorMock = createAiSummaryGeneratorMock({
      generateSummaryForArticles: jest.fn().mockResolvedValue({
        summaryText: 'English text [1]',
        summaryTextByLocale: { en: 'English text [1]', it: 'Testo italiano [1]' },
        model: 'test-model'
      })
    });

    const { service } = await loadServiceWithMocks({ databaseMock, env: OPENROUTER_TEST_ENV, aiSummaryGeneratorMock });

    await service.generateDueSummaries({ window: summaryWindow });

    expect(databaseMock.getArticlesForThematicSummary).toHaveBeenCalledTimes(6);
    const technologySummaryCall = (aiSummaryGeneratorMock.generateSummaryForArticles.mock.calls as unknown as Array<[{ key: string }, Identified[]]>)
      .find(([topicConfig]) => topicConfig.key === 'technology')!;
    expect(technologySummaryCall[1].map((article) => article.id)).toEqual(['tech-1']);
  });

  test('does not retry recently failed summaries on every scheduler tick', async () => {
    const summaryWindow = createSummaryWindow();
    const failedSummary = {
      topicKey: 'technology',
      status: 'failed',
      periodStart: summaryWindow.periodStart,
      periodEnd: summaryWindow.periodEnd,
      generatedAt: '2026-05-21T05:00:00.000Z'
    };
    const databaseMock = {
      getThematicSummary: jest.fn((topicKey) => (topicKey === 'technology'
        ? failedSummary
        : { topicKey, status: 'empty', periodStart: summaryWindow.periodStart, periodEnd: summaryWindow.periodEnd })),
      listLatestThematicSummaries: jest.fn(() => []),
      getArticlesForThematicSummary: jest.fn(() => []),
      getReaderCache: jest.fn(() => null),
      upsertThematicSummary: jest.fn()
    };
    const aiSummaryGeneratorMock = createAiSummaryGeneratorMock();
    const websocketServiceMock = { broadcastFeedRefresh: jest.fn() };

    const { service } = await loadServiceWithMocks({
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

    expect(result.items).not.toEqual(expect.arrayContaining([expect.objectContaining({ topicKey: 'technology' })]));
    expect(databaseMock.getArticlesForThematicSummary).not.toHaveBeenCalledWith(expect.objectContaining({ topics: ['Tecnologia'] }));
    expect(aiSummaryGeneratorMock.generateSummaryForArticles).not.toHaveBeenCalled();
    expect(websocketServiceMock.broadcastFeedRefresh).not.toHaveBeenCalled();
  });

  test('retries invalid output failures until the retry limit', async () => {
    const summaryWindow = createSummaryWindow();
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
      getArticlesForThematicSummary: jest.fn(({ topics }) => topics.includes('Tecnologia') ? [{ id: 'article-1' }] : []),
      getReaderCache: jest.fn(() => null),
      upsertThematicSummary: jest.fn(() => completedSummary),
      pruneSummaryHistory: jest.fn(() => ({ thematicSummaries: 0 }))
    };
    const aiSummaryGeneratorMock = createAiSummaryGeneratorMock({
      generateSummaryForArticles: jest.fn().mockResolvedValue({
        summaryText: 'English text [1]',
        summaryTextByLocale: { en: 'English text [1]', it: 'Testo italiano [1]' },
        model: 'test-model'
      })
    });

    const { service } = await loadServiceWithMocks({
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
    const summaryWindow = createSummaryWindow();
    const failedSummary = {
      topicKey: 'technology',
      status: 'failed',
      failureCategory: 'invalid_output',
      retryCount: 3,
      periodStart: summaryWindow.periodStart,
      periodEnd: summaryWindow.periodEnd,
      generatedAt: '2026-05-21T05:00:00.000Z',
      sources: [{ articleId: 'article-expired' }, { articleId: 'article-1' }]
    };
    const databaseMock = {
      getThematicSummary: jest.fn((topicKey) => (topicKey === 'technology'
        ? failedSummary
        : { topicKey, status: 'empty', periodStart: summaryWindow.periodStart, periodEnd: summaryWindow.periodEnd })),
      listLatestThematicSummaries: jest.fn(() => []),
      getArticlesForThematicSummary: jest.fn(({ topics }) => topics.includes('Tecnologia') ? [{ id: 'article-1' }] : []),
      getReaderCache: jest.fn(() => null),
      upsertThematicSummary: jest.fn()
    };
    const aiSummaryGeneratorMock = createAiSummaryGeneratorMock();

    const { service } = await loadServiceWithMocks({
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
    expect(aiSummaryGeneratorMock.generateSummaryForArticles).not.toHaveBeenCalled();
  });

  test('retries exhausted invalid output once after the selected article count grows', async () => {
    const summaryWindow = createSummaryWindow();
    let storedTechnologySummary = {
      topicKey: 'technology',
      status: 'failed',
      failureCategory: 'invalid_output',
      retryCount: 3,
      periodStart: summaryWindow.periodStart,
      periodEnd: summaryWindow.periodEnd,
      generatedAt: '2026-05-21T05:00:00.000Z',
      sources: [{ articleId: 'article-old' }]
    };
    const databaseMock = {
      getThematicSummary: jest.fn((topicKey) => topicKey === 'technology'
        ? storedTechnologySummary
        : { topicKey, status: 'empty', periodStart: summaryWindow.periodStart, periodEnd: summaryWindow.periodEnd }),
      getArticlesForThematicSummary: jest.fn(({ topics }) => topics.includes('Tecnologia') ? [
        { id: 'article-old', title: 'Old article' },
        { id: 'article-new', title: 'New article' }
      ] : []),
      getReaderCache: jest.fn(() => null),
      upsertThematicSummary: jest.fn((payload) => {
        storedTechnologySummary = payload;
        return payload;
      })
    };
    const validationError = Object.assign(new Error('AI summary English text has no citations'), {
      code: 'SUMMARY_VALIDATION_FAILED'
    });
    const aiSummaryGeneratorMock = createAiSummaryGeneratorMock({
      generateSummaryForArticles: jest.fn().mockRejectedValue(validationError)
    });

    const { service } = await loadServiceWithMocks({ databaseMock, env: OPENROUTER_TEST_ENV, aiSummaryGeneratorMock });
    await service.generateDueSummaries({ window: summaryWindow });
    await service.generateDueSummaries({ window: summaryWindow });

    expect(aiSummaryGeneratorMock.generateSummaryForArticles).toHaveBeenCalledTimes(1);
    expect(databaseMock.upsertThematicSummary).toHaveBeenCalledWith(expect.objectContaining({
      topicKey: 'technology',
      status: 'failed',
      retryCount: 4,
      sources: [
        expect.objectContaining({ articleId: 'article-old' }),
        expect.objectContaining({ articleId: 'article-new' })
      ]
    }));
  });

  test('stores invalid output failures with a non-retryable category', async () => {
    const summaryWindow = createSummaryWindow();
    const validationError = Object.assign(new Error('AI summary English text has no citations'), {
      code: 'SUMMARY_VALIDATION_FAILED'
    });
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
      getArticlesForThematicSummary: jest.fn(({ topics }) => topics.includes('Tecnologia') ? [article] : []),
      getReaderCache: jest.fn(() => null),
      upsertThematicSummary: jest.fn()
    };
    const aiSummaryGeneratorMock = createAiSummaryGeneratorMock({
      generateSummaryForArticles: jest.fn().mockRejectedValue(validationError)
    });

    const { service } = await loadServiceWithMocks({ databaseMock, env: OPENROUTER_TEST_ENV, aiSummaryGeneratorMock });
    await service.generateDueSummaries({ window: summaryWindow });

    expect(databaseMock.upsertThematicSummary).toHaveBeenCalledWith(expect.objectContaining({
      topicKey: 'technology',
      status: 'failed',
      failureCategory: 'invalid_output',
      retryCount: 3,
      errorMessage: 'AI summary English text has no citations'
    }));
  });

});
