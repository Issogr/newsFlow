jest.mock('axios', () => ({
  get: jest.fn()
}));

jest.mock('dns', () => ({
  promises: {
    lookup: jest.fn()
  }
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

const { Readable } = require('stream');
const axios = require('axios');
const dns = require('dns').promises;
const rssParser = require('./rssParser');

describe('rssParser article ids', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    rssParser.shutdown();
  });

  test('fetches feeds with browser-like RSS request headers', async () => {
    dns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    axios.get.mockResolvedValue({
      status: 200,
      headers: {},
      data: Readable.from([`
        <rss version="2.0">
          <channel>
            <title>Example</title>
            <item>
              <title>Story</title>
              <link>https://example.com/story</link>
              <pubDate>Fri, 01 May 2026 10:00:00 GMT</pubDate>
            </item>
          </channel>
        </rss>
      `])
    });

    await expect(rssParser.parseFeed(
      { id: 'example', name: 'Example', url: 'https://example.com/feed' },
      { imageFallback: false, throwOnError: true }
    )).resolves.toHaveLength(1);

    expect(axios.get.mock.calls[0][1].headers).toMatchObject({
      'User-Agent': expect.stringContaining('Mozilla/5.0'),
      Accept: expect.stringContaining('application/rss+xml'),
      'Sec-Fetch-Mode': 'cors'
    });
    expect(axios.get.mock.calls[0][1].headers).not.toHaveProperty('Accept-Language');
  });

  test('does not retry permanent feed fetch failures', async () => {
    dns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    axios.get.mockResolvedValue({
      status: 403,
      headers: {},
      data: Readable.from(['Forbidden'])
    });

    await expect(rssParser.parseFeed(
      { id: 'forbidden', name: 'Forbidden', url: 'https://forbidden.example/feed' },
      { throwOnError: true }
    )).rejects.toMatchObject({ status: 403 });

    expect(axios.get).toHaveBeenCalledTimes(1);
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

  test('extracts an image from media arrays and lazy html fallbacks', () => {
    expect(rssParser._getImageUrl({
      media: [
        { $: { url: 'https://example.com/image-one.jpg' } },
        { $: { url: 'https://example.com/image-two.jpg' } }
      ]
    })).toBe('https://example.com/image-one.jpg');

    expect(rssParser._extractImageFromHtml(
      '<figure><img data-lazy-src="/images/story.jpg" src="/placeholder.jpg" /></figure>',
      'https://www.example.com/article'
    )).toBe('https://www.example.com/images/story.jpg');
  });

  test('extracts article images from og:image metadata', () => {
    const html = '<html><head><meta property="og:image" content="/media/story.jpg" /></head></html>';

    expect(rssParser._extractImageFromArticleHtml(html, 'https://www.example.com/article')).toBe('https://www.example.com/media/story.jpg');
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

  test('normalizes future publication dates to the current day', () => {
    expect(
      rssParser._normalizeDate('2030-04-01T12:45:00.000Z', '2026-03-15T14:30:00.000Z')
    ).toBe('2026-03-15T00:00:00.000Z');
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
