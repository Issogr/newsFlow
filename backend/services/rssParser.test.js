jest.mock('axios', () => ({
  get: jest.fn()
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

const rssParser = require('./rssParser');

describe('rssParser article ids', () => {
  afterAll(() => {
    rssParser.shutdown();
  });

  test('keeps the same id when the guid is stable but pubDate changes', () => {
    const source = { id: 'ansa' };
    const firstId = rssParser._buildArticleId(source, {
      guid: 'article-123',
      link: 'https://example.com/story',
      title: 'Stable story',
      pubDate: '2026-03-11T10:00:00.000Z'
    });
    const secondId = rssParser._buildArticleId(source, {
      guid: 'article-123',
      link: 'https://example.com/story',
      title: 'Stable story',
      pubDate: '2026-03-11T12:00:00.000Z'
    });

    expect(firstId).toBe(secondId);
  });

  test('keeps the same id when link and title are stable and pubDate is missing', () => {
    const source = { id: 'bbc' };
    const firstId = rssParser._buildArticleId(source, {
      link: 'https://example.com/no-date',
      title: 'No date story'
    });
    const secondId = rssParser._buildArticleId(source, {
      link: 'https://example.com/no-date',
      title: 'No date story'
    });

    expect(firstId).toBe(secondId);
  });

  test('keeps the same id when guid changes but the canonical link stays the same', () => {
    const source = { id: 'ansa' };
    const firstId = rssParser._buildArticleId(source, {
      guid: 'guid-v1',
      link: 'https://example.com/story?utm_source=rss',
      title: 'Stable story',
      pubDate: '2026-03-11T10:00:00.000Z'
    });
    const secondId = rssParser._buildArticleId(source, {
      guid: 'guid-v2',
      link: 'https://example.com/story?utm_source=homepage',
      title: 'Stable story',
      pubDate: '2026-03-11T12:00:00.000Z'
    });

    expect(firstId).toBe(secondId);
    expect(rssParser._normalizeArticleUrl('https://example.com/story?utm_source=rss')).toBe('https://example.com/story');
  });

  test('normalizes article links by removing fragments and tracking params while keeping stable query params', () => {
    expect(
      rssParser._normalizeArticleUrl('https://example.com/story/?b=2&utm_source=rss&a=1#top')
    ).toBe('https://example.com/story?a=1&b=2');
  });

  test('falls back to title and published date when guid and link are missing', () => {
    const source = { id: 'custom' };
    const firstId = rssParser._buildArticleId(source, {
      title: 'Fallback story',
      pubDate: '2026-03-11T10:00:00.000Z'
    });
    const secondId = rssParser._buildArticleId(source, {
      title: 'Fallback story',
      pubDate: '2026-03-11T10:00:00.000Z'
    });
    const thirdId = rssParser._buildArticleId(source, {
      title: 'Fallback story',
      pubDate: '2026-03-11T11:00:00.000Z'
    });

    expect(firstId).toBe(secondId);
    expect(firstId).not.toBe(thirdId);
  });

  test('keeps the same id when guid and link are missing but title and summary are stable', () => {
    const source = { id: 'custom' };
    const firstId = rssParser._buildArticleId(source, {
      title: 'Fallback story',
      description: 'A stable description for the same article',
      pubDate: '2026-03-11T10:00:00.000Z'
    });
    const secondId = rssParser._buildArticleId(source, {
      title: 'Fallback story',
      description: 'A stable description for the same article',
      pubDate: '2026-03-11T11:00:00.000Z'
    });

    expect(firstId).toBe(secondId);
  });
});
