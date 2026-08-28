jest.mock('./rssParser', () => ({
  parseFeed: jest.fn(),
  _buildArticleId: jest.fn((source, item, canonicalUrl = '') => `${source.id}:${canonicalUrl || item.link || item.title}`)
}));

jest.mock('./database', () => ({
  createIngestionRun: jest.fn(() => ({ id: 1 })),
  completeIngestionRun: jest.fn(),
  countArticles: jest.fn(() => 1),
  deleteArticlesOlderThan: jest.fn(() => 0),
  normalizeFuturePublicationDates: jest.fn(() => 0),
  cleanupRemovedConfiguredSourceData: jest.fn(() => ({ removedArticles: 0, updatedSettings: 0 })),
  upsertArticles: jest.fn(() => ({ insertedIds: [], insertedCount: 0, updatedCount: 0 })),
  getArticleIdsPendingAiTopicProcessing: jest.fn(() => []),
  getArticleIdsPendingAiStoryGrouping: jest.fn(() => []),
  getArticleIdsForAiStoryGroupingRetry: jest.fn(() => []),
  markArticlesAiTopicProcessing: jest.fn(() => 0),
  markArticlesAiStoryGrouping: jest.fn(() => 0),
  assignArticlesToStoryGroup: jest.fn(() => 0),
  getArticleIdsForStoryGroups: jest.fn(() => []),
  getAiStoryGroupingCandidateSet: jest.fn(() => ({ target: null, candidates: [] })),
  mergeTopicsForArticles: jest.fn(() => 0),
  replaceTopicsForArticles: jest.fn(() => 0),
  getReadLaterArticleIdSet: jest.fn(() => new Set()),
  getReadLaterArticles: jest.fn(() => []),
  saveReadLaterArticles: jest.fn(() => ({ savedArticleIds: [], savedCount: 0 })),
  removeReadLaterArticles: jest.fn(() => ({ removedArticleIds: [], removedCount: 0, deletedExpiredArticleCount: 0 })),
  getArticles: jest.fn(() => []),
  getArticleById: jest.fn((articleId) => ({ id: articleId })),
  getLatestIngestionRun: jest.fn(() => null),
  getSourceStats: jest.fn(() => []),
  getTopicStatsByFilters: jest.fn(() => []),
  getUserSettings: jest.fn(() => ({ excludedSourceIds: [], excludedSubSourceIds: [] })),
  listUsers: jest.fn(() => []),
  listUserSources: jest.fn(() => []),
  listAllActiveUserSources: jest.fn(() => []),
  findUserSourceById: jest.fn(() => null)
}));

const createMockLogger = require('../test-utils/mockLogger');

jest.mock('../utils/logger', createMockLogger);

jest.mock('./websocketService', () => ({
  broadcastNewsUpdate: jest.fn(),
  broadcastFeedRefresh: jest.fn()
}));

jest.mock('./aiTopicClassifier', () => ({
  classifyTopicDetailsForArticlesWithStatus: jest.fn(async () => ({
    topicsByArticleId: new Map(),
    attemptedArticleIds: [],
    failedArticleIds: [],
    cappedArticleIds: []
  })),
  isAiTopicDetectionAvailable: jest.fn(() => true)
}));

jest.mock('./aiStoryGrouper', () => ({
  buildStoryGroupId: jest.fn((articleIds = []) => `ai-story-${articleIds.filter(Boolean).sort().join('-')}`),
  getCandidateSignature: jest.fn((_target = {}, candidates = []) => candidates.map((candidate: { id: string }) => candidate.id).filter(Boolean).sort()),
  findSimilarStoriesForArticle: jest.fn(async () => ({ matches: [], model: 'test-story-model' })),
  isAiStoryGroupingAvailable: jest.fn(() => false)
}));

jest.mock('./thematicSummaryService', () => ({
  generateDueSummaries: jest.fn(() => Promise.resolve({ items: [] })),
  startScheduler: jest.fn(),
  stopScheduler: jest.fn()
}));

process.env.AI_SUMMARY_POST_TOPIC_DEBOUNCE_MS = '0';

const rssParser = require('./rssParser');
const database = require('./database');
const websocketService = require('./websocketService');
const aiTopicClassifier = require('./aiTopicClassifier');
const aiStoryGrouper = require('./aiStoryGrouper');
const thematicSummaryService = require('./thematicSummaryService');
const newsAggregator = require('./newsAggregator');
const { normalizeIncomingArticles } = require('./newsAggregatorGrouping');
const {
  ingestSourceConfigs,
  scheduleAiTopicsForPendingArticles,
  scheduleAiStoryGroupingForPendingArticles,
  _filterArticlesWithinRetention,
  _resetRuntimeStateForTests,
  _pruneSourceFetchTimestamps,
  _sourceFetchTimestamps
} = require('./newsAggregatorIngestion');
const { mapSettledWithConcurrency } = require('../utils/concurrency');
const { getCanonicalSourceId, getCanonicalSourceName } = require('../utils/sourceCatalog');

const ansaSourceId = getCanonicalSourceId('ansa_mondo', 'ANSA - Mondo');
const ansaSourceName = getCanonicalSourceName('ansa_mondo', 'ANSA - Mondo');

async function flushBackgroundAiProcessing() {
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  await Promise.resolve();
}

interface Deferred<T = unknown> {
  promise: Promise<T>;
  resolve: (value?: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T = unknown>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve'];
  let reject!: Deferred<T>['reject'];
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = (value) => promiseResolve(value as T | PromiseLike<T>);
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

function recentIso({ hoursAgo = 0, minutesAgo = 0 } = {}) {
  return new Date(Date.now() - ((hoursAgo * 60 * 60 * 1000) + (minutesAgo * 60 * 1000))).toISOString();
}

describe('newsAggregator service flows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    newsAggregator._resetImmediateRefreshState();
    _resetRuntimeStateForTests();
    database.countArticles.mockReturnValue(1);
    database.deleteArticlesOlderThan.mockReturnValue(0);
    database.normalizeFuturePublicationDates.mockReturnValue(0);
    database.cleanupRemovedConfiguredSourceData.mockReturnValue({ removedArticles: 0, updatedSettings: 0 });
    database.getArticleIdsPendingAiTopicProcessing.mockReturnValue([]);
    database.getArticleIdsPendingAiStoryGrouping.mockReturnValue([]);
    database.getArticleIdsForAiStoryGroupingRetry.mockReturnValue([]);
    database.getArticles.mockReturnValue([]);
    database.getArticleById.mockImplementation((articleId: string) => ({ id: articleId }));
    database.getLatestIngestionRun.mockReturnValue(null);
    database.getSourceStats.mockReturnValue([]);
    database.getTopicStatsByFilters.mockReturnValue([]);
    database.getUserSettings.mockReturnValue({ excludedSourceIds: [], excludedSubSourceIds: [] });
    database.listUsers.mockReturnValue([{ id: 'user-1', lastActivityAt: new Date().toISOString() }]);
    database.listUserSources.mockReturnValue([]);
    database.listAllActiveUserSources.mockReturnValue([]);
    database.findUserSourceById.mockImplementation((userId: string, sourceId: string) => {
      return [
        ...database.listUserSources(userId),
        ...database.listAllActiveUserSources()
      ].find((source) => source.userId === userId && source.id === sourceId) || null;
    });
    database.upsertArticles.mockReturnValue({ insertedIds: [], insertedCount: 0, updatedCount: 0 });
    aiTopicClassifier.isAiTopicDetectionAvailable.mockReturnValue(true);
    aiStoryGrouper.findSimilarStoriesForArticle.mockResolvedValue({ matches: [], model: 'test-story-model' });
    aiStoryGrouper.isAiStoryGroupingAvailable.mockReturnValue(false);
    thematicSummaryService.generateDueSummaries.mockResolvedValue({ items: [] });
    aiTopicClassifier.classifyTopicDetailsForArticlesWithStatus.mockResolvedValue({
      topicsByArticleId: new Map(),
      attemptedArticleIds: [],
      failedArticleIds: [],
      cappedArticleIds: []
    });
    rssParser._buildArticleId.mockImplementation((source: { id: string }, item: { link?: string; title?: string }, canonicalUrl = '') => `${source.id}:${canonicalUrl || item.link || item.title}`);
    rssParser.parseFeed.mockResolvedValue([]);
  });

  test('getNewsFeed paginates grouped results and includes user source catalog', async () => {
    const groupedArticleA = {
      id: 'global-1',
        sourceId: ansaSourceId,
      source: 'ANSA',
      title: 'Economy outlook improves',
      description: 'Global economy article',
      pubDate: '2026-03-07T10:00:00.000Z',
      url: 'https://example.com/global-1',
      topics: ['Economy']
    };
    const groupedArticleB = {
      id: 'global-2',
      sourceId: 'bbc',
      source: 'BBC',
      title: 'Science mission launches',
      description: 'Space article',
      pubDate: '2026-03-07T09:00:00.000Z',
      url: 'https://example.com/global-2',
      topics: ['Science']
    };

    database.getArticles.mockReturnValueOnce([groupedArticleA, groupedArticleB]);
    database.getLatestIngestionRun.mockReturnValue({ id: 7, status: 'completed' });
    database.getSourceStats.mockReturnValue([{ id: ansaSourceId, name: ansaSourceName, count: 1 }]);
    database.getTopicStatsByFilters.mockReturnValue([{ topic: 'Economy', count: 1 }]);
    database.listUserSources.mockReturnValue([
      { id: 'custom-1', name: 'My Feed', language: 'en', url: 'https://example.com/custom.xml' }
    ]);

    const result = await newsAggregator.getNewsFeed({ page: 1, pageSize: 1 }, { userId: 'user-1' });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ title: 'Economy outlook improves' });
    expect(result.meta).toMatchObject({
      page: 1,
      pageSize: 1,
      hasMore: true,
      totalGroups: null,
      nextCursor: {
        beforePubDate: '2026-03-07T10:00:00.000Z',
        beforeId: 'global-1',
        excludeArticleIds: ['global-1']
      },
      scannedArticles: 2,
      ingestion: { id: 7, status: 'completed' }
    });
    expect(result.filters.sourceCatalog).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: ansaSourceId, name: ansaSourceName }),
      expect.objectContaining({ id: 'example.com', name: 'My Feed', language: 'en' })
    ]));
    expect(database.getArticles).toHaveBeenCalledWith(expect.objectContaining({ limit: 251, offset: 0 }), expect.objectContaining({ userId: 'user-1' }));
  });

  test('getNewsFeed returns immediately while empty-database seed ingestion runs in the background', async () => {
    const deferred = createDeferred();
    database.countArticles.mockReturnValue(0);
    database.getArticles.mockReturnValue([]);
    rssParser.parseFeed.mockReturnValue(deferred.promise);

    const result = await newsAggregator.getNewsFeed({ page: 1, pageSize: 12 }, { userId: 'user-1' });

    expect(result.items).toEqual([]);
    expect(rssParser.parseFeed).toHaveBeenCalled();

    const seedPromise = newsAggregator._startSeedDataRefresh();
    deferred.resolve([]);
    await seedPromise;
  });

  test('tracked ingestion skips run creation when no source tasks exist', async () => {
    const result = await ingestSourceConfigs([], {
      includeMaintenance: true,
      trackIngestionRun: true,
      updateRefreshTimestamp: true
    }, {
      getLastRefreshAt: () => null,
      setLastRefreshAt: jest.fn()
    });

    expect(result).toEqual(expect.objectContaining({ success: true, fetchedCount: 0, insertedCount: 0, updatedCount: 0 }));
    expect(database.createIngestionRun).not.toHaveBeenCalled();
    expect(database.completeIngestionRun).not.toHaveBeenCalled();
  });

  test('failed RSS sources are skipped during failure backoff', async () => {
    const source = { id: 'failing-source', name: 'Failing Source', url: 'https://example.com/failing.xml', language: 'en' };
    rssParser.parseFeed.mockRejectedValueOnce(new Error('upstream timeout'));

    await expect(ingestSourceConfigs([source], { broadcast: false }, {
      getLastRefreshAt: () => null,
      setLastRefreshAt: jest.fn()
    })).rejects.toMatchObject({ status: 503, code: 'CONNECTION_ERROR' });

    rssParser.parseFeed.mockClear();

    const result = await ingestSourceConfigs([source], { broadcast: false }, {
      getLastRefreshAt: () => null,
      setLastRefreshAt: jest.fn()
    });

    expect(result).toEqual(expect.objectContaining({ success: true, fetchedCount: 0 }));
    expect(rssParser.parseFeed).not.toHaveBeenCalled();
  });

  test('custom source refreshes bypass freshness but still honor failure backoff', async () => {
    const source = {
      id: 'custom-failing',
      name: 'Failing Custom Feed',
      url: 'https://example.com/custom-failing.xml',
      language: 'en',
      userId: 'user-1',
      isActive: true
    };
    database.listUserSources.mockReturnValue([source]);
    rssParser.parseFeed.mockRejectedValueOnce(new Error('upstream timeout'));

    await expect(newsAggregator.refreshUserSources('user-1')).rejects.toMatchObject({ status: 503, code: 'CONNECTION_ERROR' });

    rssParser.parseFeed.mockClear();

    const result = await newsAggregator.refreshUserSources('user-1');

    expect(result).toEqual(expect.objectContaining({ success: true, fetchedCount: 0 }));
    expect(rssParser.parseFeed).not.toHaveBeenCalled();
  });

  test('caches filter stats for identical feed requests', async () => {
    database.getArticles.mockReturnValue([]);
    database.getLatestIngestionRun.mockReturnValue({ id: 7, status: 'completed', completedAt: '2026-03-07T10:00:00.000Z' });
    database.getSourceStats.mockReturnValue([{ id: ansaSourceId, name: ansaSourceName, count: 1 }]);
    database.getTopicStatsByFilters.mockReturnValue([{ topic: 'Economy', count: 1 }]);

    const firstResult = await newsAggregator.getNewsFeed({ page: 1, pageSize: 12 }, { userId: 'user-1' });
    const secondResult = await newsAggregator.getNewsFeed({ page: 1, pageSize: 12 }, { userId: 'user-1' });

    expect(firstResult.filters).toEqual(secondResult.filters);
    expect(database.getSourceStats).toHaveBeenCalledTimes(1);
    expect(database.getTopicStatsByFilters).toHaveBeenCalledTimes(1);
  });

  test('getNewsFeed carries returned group article ids in cursor exclusions', async () => {
    const primaryStoryArticle = {
      id: 'story-new',
      sourceId: ansaSourceId,
      source: 'ANSA',
      title: 'Shared story headline',
      description: 'Newest article',
      pubDate: '2026-03-07T10:00:00.000Z',
      url: 'https://example.com/story-new',
      topics: ['Economy']
    };
    const separateArticle = {
      id: 'separate-story',
      sourceId: 'bbc',
      source: 'BBC',
      title: 'Separate story headline',
      description: 'Separate article',
      pubDate: '2026-03-07T09:00:00.000Z',
      url: 'https://example.com/separate-story',
      topics: ['Science']
    };
    const secondaryStoryArticle = {
      id: 'story-old',
      sourceId: 'reuters',
      source: 'Reuters',
      title: 'Shared story headline',
      description: 'Older grouped article',
      pubDate: '2026-03-07T08:00:00.000Z',
      url: 'https://example.com/story-old',
      topics: ['Economy']
    };

    database.getArticles.mockReset();
    database.getArticles.mockReturnValue([]);
    database.getArticles.mockReturnValueOnce([primaryStoryArticle, separateArticle, secondaryStoryArticle]);

    const firstPage = await newsAggregator.getNewsFeed({ page: 1, pageSize: 1 }, { userId: 'user-1' });

    expect(firstPage.meta.nextCursor).toEqual(expect.objectContaining({
      beforePubDate: '2026-03-07T10:00:00.000Z',
      beforeId: 'story-new',
      excludeArticleIds: ['story-new', 'story-old']
    }));

    database.getArticles.mockClear();
    database.getArticles.mockReturnValueOnce([]);

    await newsAggregator.getNewsFeed({
      page: 1,
      pageSize: 1,
      beforePubDate: firstPage.meta.nextCursor.beforePubDate,
      beforeId: firstPage.meta.nextCursor.beforeId,
      excludeArticleIds: firstPage.meta.nextCursor.excludeArticleIds
    }, { userId: 'user-1' });

    expect(database.getArticles).toHaveBeenCalledWith(expect.objectContaining({
      excludeArticleIds: ['story-new', 'story-old']
    }), expect.any(Object));
  });

  test('deduplicates concurrent fetches for the same custom RSS URL', async () => {
    const feedFetch = createDeferred();
    rssParser.parseFeed.mockImplementationOnce(async () => {
      await feedFetch.promise;
      return [{
        id: 'base-article',
        title: 'Shared custom story',
        description: 'Shared description',
        url: 'https://example.com/shared-story',
        pubDate: recentIso()
      }];
    });

    const sourceA = {
      id: 'custom-a',
      name: 'Custom A',
      url: 'https://feeds.example.com/shared.xml',
      language: 'en',
      ownerUserId: 'user-a'
    };
    const sourceB = {
      id: 'custom-b',
      name: 'Custom B',
      url: 'https://feeds.example.com/shared.xml',
      language: 'en',
      ownerUserId: 'user-b'
    };
    database.findUserSourceById.mockImplementation((userId: string, sourceId: string) => {
      const source = [sourceA, sourceB].find((candidate) => candidate.ownerUserId === userId && candidate.id === sourceId);
      return source ? { ...source, userId: source.ownerUserId, isActive: true } : null;
    });

    const firstRefresh = ingestSourceConfigs([sourceA], { bypassSourceFreshness: true });
    const secondRefresh = ingestSourceConfigs([sourceB], { bypassSourceFreshness: true });
    await Promise.resolve();

    expect(rssParser.parseFeed).toHaveBeenCalledTimes(1);

    feedFetch.resolve();
    await Promise.all([firstRefresh, secondRefresh]);

    expect(rssParser.parseFeed).toHaveBeenCalledTimes(1);
    expect(database.upsertArticles).toHaveBeenCalledTimes(2);
    expect(database.upsertArticles.mock.calls[0][0][0]).toEqual(expect.objectContaining({ sourceId: 'custom-a', ownerUserId: 'user-a' }));
    expect(database.upsertArticles.mock.calls[1][0][0]).toEqual(expect.objectContaining({ sourceId: 'custom-b', ownerUserId: 'user-b' }));
  });

  test('getNewsFeed applies page offsets after story grouping when no cursor is provided', async () => {
    database.getArticles.mockReturnValue([]);

    await newsAggregator.getNewsFeed({ page: 3, pageSize: 10 }, { userId: 'user-1' });

    expect(database.getArticles).toHaveBeenCalledWith(expect.objectContaining({
      limit: 251,
      offset: 0
    }), expect.objectContaining({ userId: 'user-1' }));
  });

  test('getNewsFeed caps very deep page numbers', async () => {
    database.getArticles.mockReturnValue([]);

    const result = await newsAggregator.getNewsFeed({ page: 999, pageSize: 10 }, { userId: 'user-1' });

    expect(result.meta.page).toBe(20);
  });

  test('getReadLaterFeed treats the maximum capped page as terminal', async () => {
    database.getReadLaterArticles.mockReturnValue(Array.from({ length: 31 }, (_, index) => ({
      id: `saved-${index + 1}`,
      sourceId: ansaSourceId,
      source: 'ANSA',
      title: `Saved story ${index + 1}`,
      description: 'Saved article',
      pubDate: recentIso({ minutesAgo: index }),
      readLaterSavedAt: recentIso({ minutesAgo: index }),
      url: `https://example.com/saved-${index + 1}`
    })));

    const result = await newsAggregator.getReadLaterFeed({ page: 999, pageSize: 30 }, { userId: 'user-1' });

    expect(result.meta).toEqual(expect.objectContaining({
      page: 20,
      hasMore: false,
      readLater: true
    }));
  });

  test('getReadLaterFeed scans multiple article batches before reporting more pages', async () => {
    const firstBatch = Array.from({ length: 250 }, (_, index) => ({
      id: `saved-${index + 1}`,
      sourceId: ansaSourceId,
      source: 'ANSA',
      title: `Saved story ${index + 1}`,
      description: 'Saved article',
      pubDate: recentIso({ hoursAgo: index * 100 }),
      readLaterSavedAt: recentIso({ hoursAgo: index * 100 }),
      url: `https://example.com/saved-${index + 1}`
    }));
    const sentinelArticle = {
      id: 'saved-251',
      sourceId: ansaSourceId,
      source: 'ANSA',
      title: 'Saved story 251',
      description: 'Saved article',
      pubDate: recentIso({ hoursAgo: 25100 }),
      readLaterSavedAt: recentIso({ hoursAgo: 25100 }),
      url: 'https://example.com/saved-251'
    };
    const secondBatch = Array.from({ length: 20 }, (_, index) => ({
      id: `saved-next-${index + 1}`,
      sourceId: ansaSourceId,
      source: 'ANSA',
      title: `Saved next story ${index + 1}`,
      description: 'Saved article',
      pubDate: recentIso({ hoursAgo: 30000 + index * 100 }),
      readLaterSavedAt: recentIso({ hoursAgo: 30000 + index * 100 }),
      url: `https://example.com/saved-next-${index + 1}`
    }));

    database.getReadLaterArticles
      .mockReturnValueOnce([...firstBatch, sentinelArticle])
      .mockReturnValueOnce(secondBatch);

    const result = await newsAggregator.getReadLaterFeed({ page: 9, pageSize: 30 }, { userId: 'user-1' });

    expect(result.items).toHaveLength(30);
    expect(result.meta).toMatchObject({
      page: 9,
      pageSize: 30,
      hasMore: false,
      totalGroups: 270,
      scannedArticles: 270,
      readLater: true
    });
    expect(database.getReadLaterArticles).toHaveBeenNthCalledWith(1, 'user-1', expect.objectContaining({ limit: 251, offset: 0 }), expect.objectContaining({ userId: 'user-1' }));
    expect(database.getReadLaterArticles).toHaveBeenNthCalledWith(2, 'user-1', expect.objectContaining({ limit: 251, offset: 250 }), expect.objectContaining({ userId: 'user-1' }));
  });

  test('getNewsFeed passes article cursors to the database query', async () => {
    database.getArticles.mockReturnValue([]);

    await newsAggregator.getNewsFeed({
      page: 3,
      pageSize: 10,
      beforePubDate: '2026-03-07T10:00:00.000Z',
      beforeId: 'article-1'
    }, { userId: 'user-1' });

    expect(database.getArticles).toHaveBeenCalledWith(expect.objectContaining({
      beforePubDate: '2026-03-07T10:00:00.000Z',
      beforeId: 'article-1',
      limit: 251,
      offset: 0
    }), expect.objectContaining({ userId: 'user-1' }));
  });

  test('getNewsFeed stops scanning once it has enough complete grouped stories', async () => {
    const articles = Array.from({ length: 251 }, (_, index) => ({
      id: `article-${index + 1}`,
      sourceId: 'source-a',
      source: 'Source A',
      title: `Unique headline ${index + 1}`,
      description: `Story ${index + 1}`,
      pubDate: new Date(Date.parse('2026-03-07T10:00:00.000Z') - (index * 60 * 60 * 1000)).toISOString(),
      url: `https://example.com/story-${index + 1}`,
      topics: ['Economia']
    }));

    database.getArticles.mockReturnValueOnce(articles);

    const result = await newsAggregator.getNewsFeed({ page: 1, pageSize: 12 }, { userId: 'user-1' });

    expect(database.getArticles).toHaveBeenCalledTimes(1);
    expect(result.items).toHaveLength(12);
    expect(result.meta).toEqual(expect.objectContaining({
      hasMore: true,
      scannedArticles: 250
    }));
  });

  test('getNewsFeed paginates complete story groups instead of raw articles', async () => {
    database.getArticles.mockReturnValue([
      {
        id: 'article-1',
        sourceId: 'source-a',
        source: 'Source A',
        title: 'Shared headline',
        description: 'First version',
        pubDate: '2026-03-07T10:00:00.000Z',
        url: 'https://a.example.com/shared-headline',
        topics: ['Economia']
      },
      {
        id: 'article-2',
        sourceId: 'source-b',
        source: 'Source B',
        title: 'Shared headline',
        description: 'Second version',
        pubDate: '2026-03-07T09:30:00.000Z',
        url: 'https://b.example.com/shared-headline',
        topics: ['Economia']
      },
      {
        id: 'article-3',
        sourceId: 'source-c',
        source: 'Source C',
        title: 'Another headline',
        description: 'Different story',
        pubDate: '2026-03-07T09:00:00.000Z',
        url: 'https://c.example.com/another-headline',
        topics: ['Tecnologia']
      }
    ]);

    const result = await newsAggregator.getNewsFeed({ pageSize: 2 }, { userId: 'user-1' });

    expect(result.items).toHaveLength(2);
    expect(result.items[0].items.map((item: { id: string }) => item.id)).toEqual(['article-1', 'article-2']);
    expect(result.items[1].items.map((item: { id: string }) => item.id)).toEqual(['article-3']);
    expect(result.meta).toMatchObject({ hasMore: false, returnedGroups: 2, scannedArticles: 3 });
  });

  test('active assigned source selection skips inactive users and excluded default sources', () => {
    const now = Date.now();
    database.listUsers.mockReturnValue([
      { id: 'active-user', lastActivityAt: new Date(now).toISOString() },
      { id: 'inactive-user', lastActivityAt: new Date(now - (20 * 60 * 1000)).toISOString() }
    ]);
    database.getUserSettings.mockImplementation((userId: string) => ({
      excludedSourceIds: userId === 'active-user' ? [ansaSourceId] : [],
      excludedSubSourceIds: []
    }));
    database.listAllActiveUserSources.mockReturnValue([
      { id: 'active-custom', userId: 'active-user', name: 'Active Feed', url: 'https://example.com/active.xml', language: 'en', isActive: true },
      { id: 'inactive-custom', userId: 'inactive-user', name: 'Inactive Feed', url: 'https://example.com/inactive.xml', language: 'en', isActive: true }
    ]);

    const sourceConfigs = newsAggregator._getActiveAssignedSourceConfigs(now);

    expect(sourceConfigs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'active-custom', ownerUserId: 'active-user' })
    ]));
    expect(sourceConfigs).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'inactive-custom' }),
      expect.objectContaining({ id: 'ansa_mondo' })
    ]));
  });

  test('getNewsFeed reads cached articles without starting an assigned-source refresh', async () => {
    const userContext = { userId: 'user-1', excludedSourceIds: [ansaSourceId], excludedSubSourceIds: [] };
    const customSource = { id: 'custom-1', name: 'User Feed', url: 'https://example.com/user.xml', language: 'en', userId: 'user-1', isActive: true };
    database.listUserSources.mockReturnValue([customSource]);

    await newsAggregator.getNewsFeed({}, userContext);

    expect(rssParser.parseFeed).not.toHaveBeenCalled();
  });

  test('getNewsFeed reads cached articles without running maintenance writes', async () => {
    await newsAggregator.getNewsFeed({}, { userId: 'user-1' });

    expect(database.normalizeFuturePublicationDates).not.toHaveBeenCalled();
    expect(database.deleteArticlesOlderThan).not.toHaveBeenCalled();
  });

  test('getNewsFeed queues assigned-source refresh without blocking cached reads', async () => {
    const allDefaultSourceGroupIds = [...new Set(newsAggregator.newsSources.map((source: { id: string; name: string }) => getCanonicalSourceId(source.id, source.name)))];
    const userContext = { userId: 'user-1', excludedSourceIds: allDefaultSourceGroupIds, excludedSubSourceIds: [] };
    const customSource = { id: 'custom-1', name: 'User Feed', url: 'https://example.com/user.xml', language: 'en', userId: 'user-1', isActive: true };
    const parseRelease = createDeferred();

    database.listUserSources.mockReturnValue([customSource]);
    rssParser.parseFeed.mockImplementation(async (source: { id: string }) => {
      if (source.id !== 'custom-1') {
        return [];
      }

      await parseRelease.promise;
      return [];
    });

    const result = await newsAggregator.getNewsFeed({ refresh: true }, userContext);

    expect(database.getArticles).toHaveBeenCalled();
    expect(result.meta.pendingUserRefresh).toBe(true);

    parseRelease.resolve();
    await Promise.resolve();
  });

  test('getNewsFeed does not wait for an existing manual assigned-source refresh before reading feed', async () => {
    const allDefaultSourceGroupIds = [...new Set(newsAggregator.newsSources.map((source: { id: string; name: string }) => getCanonicalSourceId(source.id, source.name)))];
    const userContext = { userId: 'user-1', excludedSourceIds: allDefaultSourceGroupIds, excludedSubSourceIds: [] };
    const customSource = { id: 'custom-1', name: 'User Feed', url: 'https://example.com/user.xml', language: 'en', userId: 'user-1', isActive: true };
    const parseRelease = createDeferred();
    let resolveParseStarted!: () => void;
    const parseStarted = new Promise<void>((resolve) => { resolveParseStarted = resolve; });

    database.listUserSources.mockReturnValue([customSource]);
    rssParser.parseFeed.mockImplementation(async (source: { id: string }) => {
      if (source.id !== 'custom-1') {
        return [];
      }

      resolveParseStarted();
      await parseRelease.promise;
      return [];
    });

    const refreshRequest = newsAggregator.getNewsFeed({ refresh: true }, userContext);
    await parseStarted;

    expect(newsAggregator._hasPendingUserAssignedSourceRefresh(userContext)).toBe(true);
    await refreshRequest;
    expect(database.getArticles).toHaveBeenCalledTimes(1);

    const secondFeed = await newsAggregator.getNewsFeed({}, userContext);

    expect(secondFeed.meta.pendingUserRefresh).toBe(true);
    expect(database.getArticles).toHaveBeenCalledTimes(2);

    parseRelease.resolve();
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    expect(newsAggregator._hasPendingUserAssignedSourceRefresh(userContext)).toBe(false);
  });

  test('user source refreshes are not blocked by another user refresh in progress', async () => {
    const slowSource = { id: 'slow-source', name: 'Slow Feed', url: 'https://example.com/slow.xml', language: 'en', userId: 'user-1', isActive: true };
    const fastSource = { id: 'fast-source', name: 'Fast Feed', url: 'https://example.com/fast.xml', language: 'en', userId: 'user-2', isActive: true };
    const slowRelease = createDeferred();
    let resolveSlowStarted!: () => void;
    const slowStarted = new Promise<void>((resolve) => { resolveSlowStarted = resolve; });

    database.listUserSources.mockImplementation((userId: string) => {
      if (userId === 'user-1') return [slowSource];
      if (userId === 'user-2') return [fastSource];
      return [];
    });
    rssParser.parseFeed.mockImplementation(async (source: { id: string }) => {
      if (source.id === 'slow-source') {
        resolveSlowStarted();
        await slowRelease.promise;
        return [];
      }

      return [];
    });

    const slowRefresh = newsAggregator._startUserAssignedSourceRefresh({ userId: 'user-1', excludedSourceIds: [], excludedSubSourceIds: [] }, { force: true });
    await slowStarted;

    await expect(newsAggregator.refreshUserSources('user-2')).resolves.toMatchObject({ success: true });
    expect(rssParser.parseFeed).toHaveBeenCalledWith(expect.objectContaining({ id: 'fast-source' }), expect.any(Object));

    slowRelease.resolve();
    await slowRefresh;
  });

  test('manual refresh enforces a per-user cooldown after a refresh starts', async () => {
    const allDefaultSourceGroupIds = [...new Set(newsAggregator.newsSources.map((source: { id: string; name: string }) => getCanonicalSourceId(source.id, source.name)))];
    const userContext = { userId: 'user-1', excludedSourceIds: allDefaultSourceGroupIds, excludedSubSourceIds: [] };
    const customSource = { id: 'custom-1', name: 'User Feed', url: 'https://example.com/user.xml', language: 'en', userId: 'user-1', isActive: true };

    database.listUserSources.mockReturnValue([customSource]);
    rssParser.parseFeed.mockResolvedValue([]);

    await newsAggregator._startUserAssignedSourceRefresh(userContext, { force: true, manual: true });

    const secondResult = await newsAggregator.getNewsFeed({ refresh: true }, userContext);

    expect(rssParser.parseFeed).toHaveBeenCalledTimes(1);
    expect(secondResult.meta).toEqual(expect.objectContaining({
      manualRefreshAllowed: false,
      manualRefreshCooldownSeconds: expect.any(Number),
      manualRefreshAllowedAt: expect.any(String)
    }));
    expect(secondResult.meta.manualRefreshCooldownSeconds).toBeGreaterThan(0);
  });

  test('getNewsFeed groups matching articles into one story group', async () => {
    database.getArticles.mockReturnValue([
      {
        id: 'article-1',
        sourceId: 'source-a',
        source: 'Source A',
        title: 'Shared market story',
        description: 'First version',
        pubDate: '2026-03-07T10:00:00.000Z',
        url: 'https://a.example.com/shared-market-story',
        topics: ['Economia']
      },
      {
        id: 'article-2',
        sourceId: 'source-b',
        source: 'Source B',
        title: 'Shared market story',
        description: 'Second version',
        pubDate: '2026-03-07T09:30:00.000Z',
        url: 'https://b.example.com/shared-market-story',
        topics: ['Economia']
      }
    ]);

    const result = await newsAggregator.getNewsFeed({ pageSize: 2 }, { userId: 'user-1' });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ title: 'Shared market story' });
    expect(result.items[0].items.map((item: { id: string }) => item.id)).toEqual(['article-1', 'article-2']);
    expect(result.meta.returnedGroups).toBe(1);
  });

  test('ingestAllNews stores topics and broadcasts global and private groups separately', async () => {
    const privateArticleId = 'custom-1:https://example.com/p';
    database.listAllActiveUserSources.mockReturnValue([
      { id: 'custom-1', name: 'My Feed', url: 'https://example.com/custom.xml', language: 'en', userId: 'user-1', isActive: true }
    ]);
    let globalReturned = false;
    rssParser.parseFeed.mockImplementation(async (source: { id: string }) => {
      if (source.id === 'custom-1') {
        return [{ id: 'private-1', sourceId: 'custom-1', source: 'My Feed', title: 'Private portfolio update', pubDate: recentIso({ hoursAgo: 1, minutesAgo: 30 }), url: 'https://example.com/p', rawTopics: ['Markets'] }];
      }
      if (!globalReturned) {
        globalReturned = true;
        return [{ id: 'global-1', sourceId: 'ansa_mondo', source: 'ANSA - Mondo', title: 'Global economy update', pubDate: recentIso({ hoursAgo: 2 }), url: 'https://example.com/g', rawTopics: ['Economy'] }];
      }
      return [];
    });
    database.upsertArticles.mockReturnValue({ insertedIds: ['global-1', privateArticleId], insertedCount: 2, updatedCount: 0 });
    database.getArticleIdsPendingAiTopicProcessing.mockReturnValue(['global-1', privateArticleId]);

    const result = await newsAggregator.ingestAllNews({ broadcast: true });

    expect(result).toMatchObject({ success: true, fetchedCount: 2, insertedCount: 2, updatedCount: 0 });
    expect(database.cleanupRemovedConfiguredSourceData).toHaveBeenCalledTimes(1);
    expect(database.upsertArticles).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ rawSourceId: 'ansa_mondo', rawSource: 'ANSA - Mondo', sourceId: ansaSourceId, source: ansaSourceName, subSource: 'Mondo' })
    ]));
    expect(database.mergeTopicsForArticles).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ articleId: 'global-1', topics: expect.any(Array) }),
      expect.objectContaining({ articleId: privateArticleId, topics: expect.any(Array) })
    ]));
    expect(websocketService.broadcastNewsUpdate).toHaveBeenCalledTimes(2);
    expect(websocketService.broadcastNewsUpdate.mock.calls[0][0][0]).toMatchObject({ id: expect.stringContaining('group-'), ownerUserId: null });
    expect(websocketService.broadcastNewsUpdate.mock.calls[0][0][0].items[0]).toMatchObject({ sourceId: ansaSourceId, subSource: 'Mondo' });
    expect(websocketService.broadcastNewsUpdate.mock.calls[1][0][0]).toMatchObject({ ownerUserId: 'user-1' });
  });

  test('ingestAllNews schedules AI topics after merging and broadcasting fallback topics', async () => {
    rssParser.parseFeed.mockResolvedValue([
      { id: 'inserted-1', sourceId: 'ansa_mondo', source: 'ANSA - Mondo', title: 'AI chips advance', description: 'New processors for data centers', pubDate: recentIso({ hoursAgo: 2 }), url: 'https://example.com/ai' },
      { id: 'updated-1', sourceId: 'ansa_mondo', source: 'ANSA - Mondo', title: 'Market update', description: 'Markets rise', pubDate: recentIso({ hoursAgo: 3 }), url: 'https://example.com/markets' }
    ]);
    database.upsertArticles.mockReturnValue({ insertedIds: ['inserted-1'], updatedIds: ['updated-1'], insertedCount: 1, updatedCount: 1 });
    database.getArticleIdsPendingAiTopicProcessing.mockReturnValue(['inserted-1']);
    aiTopicClassifier.classifyTopicDetailsForArticlesWithStatus.mockResolvedValue({
      topicsByArticleId: new Map([
        ['inserted-1', [{ topic: 'Tecnologia', source: 'ai', confidence: 0.88, evidence: ['AI chips'], reasonCode: 'ai_confident_evidence' }]]
      ]),
      attemptedArticleIds: ['inserted-1'],
      failedArticleIds: [],
      cappedArticleIds: []
    });

    await newsAggregator.ingestAllNews({ broadcast: true });

    expect(database.mergeTopicsForArticles).toHaveBeenCalledWith([
      expect.objectContaining({ articleId: 'inserted-1', topics: expect.any(Array) })
    ]);
    expect(websocketService.broadcastNewsUpdate.mock.calls[0][0][0].topics).toEqual(['Tecnologia']);
    await flushBackgroundAiProcessing();

    expect(aiTopicClassifier.classifyTopicDetailsForArticlesWithStatus).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'inserted-1', title: 'AI chips advance' })
    ]);
    expect(database.replaceTopicsForArticles).toHaveBeenCalledWith([
      { articleId: 'inserted-1', topics: [{ topic: 'Tecnologia', source: 'ai', confidence: 0.88, evidence: ['AI chips'], reasonCode: 'ai_confident_evidence' }] }
    ]);
    expect(websocketService.broadcastFeedRefresh).toHaveBeenCalledWith({ userIds: [], reason: 'topics' });
    expect(database.markArticlesAiTopicProcessing).toHaveBeenCalledWith(['inserted-1'], 'completed');
  });

  test('does not schedule the same pending AI article twice while processing is already in flight', async () => {
    let resolveClassification!: (value: unknown) => void;

    database.getArticleIdsPendingAiTopicProcessing.mockReturnValue(['inserted-1']);
    aiTopicClassifier.classifyTopicDetailsForArticlesWithStatus.mockImplementation(() => {
      return new Promise((resolve) => {
        resolveClassification = resolve;
      });
    });

    const pendingArticles = [
      {
        id: 'inserted-1',
        sourceId: 'ansa_mondo',
        source: 'ANSA - Mondo',
        title: 'AI chips advance',
        description: 'New processors for data centers',
        pubDate: recentIso({ hoursAgo: 2 }),
        url: 'https://example.com/ai'
      }
    ];

    scheduleAiTopicsForPendingArticles(pendingArticles);
    scheduleAiTopicsForPendingArticles(pendingArticles);

    await flushBackgroundAiProcessing();

    expect(aiTopicClassifier.classifyTopicDetailsForArticlesWithStatus).toHaveBeenCalledTimes(1);

    resolveClassification({
      topicsByArticleId: new Map([
        ['inserted-1', [{ topic: 'Tecnologia', source: 'ai', confidence: 0.88, evidence: ['AI chips'], reasonCode: 'ai_confident_evidence' }]]
      ]),
      attemptedArticleIds: ['inserted-1'],
      failedArticleIds: [],
      cappedArticleIds: []
    });

    await Promise.resolve();
    await Promise.resolve();
  });

  test('filters out articles older than retention before persistence and live broadcast', async () => {
    const now = Date.now();
    rssParser.parseFeed.mockResolvedValue([
      {
        id: 'fresh-1',
        sourceId: 'ansa_mondo',
        source: 'ANSA - Mondo',
        title: 'Fresh story',
        description: 'Fresh description',
        pubDate: new Date(now - (2 * 60 * 60 * 1000)).toISOString(),
        url: 'https://example.com/fresh-story'
      },
      {
        id: 'stale-1',
        sourceId: 'ansa_mondo',
        source: 'ANSA - Mondo',
        title: 'Stale story',
        description: 'Stale description',
        pubDate: new Date(now - (30 * 60 * 60 * 1000)).toISOString(),
        url: 'https://example.com/stale-story'
      }
    ]);
    database.upsertArticles.mockReturnValue({ insertedIds: ['fresh-1'], insertedCount: 1, updatedCount: 0 });
    database.getArticleIdsPendingAiTopicProcessing.mockReturnValue(['fresh-1']);

    await newsAggregator.ingestAllNews({ broadcast: true });

    expect(database.upsertArticles).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'fresh-1', title: 'Fresh story' })
    ]);
    expect(database.upsertArticles).not.toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: 'stale-1' })
    ]));
    expect(websocketService.broadcastNewsUpdate.mock.calls[0][0][0]).toMatchObject({ title: 'Fresh story' });
  });

  test('retention filter keeps only recent articles while leaving future-dated normalization alone', () => {
    const now = Date.now();
    const filtered = _filterArticlesWithinRetention([
      { id: 'recent-1', pubDate: new Date(now - (60 * 60 * 1000)).toISOString() },
      { id: 'stale-1', pubDate: new Date(now - (30 * 60 * 60 * 1000)).toISOString() },
      { id: 'future-1', pubDate: new Date(now + (60 * 60 * 1000)).toISOString() }
    ]);

    expect(filtered.map((article: { id: string }) => article.id)).toEqual(['recent-1', 'future-1']);
  });

  test('ingestAllNews keeps fallback topics when AI is unsure', async () => {
    rssParser.parseFeed.mockResolvedValue([
      { id: 'inserted-1', sourceId: 'ansa_mondo', source: 'ANSA - Mondo', title: 'Global market update', description: 'Markets rise', pubDate: recentIso({ hoursAgo: 2 }), url: 'https://example.com/markets', rawTopics: ['markets'] }
    ]);
    database.upsertArticles.mockReturnValue({ insertedIds: ['inserted-1'], insertedCount: 1, updatedCount: 0 });
    database.getArticleIdsPendingAiTopicProcessing.mockReturnValue(['inserted-1']);
    aiTopicClassifier.classifyTopicDetailsForArticlesWithStatus.mockResolvedValue({
      topicsByArticleId: new Map([
        ['inserted-1', []]
      ]),
      attemptedArticleIds: ['inserted-1'],
      failedArticleIds: [],
      cappedArticleIds: []
    });

    await newsAggregator.ingestAllNews({ broadcast: true });

    expect(database.mergeTopicsForArticles).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        articleId: 'inserted-1',
        topics: expect.arrayContaining([expect.objectContaining({ topic: 'Economia' })])
      })
    ]));
    expect(websocketService.broadcastNewsUpdate.mock.calls[0][0][0].topics).toEqual(['Economia']);

    await flushBackgroundAiProcessing();

    expect(database.replaceTopicsForArticles).not.toHaveBeenCalled();
    expect(database.markArticlesAiTopicProcessing).toHaveBeenCalledWith(['inserted-1'], 'no_topics');
  });

  test('AI story grouping waits until pending topic processing finishes', async () => {
    rssParser.parseFeed.mockResolvedValue([
      { id: 'inserted-1', sourceId: 'ansa_mondo', source: 'ANSA - Mondo', title: 'AI chip rollout', description: 'New processors launch', pubDate: recentIso({ hoursAgo: 1 }), url: 'https://example.com/ai-chip' }
    ]);
    database.upsertArticles.mockReturnValue({ insertedIds: ['inserted-1'], insertedCount: 1, updatedCount: 0 });
    database.getArticleIdsPendingAiTopicProcessing.mockReturnValue(['inserted-1']);
    database.getArticleIdsPendingAiStoryGrouping.mockReturnValue(['inserted-1']);
    database.getAiStoryGroupingCandidateSet.mockReturnValue({ target: { id: 'inserted-1' }, candidates: [] });
    aiStoryGrouper.isAiStoryGroupingAvailable.mockReturnValue(true);
    aiTopicClassifier.classifyTopicDetailsForArticlesWithStatus.mockResolvedValue({
      topicsByArticleId: new Map([
        ['inserted-1', [{ topic: 'Tecnologia', source: 'ai', confidence: 0.9, evidence: ['AI chip'], reasonCode: 'ai_confident_evidence' }]]
      ]),
      attemptedArticleIds: ['inserted-1'],
      failedArticleIds: [],
      cappedArticleIds: []
    });

    await newsAggregator.ingestAllNews({ broadcast: false });

    expect(database.getAiStoryGroupingCandidateSet).not.toHaveBeenCalled();

    await flushBackgroundAiProcessing();
    await flushBackgroundAiProcessing();

    expect(database.replaceTopicsForArticles).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ articleId: 'inserted-1' })
    ]));
    expect(thematicSummaryService.generateDueSummaries).toHaveBeenCalledWith({ broadcast: true });
    expect(database.getAiStoryGroupingCandidateSet).toHaveBeenCalledWith('inserted-1', expect.any(Object));
  });

  test('private-only topic processing does not schedule global summaries', async () => {
    database.getArticleIdsPendingAiTopicProcessing.mockReturnValue(['private-1']);
    aiTopicClassifier.classifyTopicDetailsForArticlesWithStatus.mockResolvedValue({
      topicsByArticleId: new Map([
        ['private-1', [{ topic: 'Tecnologia', source: 'ai', confidence: 0.9 }]]
      ]),
      attemptedArticleIds: ['private-1'],
      failedArticleIds: [],
      cappedArticleIds: []
    });

    scheduleAiTopicsForPendingArticles([
      { id: 'private-1', ownerUserId: 'user-1', title: 'Private AI story' }
    ]);
    await flushBackgroundAiProcessing();
    await flushBackgroundAiProcessing();

    expect(database.replaceTopicsForArticles).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ articleId: 'private-1' })
    ]));
    expect(thematicSummaryService.generateDueSummaries).not.toHaveBeenCalled();
  });

  test('marks AI-capped articles as deferred so they do not remain pending forever', async () => {
    database.getArticleIdsPendingAiTopicProcessing.mockReturnValue(['inserted-1', 'inserted-2']);
    aiTopicClassifier.classifyTopicDetailsForArticlesWithStatus.mockResolvedValue({
      topicsByArticleId: new Map(),
      attemptedArticleIds: ['inserted-1'],
      failedArticleIds: [],
      cappedArticleIds: ['inserted-2']
    });

    scheduleAiTopicsForPendingArticles([
      { id: 'inserted-1', title: 'AI chip rollout' },
      { id: 'inserted-2', title: 'Market rally' }
    ]);
    await flushBackgroundAiProcessing();

    expect(database.markArticlesAiTopicProcessing).toHaveBeenCalledWith(['inserted-1'], 'no_topics');
    expect(database.markArticlesAiTopicProcessing).toHaveBeenCalledWith(['inserted-2'], 'deferred');
  });

  test('AI story grouping assigns matched articles in the background', async () => {
    const target = {
      id: 'story-target',
      sourceId: ansaSourceId,
      source: 'ANSA',
      title: 'Meloni meets Trump in Rome',
      description: 'Talks focused on tariffs and Ukraine.',
      pubDate: recentIso()
    };
    const candidate = {
      id: 'story-candidate',
      sourceId: 'source-b',
      source: 'Source B',
      title: 'Tariffs and Ukraine at Trump Meloni summit',
      description: 'The two leaders met in the Italian capital.',
      pubDate: recentIso({ minutesAgo: 10 })
    };

    aiStoryGrouper.isAiStoryGroupingAvailable.mockReturnValue(true);
    database.getArticleIdsPendingAiStoryGrouping.mockReturnValue(['story-target']);
    database.getAiStoryGroupingCandidateSet.mockReturnValue({ target, candidates: [candidate] });
    aiStoryGrouper.findSimilarStoriesForArticle.mockResolvedValue({
      matches: [{ articleId: 'story-candidate', confidence: 0.9 }],
      model: 'test-story-model'
    });
    database.assignArticlesToStoryGroup.mockReturnValue(2);

    scheduleAiStoryGroupingForPendingArticles([target]);
    await flushBackgroundAiProcessing();

    expect(database.getAiStoryGroupingCandidateSet).toHaveBeenCalledWith('story-target', expect.objectContaining({ windowHours: 24, limit: 64 }));
    expect(database.assignArticlesToStoryGroup).toHaveBeenCalledWith(['story-target', 'story-candidate'], 'ai-story-story-candidate-story-target', 'test-story-model', [
      { articleId: 'story-candidate', confidence: 0.9 }
    ]);
    expect(websocketService.broadcastFeedRefresh).toHaveBeenCalledWith({ userIds: [], reason: 'stories' });
  });

  test('skips queued story targets that were matched by an earlier grouping job', async () => {
    const target = { id: 'story-target', aiStoryGroupStatus: 'matched', storyGroupId: 'story-1' };
    aiStoryGrouper.isAiStoryGroupingAvailable.mockReturnValue(true);
    database.getArticleIdsPendingAiStoryGrouping.mockReturnValue(['story-target']);
    database.getAiStoryGroupingCandidateSet.mockReturnValue({ target, candidates: [] });

    scheduleAiStoryGroupingForPendingArticles([target]);
    await flushBackgroundAiProcessing();

    expect(aiStoryGrouper.findSimilarStoriesForArticle).not.toHaveBeenCalled();
    expect(database.markArticlesAiStoryGrouping).not.toHaveBeenCalled();
  });

  test('does not overwrite a story matched while another model request is in flight', async () => {
    const target = { id: 'story-target', title: 'Shared summit report' };
    const candidate = { id: 'story-candidate', title: 'Shared summit update' };
    const deferredResult = createDeferred();
    aiStoryGrouper.isAiStoryGroupingAvailable.mockReturnValue(true);
    database.getArticleIdsPendingAiStoryGrouping.mockReturnValue(['story-target']);
    database.getAiStoryGroupingCandidateSet.mockReturnValue({ target, candidates: [candidate] });
    aiStoryGrouper.findSimilarStoriesForArticle.mockReturnValue(deferredResult.promise);

    scheduleAiStoryGroupingForPendingArticles([target]);
    await flushBackgroundAiProcessing();
    database.getArticleById.mockReturnValue({ ...target, aiStoryGroupStatus: 'matched', storyGroupId: 'story-newer' });
    deferredResult.resolve({ matches: [], model: 'test-story-model', candidates: [candidate] });
    await flushBackgroundAiProcessing();

    expect(database.markArticlesAiStoryGrouping).not.toHaveBeenCalled();
    expect(database.assignArticlesToStoryGroup).not.toHaveBeenCalled();
  });

  test('uses a candidate group created while the model request is in flight', async () => {
    const target = { id: 'story-target', title: 'Shared summit report' };
    const candidate = { id: 'story-candidate', title: 'Shared summit update' };
    const deferredResult = createDeferred();
    aiStoryGrouper.isAiStoryGroupingAvailable.mockReturnValue(true);
    database.getArticleIdsPendingAiStoryGrouping.mockReturnValue(['story-target']);
    database.getAiStoryGroupingCandidateSet.mockReturnValue({ target, candidates: [candidate] });
    aiStoryGrouper.findSimilarStoriesForArticle.mockReturnValue(deferredResult.promise);
    database.assignArticlesToStoryGroup.mockReturnValue(2);

    scheduleAiStoryGroupingForPendingArticles([target]);
    await flushBackgroundAiProcessing();
    database.getArticleById.mockImplementation((articleId: string) => articleId === candidate.id
      ? { ...candidate, aiStoryGroupStatus: 'matched', storyGroupId: 'story-newer' }
      : target);
    database.getArticleIdsForStoryGroups.mockReturnValue(['story-candidate']);
    deferredResult.resolve({
      matches: [{ articleId: candidate.id, confidence: 0.9 }],
      model: 'test-story-model',
      candidates: [candidate]
    });
    await flushBackgroundAiProcessing();

    expect(database.getArticleIdsForStoryGroups).toHaveBeenCalledWith(['story-newer'], null);
    expect(database.assignArticlesToStoryGroup).toHaveBeenCalledWith(
      ['story-target', 'story-candidate'],
      'story-newer',
      'test-story-model',
      [{ articleId: 'story-candidate', confidence: 0.9 }]
    );
  });

  test('does not create a story group from a candidate deleted during the model request', async () => {
    const target = { id: 'story-target', title: 'Shared summit report' };
    const candidate = { id: 'story-candidate', title: 'Shared summit update' };
    const deferredResult = createDeferred();
    aiStoryGrouper.isAiStoryGroupingAvailable.mockReturnValue(true);
    database.getArticleIdsPendingAiStoryGrouping.mockReturnValue(['story-target']);
    database.getAiStoryGroupingCandidateSet.mockReturnValue({ target, candidates: [candidate] });
    aiStoryGrouper.findSimilarStoriesForArticle.mockReturnValue(deferredResult.promise);

    scheduleAiStoryGroupingForPendingArticles([target]);
    await flushBackgroundAiProcessing();
    database.getArticleById.mockImplementation((articleId: string) => articleId === candidate.id ? null : target);
    deferredResult.resolve({
      matches: [{ articleId: candidate.id, confidence: 0.9 }],
      model: 'test-story-model',
      candidates: [candidate]
    });
    await flushBackgroundAiProcessing();

    expect(database.assignArticlesToStoryGroup).not.toHaveBeenCalled();
    expect(database.markArticlesAiStoryGrouping).toHaveBeenCalledWith(['story-target'], 'no_match', 'test-story-model', {
      matchIds: [],
      reason: 'unchanged_candidate_signature'
    });
  });

  test('AI story grouping bridges all members of existing story groups', async () => {
    const target = {
      id: 'story-target',
      title: 'Summit follow-up connects reports',
      description: 'The latest report ties together both earlier story clusters.',
      pubDate: recentIso()
    };
    const candidateA = {
      id: 'story-candidate-a',
      title: 'Earlier summit report',
      description: 'First cluster member.',
      storyGroupId: 'ai-story-a',
      pubDate: recentIso({ minutesAgo: 10 })
    };
    const candidateB = {
      id: 'story-candidate-b',
      title: 'Second summit report',
      description: 'Second cluster member.',
      storyGroupId: 'ai-story-b',
      pubDate: recentIso({ minutesAgo: 20 })
    };

    aiStoryGrouper.isAiStoryGroupingAvailable.mockReturnValue(true);
    database.getArticleIdsPendingAiStoryGrouping.mockReturnValue(['story-target']);
    database.getAiStoryGroupingCandidateSet.mockReturnValue({ target, candidates: [candidateA, candidateB] });
    database.getArticleIdsForStoryGroups.mockReturnValue(['story-candidate-a', 'story-extra-a', 'story-candidate-b', 'story-extra-b']);
    aiStoryGrouper.findSimilarStoriesForArticle.mockResolvedValue({
      matches: [
        { articleId: 'story-candidate-a', confidence: 0.94 },
        { articleId: 'story-candidate-b', confidence: 0.92 }
      ],
      model: 'test-story-model'
    });
    database.assignArticlesToStoryGroup.mockReturnValue(5);

    scheduleAiStoryGroupingForPendingArticles([target]);
    await flushBackgroundAiProcessing();

    expect(database.getArticleIdsForStoryGroups).toHaveBeenCalledWith(['ai-story-a', 'ai-story-b'], null);
    expect(database.assignArticlesToStoryGroup).toHaveBeenCalledWith([
      'story-target',
      'story-candidate-a',
      'story-candidate-b',
      'story-extra-a',
      'story-extra-b'
    ], 'ai-story-a', 'test-story-model', [
      { articleId: 'story-candidate-a', confidence: 0.94 },
      { articleId: 'story-candidate-b', confidence: 0.92 }
    ]);
    expect(aiStoryGrouper.buildStoryGroupId).not.toHaveBeenCalled();
  });

  test('AI story grouping avoids low-confidence bridges between existing groups', async () => {
    const target = {
      id: 'story-target',
      title: 'Summit follow-up connects reports',
      description: 'The latest report ties together earlier story clusters.',
      pubDate: recentIso()
    };
    const candidateA = {
      id: 'story-candidate-a',
      title: 'Earlier summit report',
      description: 'First cluster member.',
      storyGroupId: 'ai-story-a',
      pubDate: recentIso({ minutesAgo: 10 })
    };
    const candidateB = {
      id: 'story-candidate-b',
      title: 'Second summit report',
      description: 'Second cluster member.',
      storyGroupId: 'ai-story-b',
      pubDate: recentIso({ minutesAgo: 20 })
    };

    aiStoryGrouper.isAiStoryGroupingAvailable.mockReturnValue(true);
    database.getArticleIdsPendingAiStoryGrouping.mockReturnValue(['story-target']);
    database.getAiStoryGroupingCandidateSet.mockReturnValue({ target, candidates: [candidateA, candidateB] });
    database.getArticleIdsForStoryGroups.mockReturnValue(['story-candidate-a', 'story-extra-a']);
    aiStoryGrouper.findSimilarStoriesForArticle.mockResolvedValue({
      matches: [
        { articleId: 'story-candidate-a', confidence: 0.89 },
        { articleId: 'story-candidate-b', confidence: 0.88 }
      ],
      model: 'test-story-model'
    });
    database.assignArticlesToStoryGroup.mockReturnValue(3);

    scheduleAiStoryGroupingForPendingArticles([target]);
    await flushBackgroundAiProcessing();

    expect(database.getArticleIdsForStoryGroups).toHaveBeenCalledWith(['ai-story-a'], null);
    expect(database.assignArticlesToStoryGroup).toHaveBeenCalledWith([
      'story-target',
      'story-candidate-a',
      'story-extra-a'
    ], 'ai-story-a', 'test-story-model', [
      { articleId: 'story-candidate-a', confidence: 0.89 }
    ]);
  });

  test('AI story grouping retries recent no-match articles around new inserts', async () => {
    aiStoryGrouper.isAiStoryGroupingAvailable.mockReturnValue(true);
    database.getArticleIdsPendingAiStoryGrouping.mockReturnValue([]);
    database.getArticleIdsForAiStoryGroupingRetry.mockReturnValue(['retry-story']);
    database.getAiStoryGroupingCandidateSet.mockReturnValue({ target: { id: 'retry-story' }, candidates: [] });

    scheduleAiStoryGroupingForPendingArticles([{ id: 'new-story' }], { retryAnchorArticleIds: ['new-story'] });
    await flushBackgroundAiProcessing();

    expect(database.getArticleIdsForAiStoryGroupingRetry).toHaveBeenCalledWith(['new-story'], expect.objectContaining({ windowHours: 24, limit: 12 }));
    expect(database.getAiStoryGroupingCandidateSet).toHaveBeenCalledWith('retry-story', expect.any(Object));
    expect(database.markArticlesAiStoryGrouping).toHaveBeenCalledWith(['retry-story'], 'no_candidates');
  });

  test('AI story grouping marks disabled model responses as deferred', async () => {
    const target = { id: 'story-target', title: 'Target', description: 'Target story', pubDate: recentIso() };
    const candidate = { id: 'story-candidate', title: 'Target update', description: 'Target story update', pubDate: recentIso({ minutesAgo: 5 }) };

    aiStoryGrouper.isAiStoryGroupingAvailable.mockReturnValue(true);
    database.getArticleIdsPendingAiStoryGrouping.mockReturnValue(['story-target']);
    database.getAiStoryGroupingCandidateSet.mockReturnValue({ target, candidates: [candidate] });
    aiStoryGrouper.findSimilarStoriesForArticle.mockResolvedValue({ matches: [], model: 'test-story-model', skipped: 'disabled' });

    scheduleAiStoryGroupingForPendingArticles([target]);
    await flushBackgroundAiProcessing();

    expect(database.markArticlesAiStoryGrouping).toHaveBeenCalledWith(['story-target'], 'deferred', 'test-story-model');
  });

  test('marks pending AI articles failed when background classification throws', async () => {
    rssParser.parseFeed.mockResolvedValue([
      { id: 'inserted-1', sourceId: 'ansa_mondo', source: 'ANSA - Mondo', title: 'AI chips advance', description: 'New processors', pubDate: recentIso({ hoursAgo: 2 }), url: 'https://example.com/ai' }
    ]);
    database.upsertArticles.mockReturnValue({ insertedIds: ['inserted-1'], insertedCount: 1, updatedCount: 0 });
    database.getArticleIdsPendingAiTopicProcessing.mockReturnValue(['inserted-1']);
    aiTopicClassifier.classifyTopicDetailsForArticlesWithStatus.mockRejectedValue(new Error('quota exhausted'));

    await newsAggregator.ingestAllNews({ broadcast: true });
    await flushBackgroundAiProcessing();

    expect(database.markArticlesAiTopicProcessing).toHaveBeenCalledWith(['inserted-1'], 'failed');
  });

  test('ingestAllNews does not re-merge fallback topics for already AI-processed articles', async () => {
    rssParser.parseFeed.mockResolvedValue([
      { id: 'existing-1', sourceId: 'ansa_mondo', source: 'ANSA - Mondo', title: 'Existing story', description: 'Markets rise', pubDate: recentIso({ hoursAgo: 2 }), url: 'https://example.com/existing' }
    ]);
    database.upsertArticles.mockReturnValue({ insertedIds: [], updatedIds: ['existing-1'], insertedCount: 0, updatedCount: 1 });
    database.getArticleIdsPendingAiTopicProcessing.mockReturnValue([]);

    await newsAggregator.ingestAllNews({ broadcast: true });

    expect(database.mergeTopicsForArticles).toHaveBeenCalledWith([]);
  });

  test('uses updated articles as story-grouping retry anchors', async () => {
    rssParser.parseFeed.mockResolvedValue([
      { id: 'existing-1', sourceId: 'ansa_mondo', source: 'ANSA - Mondo', title: 'Updated story', description: 'Updated details', pubDate: recentIso({ hoursAgo: 2 }), url: 'https://example.com/existing' }
    ]);
    database.upsertArticles.mockReturnValue({ insertedIds: [], updatedIds: ['existing-1'], insertedCount: 0, updatedCount: 1 });
    database.getArticleIdsPendingAiStoryGrouping.mockReturnValue(['existing-1']);
    database.getAiStoryGroupingCandidateSet.mockReturnValue({ target: { id: 'existing-1' }, candidates: [] });
    aiStoryGrouper.isAiStoryGroupingAvailable.mockReturnValue(true);

    await newsAggregator.ingestAllNews({ broadcast: true });
    await flushBackgroundAiProcessing();

    expect(database.getArticleIdsForAiStoryGroupingRetry).toHaveBeenCalledWith(['existing-1'], expect.any(Object));
    expect(database.getAiStoryGroupingCandidateSet).toHaveBeenCalledWith('existing-1', expect.any(Object));
  });

  test('ingestAllNews fetches a shared custom RSS URL once and fans out articles per owning user source', async () => {
    const sharedUrl = 'https://example.com/shared.xml';
    database.listUsers.mockReturnValue([
      { id: 'user-1', lastActivityAt: new Date().toISOString() },
      { id: 'user-2', lastActivityAt: new Date().toISOString() }
    ]);
    database.listAllActiveUserSources.mockReturnValue([
      { id: 'custom-user-1', name: 'Shared Feed A', url: sharedUrl, language: 'en', userId: 'user-1', isActive: true },
      { id: 'custom-user-2', name: 'Shared Feed B', url: sharedUrl, language: 'en', userId: 'user-2', isActive: true }
    ]);
    rssParser.parseFeed.mockImplementation(async (source: { url: string; id: string; name: string; ownerUserId?: string }) => {
      if (source.url !== sharedUrl) {
        return [];
      }

      return [{
        id: 'representative-id',
        sourceId: source.id,
        source: source.name,
        title: 'Shared custom story',
        description: 'Shared story description',
        pubDate: recentIso({ hoursAgo: 2 }),
        url: 'https://example.com/story',
        canonicalUrl: 'https://example.com/story',
        language: 'en',
        ownerUserId: source.ownerUserId
      }];
    });
    database.upsertArticles.mockReturnValue({
      insertedIds: ['custom-user-1:https://example.com/story', 'custom-user-2:https://example.com/story'],
      insertedCount: 2,
      updatedCount: 0
    });

    await newsAggregator.ingestAllNews({ broadcast: false });

    const sharedFetchCalls = rssParser.parseFeed.mock.calls.filter(([source]: [{ url: string }]) => source.url === sharedUrl);
    expect(sharedFetchCalls).toHaveLength(1);
    expect(sharedFetchCalls[0][1]).toEqual({ imageFallback: true, throwOnError: true });
    expect(database.upsertArticles).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        id: 'custom-user-1:https://example.com/story',
        sourceId: 'custom-user-1',
        source: 'Shared Feed A',
        ownerUserId: 'user-1'
      }),
      expect.objectContaining({
        id: 'custom-user-2:https://example.com/story',
        sourceId: 'custom-user-2',
        source: 'Shared Feed B',
        ownerUserId: 'user-2'
      })
    ]));
  });

  test('reuses fresh custom source results for a later owner', async () => {
    const sharedUrl = 'https://example.com/sequential-shared.xml';
    const sourceA = { id: 'custom-a', name: 'Feed A', url: sharedUrl, language: 'en', ownerUserId: 'user-1' };
    const sourceB = { id: 'custom-b', name: 'Feed B', url: sharedUrl, language: 'en', ownerUserId: 'user-2' };
    database.findUserSourceById.mockImplementation((userId: string, sourceId: string) => {
      const source = [sourceA, sourceB].find((candidate) => candidate.ownerUserId === userId && candidate.id === sourceId);
      return source ? { ...source, userId: source.ownerUserId, isActive: true } : null;
    });
    rssParser.parseFeed.mockResolvedValue([{
      id: 'representative-id',
      sourceId: sourceA.id,
      source: sourceA.name,
      title: 'Sequential shared story',
      description: 'Shared story description',
      pubDate: recentIso({ hoursAgo: 1 }),
      url: 'https://example.com/sequential-story',
      canonicalUrl: 'https://example.com/sequential-story',
      language: 'en'
    }]);
    database.upsertArticles.mockImplementation((articles: Array<{ id: string }>) => ({
      insertedIds: articles.map((article: { id: string }) => article.id),
      insertedCount: articles.length,
      updatedCount: 0
    }));

    await ingestSourceConfigs([sourceA], { broadcast: false, sourceFetchFreshnessMs: 300000 });
    await ingestSourceConfigs([sourceB], { broadcast: false, sourceFetchFreshnessMs: 300000 });

    expect(rssParser.parseFeed).toHaveBeenCalledTimes(1);
    expect(database.upsertArticles).toHaveBeenLastCalledWith([
      expect.objectContaining({ sourceId: sourceB.id, ownerUserId: 'user-2' })
    ]);
  });

  test('fetches custom feeds separately when their query parameters differ', async () => {
    const sourceA = { id: 'custom-query-a', name: 'Feed A', url: 'https://example.com/feed.xml?utm_source=a', language: 'en', ownerUserId: 'user-1' };
    const sourceB = { id: 'custom-query-b', name: 'Feed B', url: 'https://example.com/feed.xml?utm_source=b', language: 'en', ownerUserId: 'user-2' };
    database.findUserSourceById.mockImplementation((userId: string, sourceId: string) => {
      const source = [sourceA, sourceB].find((candidate) => candidate.ownerUserId === userId && candidate.id === sourceId);
      return source ? { ...source, userId, isActive: true } : null;
    });
    rssParser.parseFeed.mockImplementation(async (source: { id: string; name: string; ownerUserId?: string }) => [{
      id: `article-${source.id}`,
      sourceId: source.id,
      source: source.name,
      title: `Story for ${source.id}`,
      pubDate: recentIso({ hoursAgo: 1 }),
      url: `https://example.com/story-${source.id}`,
      ownerUserId: source.ownerUserId
    }]);
    database.upsertArticles.mockImplementation((articles: Array<{ id: string }>) => ({
      insertedIds: articles.map((article: { id: string }) => article.id),
      insertedCount: articles.length,
      updatedCount: 0
    }));

    await ingestSourceConfigs([sourceA, sourceB], { broadcast: false, bypassSourceFreshness: true });

    expect(rssParser.parseFeed).toHaveBeenCalledTimes(2);
    expect(database.upsertArticles).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ sourceId: sourceA.id, ownerUserId: sourceA.ownerUserId }),
      expect.objectContaining({ sourceId: sourceB.id, ownerUserId: sourceB.ownerUserId })
    ]));
  });

  test.each(['deleted', 'updated'])('discards custom source results when the source is %s during refresh', async (change) => {
    const source = {
      id: `custom-${change}`,
      name: 'Mutable Feed',
      url: `https://example.com/${change}.xml`,
      language: 'en',
      ownerUserId: 'user-1',
      updatedAt: '2026-03-01T10:00:00.000Z'
    };
    let currentSource: (typeof source & { userId: string; isActive: boolean }) | null = { ...source, userId: source.ownerUserId, isActive: true };
    const deferred = createDeferred();
    database.findUserSourceById.mockImplementation(() => currentSource);
    rssParser.parseFeed.mockReturnValue(deferred.promise);

    const ingestion = ingestSourceConfigs([source], { broadcast: false, bypassSourceFreshness: true });
    currentSource = change === 'deleted'
      ? null
      : { ...currentSource, url: 'https://example.com/replacement.xml', updatedAt: '2026-03-01T11:00:00.000Z' };
    deferred.resolve([{
      id: 'stale-article',
      sourceId: source.id,
      source: source.name,
      title: 'Stale custom story',
      description: '',
      pubDate: recentIso({ hoursAgo: 1 }),
      url: 'https://example.com/stale-story',
      canonicalUrl: 'https://example.com/stale-story',
      language: 'en'
    }]);

    await ingestion;

    expect(database.upsertArticles).toHaveBeenCalledWith([]);
  });

  test('skips upstream source fetches inside the freshness window', async () => {
    const source = { id: 'source-a', name: 'Source A', url: 'https://example.com/feed.xml', language: 'en' };
    let lastRefreshAt: string | null = null;
    const runtime = {
      getLastRefreshAt: () => lastRefreshAt,
      setLastRefreshAt: (value: string) => { lastRefreshAt = value; }
    };

    rssParser.parseFeed.mockResolvedValue([{ id: 'article-1', sourceId: 'source-a', source: 'Source A', title: 'Fresh story', pubDate: recentIso({ hoursAgo: 1 }), url: 'https://example.com/story' }]);
    database.upsertArticles.mockReturnValue({ insertedIds: ['article-1'], insertedCount: 1, updatedCount: 0 });

    await ingestSourceConfigs([source], { sourceFetchFreshnessMs: 300000 }, runtime);
    await ingestSourceConfigs([{ ...source, id: 'source-b', name: 'Source B' }], { sourceFetchFreshnessMs: 300000 }, runtime);

    expect(rssParser.parseFeed).toHaveBeenCalledTimes(1);
  });

  test('prunes stale source freshness entries', () => {
    const now = Date.now();

    _sourceFetchTimestamps.set('https://example.com/old.xml', now - (2 * 60 * 60 * 1000));
    _sourceFetchTimestamps.set('https://example.com/fresh.xml', now);

    expect(_pruneSourceFetchTimestamps(now)).toBe(1);
    expect(_sourceFetchTimestamps.has('https://example.com/old.xml')).toBe(false);
    expect(_sourceFetchTimestamps.has('https://example.com/fresh.xml')).toBe(true);
  });

  test('normalizes duplicate sibling subfeed articles into one incoming article', () => {
    const normalizedArticles = normalizeIncomingArticles([
      {
        id: 'ansa-home-story',
        sourceId: 'ansa_home',
        source: 'ANSA - Home',
        title: 'Shared ANSA story',
        description: 'Home version',
        pubDate: '2026-03-07T10:00:00.000Z',
        url: 'https://example.com/shared-story?utm_source=home'
      },
      {
        id: 'ansa-mondo-story',
        sourceId: 'ansa_mondo',
        source: 'ANSA - Mondo',
        title: 'Shared ANSA story updated',
        description: 'Mondo version with more detail',
        content: 'Longer body wins when the same source family repeats a story.',
        pubDate: '2026-03-07T10:05:00.000Z',
        url: 'https://example.com/shared-story?utm_source=mondo'
      }
    ]);

    expect(normalizedArticles).toHaveLength(1);
    expect(normalizedArticles[0]).toEqual(expect.objectContaining({
      id: 'ansa-mondo-story',
      rawSourceId: 'ansa_mondo',
      sourceId: ansaSourceId,
      source: ansaSourceName,
      title: 'Shared ANSA story updated'
    }));
  });

  test('ingestAllNews throws a connection error when no feed is reachable and the database is empty', async () => {
    database.countArticles.mockReturnValue(0);
    rssParser.parseFeed.mockRejectedValue(new Error('Network failed'));

    await expect(newsAggregator.ingestAllNews({ broadcast: false })).rejects.toMatchObject({
      status: 503,
      code: 'CONNECTION_ERROR'
    });

    expect(database.completeIngestionRun).toHaveBeenCalledWith(1, expect.objectContaining({
      status: 'failed',
      errorMessage: expect.any(String)
    }));
  });

  test('marks tracked ingestion degraded when some feeds fail', async () => {
    let callCount = 0;
    rssParser.parseFeed.mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) {
        throw new Error('Network failed');
      }

      return [{ id: 'ok-1', sourceId: 'ansa_mondo', source: 'ANSA - Mondo', title: 'Reachable feed', pubDate: recentIso({ hoursAgo: 1 }), url: 'https://example.com/ok' }];
    });
    database.upsertArticles.mockReturnValue({ insertedIds: ['ok-1'], insertedCount: 1, updatedCount: 0 });

    const result = await newsAggregator.ingestAllNews({ broadcast: false });

    expect(result).toMatchObject({ success: true, fetchedCount: 1, insertedCount: 1 });
    expect(database.completeIngestionRun).toHaveBeenCalledWith(1, expect.objectContaining({
      status: 'degraded',
      errorMessage: expect.stringContaining('feeds failed')
    }));
  });

  test('ingestAllNews cleans stale default-source data before fetching feeds', async () => {
    database.cleanupRemovedConfiguredSourceData.mockReturnValue({ removedArticles: 2, updatedSettings: 1 });
    database.normalizeFuturePublicationDates.mockReturnValue(1);

    await newsAggregator.ingestAllNews({ broadcast: false });

    expect(database.normalizeFuturePublicationDates).toHaveBeenCalledTimes(1);
    expect(database.deleteArticlesOlderThan).toHaveBeenCalledTimes(1);
    expect(database.cleanupRemovedConfiguredSourceData).toHaveBeenCalledTimes(1);
    expect(rssParser.parseFeed).toHaveBeenCalled();
  });

  test('refreshUserSources fetches only the requested active user sources', async () => {
    database.listUserSources.mockReturnValue([
      { id: 'custom-1', name: 'Alpha Feed', url: 'https://example.com/alpha.xml', language: 'en', userId: 'user-1', isActive: true },
      { id: 'custom-2', name: 'Beta Feed', url: 'https://example.com/beta.xml', language: 'it', userId: 'user-1', isActive: true },
      { id: 'custom-3', name: 'Inactive Feed', url: 'https://example.com/inactive.xml', language: 'it', userId: 'user-1', isActive: false }
    ]);
    rssParser.parseFeed.mockResolvedValue([{ id: 'private-1', sourceId: 'custom-2', source: 'Beta Feed', title: 'Private update', pubDate: recentIso({ hoursAgo: 1 }), url: 'https://example.com/p', rawTopics: ['Markets'], ownerUserId: 'user-1' }]);
    database.upsertArticles.mockReturnValue({ insertedIds: ['private-1'], insertedCount: 1, updatedCount: 0 });

    const result = await newsAggregator.refreshUserSources('user-1', { sourceIds: ['custom-2'], broadcast: false });

    expect(result).toMatchObject({ success: true, fetchedCount: 1, insertedCount: 1, updatedCount: 0 });
    expect(rssParser.parseFeed).toHaveBeenCalledTimes(1);
    expect(rssParser.parseFeed).toHaveBeenCalledWith(expect.objectContaining({
      id: 'custom-2',
      name: 'Beta Feed',
      ownerUserId: 'user-1'
    }), {
      imageFallback: true,
      throwOnError: true
    });
    expect(database.createIngestionRun).not.toHaveBeenCalled();
  });

  test('mapSettledWithConcurrency limits concurrent feed work', async () => {
    let activeCount = 0;
    let maxActiveCount = 0;

    const results = await mapSettledWithConcurrency([1, 2, 3, 4, 5], 2, async (item: number) => {
      activeCount += 1;
      maxActiveCount = Math.max(maxActiveCount, activeCount);
      await new Promise((resolve) => setTimeout(resolve, 1));
      activeCount -= 1;
      return item * 2;
    });

    expect(maxActiveCount).toBeLessThanOrEqual(2);
    expect(results).toEqual([
      { status: 'fulfilled', value: 2 },
      { status: 'fulfilled', value: 4 },
      { status: 'fulfilled', value: 6 },
      { status: 'fulfilled', value: 8 },
      { status: 'fulfilled', value: 10 }
    ]);
  });
});
