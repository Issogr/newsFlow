jest.mock('./rssParser', () => ({
  parseFeed: jest.fn()
}));

jest.mock('./database', () => ({
  createIngestionRun: jest.fn(() => ({ id: 1 })),
  completeIngestionRun: jest.fn(),
  countArticles: jest.fn(() => 1),
  deleteArticlesOlderThan: jest.fn(() => 0),
  cleanupRemovedConfiguredSourceData: jest.fn(() => ({ removedArticles: 0, updatedSettings: 0 })),
  upsertArticles: jest.fn(() => ({ insertedIds: [], insertedCount: 0, updatedCount: 0 })),
  mergeTopicsForArticles: jest.fn(() => 0),
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

  test('groupSimilarNews merges paraphrased titles when entities, topics, and time are aligned', () => {
    const groupedItems = newsAggregator._groupSimilarNews([
      {
        id: 'ansa-1',
        title: 'Trump e Meloni a Washington, incontro sui dazi',
        description: 'Vertice tra Trump e Meloni negli Usa sui dazi commerciali.',
        pubDate: '2026-03-02T10:00:00.000Z',
        source: 'ANSA',
        sourceId: 'ansa',
        url: 'https://example.com/ansa-1',
        topics: ['Politica', 'Esteri']
      },
      {
        id: 'bbc-1',
        title: 'Dazi, Meloni vola a Washington per i colloqui con Trump',
        description: 'La premier incontra Trump a Washington per discutere i dazi.',
        pubDate: '2026-03-02T11:10:00.000Z',
        source: 'BBC',
        sourceId: 'bbc',
        url: 'https://example.com/bbc-1',
        topics: ['Politica', 'Esteri']
      }
    ]);

    expect(groupedItems).toHaveLength(1);
    expect(groupedItems[0].items).toHaveLength(2);
  });

  test('groupSimilarNews can match against later items already in a group', () => {
    const firstItem = {
      id: 'article-1',
      title: 'Trump e Meloni discutono i dazi a Washington',
      description: 'Vertice politico tra Trump e Meloni nella capitale Usa.',
      pubDate: '2026-03-02T08:00:00.000Z',
      source: 'Fonte A',
      sourceId: 'fonte-a',
      url: 'https://example.com/article-1',
      topics: ['Politica', 'Esteri']
    };
    const bridgeItem = {
      id: 'article-2',
      title: 'Washington, Meloni e Trump discutono i dazi commerciali',
      description: 'Vertice alla Casa Bianca sui dazi tra Italia e Stati Uniti.',
      pubDate: '2026-03-02T08:40:00.000Z',
      source: 'Fonte B',
      sourceId: 'fonte-b',
      url: 'https://example.com/article-2',
      topics: ['Politica', 'Esteri', 'Economia']
    };
    const laterMatch = {
      id: 'article-3',
      title: 'Usa-Italia, dazi al centro del colloquio tra Meloni e Trump',
      description: 'Trump riceve Meloni per un confronto sui dazi tra Usa e Italia.',
      pubDate: '2026-03-02T09:00:00.000Z',
      source: 'Fonte C',
      sourceId: 'fonte-c',
      url: 'https://example.com/article-3',
      topics: ['Politica', 'Esteri', 'Economia']
    };

    const groupedItems = newsAggregator._groupSimilarNews([firstItem, bridgeItem, laterMatch]);

    expect(groupedItems).toHaveLength(1);
    expect(groupedItems[0].items).toHaveLength(3);
  });

  test('calculateSimilarity rewards time proximity and shared entities', () => {
    const score = newsAggregator._calculateSimilarity(
      {
        title: 'Tesla presenta il robotaxi in California',
        description: 'Elon Musk presenta il nuovo servizio Tesla a Los Angeles.',
        pubDate: '2026-03-02T10:00:00.000Z',
        topics: ['Tecnologia']
      },
      {
        title: 'California, Elon Musk lancia il nuovo robotaxi Tesla',
        description: 'Musk presenta il robotaxi Tesla durante l evento in California.',
        pubDate: '2026-03-02T11:00:00.000Z',
        topics: ['Tecnologia']
      }
    );

    expect(score).toBeGreaterThan(0.58);
  });

  test('groupSimilarNews keeps unrelated same-topic articles separate', () => {
    const groupedItems = newsAggregator._groupSimilarNews([
      {
        id: 'article-a',
        title: 'Meloni incontra Trump a Washington sui dazi',
        description: 'Vertice Usa-Italia dedicato ai dazi commerciali.',
        pubDate: '2026-03-02T10:00:00.000Z',
        source: 'Fonte A',
        sourceId: 'fonte-a',
        url: 'https://example.com/article-a',
        topics: ['Politica', 'Esteri']
      },
      {
        id: 'article-b',
        title: 'Meloni annuncia un nuovo piano energia per l Italia',
        description: 'Il governo presenta nuove misure sul costo dell energia.',
        pubDate: '2026-03-02T10:30:00.000Z',
        source: 'Fonte B',
        sourceId: 'fonte-b',
        url: 'https://example.com/article-b',
        topics: ['Politica', 'Economia']
      }
    ]);

    expect(groupedItems).toHaveLength(2);
  });
});

describe('newsAggregator service flows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    database.countArticles.mockReturnValue(1);
    database.deleteArticlesOlderThan.mockReturnValue(0);
    database.cleanupRemovedConfiguredSourceData.mockReturnValue({ removedArticles: 0, updatedSettings: 0 });
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
      expect.objectContaining({ id: 'ansa', name: 'ANSA' }),
      expect.objectContaining({ id: 'custom-1', name: 'My Feed', language: 'en' })
    ]));
    expect(database.getArticles).toHaveBeenCalledWith(expect.objectContaining({ limit: 40, offset: 0 }), expect.objectContaining({ userId: 'user-1' }));
  });

  test('ingestAllNews stores topics and broadcasts global and private groups separately', async () => {
    database.listAllActiveUserSources.mockReturnValue([
      { id: 'custom-1', name: 'My Feed', url: 'https://example.com/custom.xml', language: 'en', userId: 'user-1', isActive: true }
    ]);
    rssParser.parseFeed
      .mockResolvedValueOnce([{ id: 'global-1', sourceId: 'ansa_mondo', source: 'ANSA - Mondo', title: 'Global economy update', pubDate: '2026-03-07T10:00:00.000Z', url: 'https://example.com/g', rawTopics: ['Economy'] }])
      .mockResolvedValueOnce([{ id: 'private-1', sourceId: 'custom-1', source: 'My Feed', title: 'Private portfolio update', pubDate: '2026-03-07T11:00:00.000Z', url: 'https://example.com/p', rawTopics: ['Markets'], ownerUserId: 'user-1' }]);
    database.upsertArticles.mockReturnValue({ insertedIds: ['global-1', 'private-1'], insertedCount: 2, updatedCount: 0 });

    const result = await newsAggregator.ingestAllNews({ broadcast: true });

    expect(result).toMatchObject({ success: true, fetchedCount: 2, insertedCount: 2, updatedCount: 0 });
    expect(database.cleanupRemovedConfiguredSourceData).toHaveBeenCalledTimes(1);
    expect(database.upsertArticles).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ rawSourceId: 'ansa_mondo', rawSource: 'ANSA - Mondo', sourceId: 'ansa', source: 'ANSA', subSource: 'Mondo' })
    ]));
    expect(database.mergeTopicsForArticles).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ articleId: 'global-1', topics: expect.any(Array) }),
      expect.objectContaining({ articleId: 'private-1', topics: expect.any(Array) })
    ]));
    expect(websocketService.broadcastNewsUpdate).toHaveBeenCalledTimes(2);
    expect(websocketService.broadcastNewsUpdate.mock.calls[0][0][0]).toMatchObject({ id: expect.stringContaining('group-'), ownerUserId: null });
    expect(websocketService.broadcastNewsUpdate.mock.calls[0][0][0].items[0]).toMatchObject({ sourceId: 'ansa', subSource: 'Mondo' });
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

  test('ingestAllNews cleans stale default-source data before fetching feeds', async () => {
    database.cleanupRemovedConfiguredSourceData.mockReturnValue({ removedArticles: 2, updatedSettings: 1 });

    await newsAggregator.ingestAllNews({ broadcast: false });

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
    rssParser.parseFeed.mockResolvedValue([{ id: 'private-1', sourceId: 'custom-2', source: 'Beta Feed', title: 'Private update', pubDate: '2026-03-07T11:00:00.000Z', url: 'https://example.com/p', rawTopics: ['Markets'], ownerUserId: 'user-1' }]);
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
});
