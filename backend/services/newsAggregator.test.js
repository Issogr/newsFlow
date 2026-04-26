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
  markArticlesAiTopicProcessing: jest.fn(() => 0),
  mergeTopicsForArticles: jest.fn(() => 0),
  replaceTopicsForArticles: jest.fn(() => 0),
  getArticlesByIds: jest.fn(() => []),
  getArticles: jest.fn(() => []),
  getLatestIngestionRun: jest.fn(() => null),
  getSourceStats: jest.fn(() => []),
  getTopicStatsByFilters: jest.fn(() => []),
  getUserSettings: jest.fn(() => ({ excludedSourceIds: [], excludedSubSourceIds: [] })),
  listUsers: jest.fn(() => []),
  listUserSources: jest.fn(() => []),
  listAllActiveUserSources: jest.fn(() => [])
}));

jest.mock('../utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

jest.mock('./websocketService', () => ({
  broadcastNewsUpdate: jest.fn(),
  broadcastFeedRefresh: jest.fn(),
  broadcastSystemNotification: jest.fn()
}));

jest.mock('./aiTopicClassifier', () => ({
  classifyTopicDetailsForArticles: jest.fn(async () => new Map()),
  isAiTopicDetectionAvailable: jest.fn(() => true)
}));

const rssParser = require('./rssParser');
const database = require('./database');
const websocketService = require('./websocketService');
const aiTopicClassifier = require('./aiTopicClassifier');
const newsAggregator = require('./newsAggregator');
const { normalizeIncomingArticles } = require('./newsAggregatorGrouping');
const {
  mapSettledWithConcurrency,
  scheduleAiTopicsForPendingArticles,
  _filterArticlesWithinRetention,
  _resetPendingAiTopicProcessingIds
} = require('./newsAggregatorIngestion');
const { getCanonicalSourceId, getCanonicalSourceName } = require('../utils/sourceCatalog');

const ansaSourceId = getCanonicalSourceId('ansa_mondo', 'ANSA - Mondo');
const ansaSourceName = getCanonicalSourceName('ansa_mondo', 'ANSA - Mondo');

async function flushBackgroundAiProcessing() {
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  await Promise.resolve();
}

function recentIso({ hoursAgo = 0, minutesAgo = 0 } = {}) {
  return new Date(Date.now() - ((hoursAgo * 60 * 60 * 1000) + (minutesAgo * 60 * 1000))).toISOString();
}

describe('newsAggregator service flows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    newsAggregator._resetImmediateRefreshState();
    _resetPendingAiTopicProcessingIds();
    database.countArticles.mockReturnValue(1);
    database.deleteArticlesOlderThan.mockReturnValue(0);
    database.normalizeFuturePublicationDates.mockReturnValue(0);
    database.cleanupRemovedConfiguredSourceData.mockReturnValue({ removedArticles: 0, updatedSettings: 0 });
    database.getArticleIdsPendingAiTopicProcessing.mockReturnValue([]);
    database.getArticles.mockReturnValue([]);
    database.getLatestIngestionRun.mockReturnValue(null);
    database.getSourceStats.mockReturnValue([]);
    database.getTopicStatsByFilters.mockReturnValue([]);
    database.getUserSettings.mockReturnValue({ excludedSourceIds: [], excludedSubSourceIds: [] });
    database.listUsers.mockReturnValue([{ id: 'user-1', lastActivityAt: new Date().toISOString() }]);
    database.listUserSources.mockReturnValue([]);
    database.listAllActiveUserSources.mockReturnValue([]);
    database.upsertArticles.mockReturnValue({ insertedIds: [], insertedCount: 0, updatedCount: 0 });
    aiTopicClassifier.isAiTopicDetectionAvailable.mockReturnValue(true);
    aiTopicClassifier.classifyTopicDetailsForArticles.mockResolvedValue(new Map());
    rssParser._buildArticleId.mockImplementation((source, item, canonicalUrl = '') => `${source.id}:${canonicalUrl || item.link || item.title}`);
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

    database.getArticles
      .mockReturnValueOnce([groupedArticleA, groupedArticleB])
      .mockReturnValueOnce([]);
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
        beforeId: 'global-1'
      },
      scannedArticles: 2,
      ingestion: { id: 7, status: 'completed' }
    });
    expect(result.filters.sourceCatalog).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: ansaSourceId, name: ansaSourceName }),
      expect.objectContaining({ id: 'example.com', name: 'My Feed', language: 'en' })
    ]));
    expect(database.getArticles).toHaveBeenCalledWith(expect.objectContaining({ limit: 2, offset: 0 }), expect.objectContaining({ userId: 'user-1' }));
  });

  test('getNewsFeed applies page offsets when no cursor is provided', async () => {
    database.getArticles.mockReturnValue([]);

    await newsAggregator.getNewsFeed({ page: 3, pageSize: 10 }, { userId: 'user-1' });

    expect(database.getArticles).toHaveBeenCalledWith(expect.objectContaining({
      limit: 11,
      offset: 20
    }), expect.objectContaining({ userId: 'user-1' }));
  });

  test('getNewsFeed ignores page offset when cursor pagination is used', async () => {
    database.getArticles.mockReturnValue([]);

    await newsAggregator.getNewsFeed({
      page: 3,
      pageSize: 10,
      beforePubDate: '2026-03-07T10:00:00.000Z',
      beforeId: 'article-1'
    }, { userId: 'user-1' });

    expect(database.getArticles).toHaveBeenCalledWith(expect.objectContaining({
      limit: 11,
      offset: 0
    }), expect.objectContaining({ userId: 'user-1' }));
  });

  test('active assigned source selection skips inactive users and excluded default sources', () => {
    const now = Date.now();
    database.listUsers.mockReturnValue([
      { id: 'active-user', lastActivityAt: new Date(now).toISOString() },
      { id: 'inactive-user', lastActivityAt: new Date(now - (20 * 60 * 1000)).toISOString() }
    ]);
    database.getUserSettings.mockImplementation((userId) => ({
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

  test('getNewsFeed starts one background assigned-source refresh until a scheduled cycle runs', async () => {
    const userContext = { userId: 'user-1', excludedSourceIds: [ansaSourceId], excludedSubSourceIds: [] };
    const customSource = { id: 'custom-1', name: 'User Feed', url: 'https://example.com/user.xml', language: 'en', userId: 'user-1', isActive: true };
    database.listUserSources.mockReturnValue([customSource]);
    database.listAllActiveUserSources.mockReturnValue([customSource]);

    await newsAggregator.getNewsFeed({}, userContext);
    await newsAggregator._waitForExistingUserAssignedSourceRefresh(userContext);

    expect(rssParser.parseFeed.mock.calls.filter(([source]) => source.id === 'custom-1')).toHaveLength(1);

    await newsAggregator.getNewsFeed({}, userContext);
    expect(rssParser.parseFeed.mock.calls.filter(([source]) => source.id === 'custom-1')).toHaveLength(1);

    await newsAggregator.ingestAllNews({ broadcast: false });
    await newsAggregator.getNewsFeed({}, userContext);
    await newsAggregator._waitForExistingUserAssignedSourceRefresh(userContext);

    expect(rssParser.parseFeed.mock.calls.filter(([source]) => source.id === 'custom-1')).toHaveLength(3);
  });

  test('getNewsFeed reports when an open-triggered user refresh is still pending', async () => {
    const allDefaultSourceGroupIds = [...new Set(newsAggregator.newsSources.map((source) => getCanonicalSourceId(source.id, source.name)))];
    const userContext = { userId: 'user-1', excludedSourceIds: allDefaultSourceGroupIds, excludedSubSourceIds: [] };
    const customSource = { id: 'custom-1', name: 'User Feed', url: 'https://example.com/user.xml', language: 'en', userId: 'user-1', isActive: true };
    let resolveParse;
    const parseStarted = new Promise((resolve) => {
      rssParser.parseFeed.mockImplementation(async (source) => {
        if (source.id !== 'custom-1') {
          return [];
        }

        resolve();
        await new Promise((parseResolve) => {
          resolveParse = parseResolve;
        });
        return [];
      });
    });
    database.listUserSources.mockReturnValue([customSource]);

    const resultPromise = newsAggregator.getNewsFeed({}, userContext);
    await parseStarted;

    expect(newsAggregator._hasPendingUserAssignedSourceRefresh(userContext)).toBe(true);

    const result = await resultPromise;

    expect(result.meta.pendingUserRefresh).toBe(true);

    resolveParse();
    await newsAggregator._waitForExistingUserAssignedSourceRefresh(userContext);
    expect(newsAggregator._hasPendingUserAssignedSourceRefresh(userContext)).toBe(false);
  });

  test('getNewsFeed waits for an existing immediate assigned-source refresh before reading feed', async () => {
    const allDefaultSourceGroupIds = [...new Set(newsAggregator.newsSources.map((source) => getCanonicalSourceId(source.id, source.name)))];
    const userContext = { userId: 'user-1', excludedSourceIds: allDefaultSourceGroupIds, excludedSubSourceIds: [] };
    const customSource = { id: 'custom-1', name: 'User Feed', url: 'https://example.com/user.xml', language: 'en', userId: 'user-1', isActive: true };
    let resolveParse;
    const parseStarted = new Promise((resolve) => {
      rssParser.parseFeed.mockImplementation(async (source) => {
        if (source.id !== 'custom-1') {
          return [];
        }

        resolve();
        await new Promise((parseResolve) => { resolveParse = parseResolve; });
        return [];
      });
    });
    database.listUserSources.mockReturnValue([customSource]);

    await newsAggregator.getNewsFeed({}, userContext);
    await parseStarted;

    const secondRequest = newsAggregator.getNewsFeed({}, userContext);
    await Promise.resolve();
    expect(database.getArticles).toHaveBeenCalledTimes(1);

    resolveParse();
    await secondRequest;

    expect(database.getArticles).toHaveBeenCalledTimes(2);
  });

  test('ingestAllNews stores topics and broadcasts global and private groups separately', async () => {
    database.listAllActiveUserSources.mockReturnValue([
      { id: 'custom-1', name: 'My Feed', url: 'https://example.com/custom.xml', language: 'en', userId: 'user-1', isActive: true }
    ]);
    rssParser.parseFeed
      .mockResolvedValueOnce([{ id: 'global-1', sourceId: 'ansa_mondo', source: 'ANSA - Mondo', title: 'Global economy update', pubDate: recentIso({ hoursAgo: 2 }), url: 'https://example.com/g', rawTopics: ['Economy'] }])
      .mockResolvedValueOnce([{ id: 'private-1', sourceId: 'custom-1', source: 'My Feed', title: 'Private portfolio update', pubDate: recentIso({ hoursAgo: 1, minutesAgo: 30 }), url: 'https://example.com/p', rawTopics: ['Markets'], ownerUserId: 'user-1' }]);
    database.upsertArticles.mockReturnValue({ insertedIds: ['global-1', 'private-1'], insertedCount: 2, updatedCount: 0 });
    database.getArticleIdsPendingAiTopicProcessing.mockReturnValue(['global-1', 'private-1']);

    const result = await newsAggregator.ingestAllNews({ broadcast: true });

    expect(result).toMatchObject({ success: true, fetchedCount: 2, insertedCount: 2, updatedCount: 0 });
    expect(database.cleanupRemovedConfiguredSourceData).toHaveBeenCalledTimes(1);
    expect(database.upsertArticles).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ rawSourceId: 'ansa_mondo', rawSource: 'ANSA - Mondo', sourceId: ansaSourceId, source: ansaSourceName, subSource: 'Mondo' })
    ]));
    expect(database.mergeTopicsForArticles).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ articleId: 'global-1', topics: expect.any(Array) }),
      expect.objectContaining({ articleId: 'private-1', topics: expect.any(Array) })
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
    aiTopicClassifier.classifyTopicDetailsForArticles.mockResolvedValue(new Map([
      ['inserted-1', [{ topic: 'Tecnologia', source: 'ai', confidence: 0.88, evidence: ['AI chips'], reasonCode: 'ai_confident_evidence' }]]
    ]));

    await newsAggregator.ingestAllNews({ broadcast: true });

    expect(database.mergeTopicsForArticles).toHaveBeenCalledWith([
      expect.objectContaining({ articleId: 'inserted-1', topics: expect.any(Array) })
    ]);
    expect(websocketService.broadcastNewsUpdate.mock.calls[0][0][0].topics).toEqual(['Tecnologia']);
    expect(aiTopicClassifier.classifyTopicDetailsForArticles).not.toHaveBeenCalled();

    await flushBackgroundAiProcessing();

    expect(aiTopicClassifier.classifyTopicDetailsForArticles).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'inserted-1', title: 'AI chips advance' })
    ]);
    expect(database.replaceTopicsForArticles).toHaveBeenCalledWith([
      { articleId: 'inserted-1', topics: [{ topic: 'Tecnologia', source: 'ai', confidence: 0.88, evidence: ['AI chips'], reasonCode: 'ai_confident_evidence' }] }
    ]);
    expect(websocketService.broadcastFeedRefresh).toHaveBeenCalledWith({ userIds: [], reason: 'topics' });
    expect(database.markArticlesAiTopicProcessing).toHaveBeenCalledWith(['inserted-1'], 'completed');
  });

  test('does not schedule the same pending AI article twice while processing is already in flight', async () => {
    let resolveClassification;

    database.getArticleIdsPendingAiTopicProcessing.mockReturnValue(['inserted-1']);
    aiTopicClassifier.classifyTopicDetailsForArticles.mockImplementation(() => {
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

    expect(aiTopicClassifier.classifyTopicDetailsForArticles).toHaveBeenCalledTimes(1);

    resolveClassification(new Map([
      ['inserted-1', [{ topic: 'Tecnologia', source: 'ai', confidence: 0.88, evidence: ['AI chips'], reasonCode: 'ai_confident_evidence' }]]
    ]));

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

    expect(filtered.map((article) => article.id)).toEqual(['recent-1', 'future-1']);
  });

  test('ingestAllNews keeps fallback topics when AI is unsure', async () => {
    rssParser.parseFeed.mockResolvedValue([
      { id: 'inserted-1', sourceId: 'ansa_mondo', source: 'ANSA - Mondo', title: 'Global market update', description: 'Markets rise', pubDate: recentIso({ hoursAgo: 2 }), url: 'https://example.com/markets', rawTopics: ['markets'] }
    ]);
    database.upsertArticles.mockReturnValue({ insertedIds: ['inserted-1'], insertedCount: 1, updatedCount: 0 });
    database.getArticleIdsPendingAiTopicProcessing.mockReturnValue(['inserted-1']);
    aiTopicClassifier.classifyTopicDetailsForArticles.mockResolvedValue(new Map([
      ['inserted-1', []]
    ]));

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

  test('ingestAllNews does not re-merge fallback topics for already AI-processed articles', async () => {
    rssParser.parseFeed.mockResolvedValue([
      { id: 'existing-1', sourceId: 'ansa_mondo', source: 'ANSA - Mondo', title: 'Existing story', description: 'Markets rise', pubDate: recentIso({ hoursAgo: 2 }), url: 'https://example.com/existing' }
    ]);
    database.upsertArticles.mockReturnValue({ insertedIds: [], updatedIds: ['existing-1'], insertedCount: 0, updatedCount: 1 });
    database.getArticleIdsPendingAiTopicProcessing.mockReturnValue([]);

    await newsAggregator.ingestAllNews({ broadcast: true });

    expect(database.mergeTopicsForArticles).toHaveBeenCalledWith([]);
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
    rssParser.parseFeed.mockImplementation(async (source) => {
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

    const sharedFetchCalls = rssParser.parseFeed.mock.calls.filter(([source]) => source.url === sharedUrl);
    expect(sharedFetchCalls).toHaveLength(1);
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
    }));
    expect(database.createIngestionRun).not.toHaveBeenCalled();
  });

  test('mapSettledWithConcurrency limits concurrent feed work', async () => {
    let activeCount = 0;
    let maxActiveCount = 0;

    const results = await mapSettledWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
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
