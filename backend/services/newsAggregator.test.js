jest.mock('./rssParser', () => ({
  parseFeed: jest.fn()
}));

jest.mock('./database', () => ({
  createIngestionRun: jest.fn(() => ({ id: 1 })),
  completeIngestionRun: jest.fn(),
  countArticles: jest.fn(() => 1),
  deleteArticlesOlderThan: jest.fn(() => 0),
  upsertArticles: jest.fn(() => ({ insertedIds: [], insertedCount: 0, updatedCount: 0 })),
  mergeTopicsForArticle: jest.fn(),
  getArticlesByIds: jest.fn(() => []),
  getArticles: jest.fn(() => []),
  getLatestIngestionRun: jest.fn(() => null),
  getSourceStats: jest.fn(() => []),
  getTopicStatsByFilters: jest.fn(() => []),
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
  broadcastSystemNotification: jest.fn()
}));

const rssParser = require('./rssParser');
const database = require('./database');
const websocketService = require('./websocketService');
const newsAggregator = require('./newsAggregator');

describe('newsAggregator stable grouping', () => {
  const itemA = {
    id: 'source-a-1',
    title: 'Titolo notizia comune',
    description: 'Descrizione A',
    pubDate: '2026-03-02T10:00:00.000Z',
    source: 'Fonte A',
    sourceId: 'fonte-a',
    url: 'https://example.com/a',
    topics: ['Politica']
  };

  const itemB = {
    id: 'source-b-1',
    title: 'Titolo notizia comune',
    description: 'Descrizione B',
    pubDate: '2026-03-02T10:05:00.000Z',
    source: 'Fonte B',
    sourceId: 'fonte-b',
    url: 'https://example.com/b',
    topics: ['Politica']
  };

  test('buildStableGroupId is deterministic regardless of input order', () => {
    const idFromAB = newsAggregator._buildStableGroupId([itemA, itemB]);
    const idFromBA = newsAggregator._buildStableGroupId([itemB, itemA]);

    expect(idFromAB).toBe(idFromBA);
    expect(idFromAB.startsWith('group-')).toBe(true);
  });

  test('groupSimilarNews returns stable group IDs across repeated calls', () => {
    const firstGrouping = newsAggregator._groupSimilarNews([itemA, itemB]);
    const secondGrouping = newsAggregator._groupSimilarNews([itemA, itemB]);

    expect(firstGrouping).toHaveLength(1);
    expect(secondGrouping).toHaveLength(1);
    expect(firstGrouping[0].id).toBe(secondGrouping[0].id);
  });
});

describe('newsAggregator service flows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    database.countArticles.mockReturnValue(1);
    database.deleteArticlesOlderThan.mockReturnValue(0);
    database.getArticles.mockReturnValue([]);
    database.getLatestIngestionRun.mockReturnValue(null);
    database.getSourceStats.mockReturnValue([]);
    database.getTopicStatsByFilters.mockReturnValue([]);
    database.listUserSources.mockReturnValue([]);
    database.listAllActiveUserSources.mockReturnValue([]);
    database.upsertArticles.mockReturnValue({ insertedIds: [], insertedCount: 0, updatedCount: 0 });
    rssParser.parseFeed.mockResolvedValue([]);
  });

  test('getNewsFeed paginates grouped results and includes user source catalog', async () => {
    const groupedArticleA = {
      id: 'global-1',
      sourceId: 'ansa',
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
    database.getSourceStats.mockReturnValue([{ id: 'ansa', name: 'ANSA', count: 1 }]);
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
      totalGroups: 2,
      scannedArticles: 2,
      ingestion: { id: 7, status: 'completed' }
    });
    expect(result.filters.sourceCatalog).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'custom-1', name: 'My Feed', language: 'en' })
    ]));
    expect(database.getArticles).toHaveBeenCalledWith(expect.objectContaining({ limit: 40, offset: 0 }), expect.objectContaining({ userId: 'user-1' }));
  });

  test('ingestAllNews stores topics and broadcasts global and private groups separately', async () => {
    database.listAllActiveUserSources.mockReturnValue([
      { id: 'custom-1', name: 'My Feed', url: 'https://example.com/custom.xml', language: 'en', userId: 'user-1', isActive: true }
    ]);
    rssParser.parseFeed
      .mockResolvedValueOnce([{ id: 'global-1', sourceId: 'ansa', source: 'ANSA', title: 'Global economy update', pubDate: '2026-03-07T10:00:00.000Z', url: 'https://example.com/g', rawTopics: ['Economy'] }])
      .mockResolvedValueOnce([{ id: 'private-1', sourceId: 'custom-1', source: 'My Feed', title: 'Private portfolio update', pubDate: '2026-03-07T11:00:00.000Z', url: 'https://example.com/p', rawTopics: ['Markets'], ownerUserId: 'user-1' }]);
    database.upsertArticles.mockReturnValue({ insertedIds: ['global-1', 'private-1'], insertedCount: 2, updatedCount: 0 });

    const result = await newsAggregator.ingestAllNews({ broadcast: true });

    expect(result).toMatchObject({ success: true, fetchedCount: 2, insertedCount: 2, updatedCount: 0 });
    expect(database.mergeTopicsForArticle).toHaveBeenCalledTimes(2);
    expect(websocketService.broadcastNewsUpdate).toHaveBeenCalledTimes(2);
    expect(websocketService.broadcastNewsUpdate.mock.calls[0][0][0]).toMatchObject({ id: expect.stringContaining('group-'), ownerUserId: null });
    expect(websocketService.broadcastNewsUpdate.mock.calls[1][0][0]).toMatchObject({ ownerUserId: 'user-1' });
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
});
