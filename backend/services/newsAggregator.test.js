jest.mock('./rssParser', () => ({
  parseFeed: jest.fn()
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

jest.mock('./asyncProcessor', () => ({
  getTopicsForArticle: jest.fn(() => []),
  startTopicDeduction: jest.fn()
}));

jest.mock('./ollamaService', () => ({
  isAvailable: jest.fn(() => false)
}));

const newsAggregator = require('./newsAggregator');

describe('newsAggregator stable grouping', () => {
  const itemA = {
    id: 'source-a-1',
    title: 'Titolo notizia comune',
    description: 'Descrizione A',
    pubDate: '2026-03-02T10:00:00.000Z',
    source: 'Fonte A',
    url: 'https://example.com/a',
    topics: ['Politica']
  };

  const itemB = {
    id: 'source-b-1',
    title: 'Titolo notizia comune',
    description: 'Descrizione B',
    pubDate: '2026-03-02T10:05:00.000Z',
    source: 'Fonte B',
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
