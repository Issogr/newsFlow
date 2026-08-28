jest.mock('axios', () => ({
  get: jest.fn()
}));

jest.mock('dns', () => ({
  promises: {
    lookup: jest.fn()
  }
}));

const createMockLogger = require('../test-utils/mockLogger');

jest.mock('../utils/logger', createMockLogger);

const { Readable } = require('stream');
const axios = require('axios');
const dns = require('dns').promises;
const rssParser = require('./rssParser');
const { normalizeArticleUrl } = require('../utils/articleIdentity');
const { normalizePublicationDate } = require('../utils/publicationDate');

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
              <description>Story summary from the RSS description.</description>
              <pubDate>Fri, 01 May 2026 10:00:00 GMT</pubDate>
            </item>
          </channel>
        </rss>
      `])
    });

    const articles = await rssParser.parseFeed(
      { id: 'example', name: 'Example', url: 'https://example.com/feed' },
      { imageFallback: false, throwOnError: true }
    );

    expect(articles).toHaveLength(1);
    expect(articles[0].description).toBe('Story summary from the RSS description.');
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

  test('discovers standard RSS and Atom declarations from website HTML', async () => {
    dns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    axios.get.mockResolvedValue({
      status: 200,
      headers: {},
      data: Readable.from([`
        <html><head>
          <base href="/news/">
          <link rel="ALTERNATE" type="application/rss+xml; charset=utf-8" title="Latest news" href="feed.xml">
          <link rel="alternate" type="application/atom+xml" title="Atom" href="https://feeds.example.com/atom.xml">
          <link rel="alternate" type="application/rss+xml" title="Duplicate" href="feed.xml">
          <link rel="alternate" type="application/feed+json" href="feed.json">
          <link rel="alternate" type="application/rss+xml" href="https://user:pass@example.com/private.xml">
        </head></html>
      `])
    });

    await expect(rssParser.discoverFeedUrls('https://example.com/blog')).resolves.toEqual([
      { title: 'Latest news', url: 'https://example.com/news/feed.xml' },
      { title: 'Atom', url: 'https://feeds.example.com/atom.xml' }
    ]);
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  test('discovers feeds from website HTML larger than the RSS response limit', async () => {
    dns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    axios.get.mockResolvedValue({
      status: 200,
      headers: {},
      data: Readable.from([`<html><head>
        <link rel="alternate" type="application/rss+xml" title="Large site feed" href="/feed.xml">
      </head><body>${'x'.repeat(1048576)}</body></html>`])
    });

    await expect(rssParser.discoverFeedUrls('https://example.com')).resolves.toEqual([
      { title: 'Large site feed', url: 'https://example.com/feed.xml' }
    ]);
  });

  test('discovers feeds from a linked same-origin RSS directory', async () => {
    dns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    axios.get
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: Readable.from([`<html><head>
          <link rel="alternate" type="application/rss+xml" title="Headlines" href="/rss/headlines.xml">
        </head><body>
          <a href="/news/rss-directory">RSS feeds</a>
        </body></html>`])
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: Readable.from([`<html><body>
          <a href="/rss/world.xml">World</a>
          <a href="/rss/culture.xml">Culture</a>
        </body></html>`])
      });

    await expect(rssParser.discoverFeedUrls('https://example.com')).resolves.toEqual([
      { title: 'Headlines', url: 'https://example.com/rss/headlines.xml' },
      { title: 'World', url: 'https://example.com/rss/world.xml' },
      { title: 'Culture', url: 'https://example.com/rss/culture.xml' }
    ]);
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  test('falls back to Le Monde public feeds when its RSS directory blocks discovery', async () => {
    dns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    axios.get
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: Readable.from([`<html><head>
          <link rel="alternate" type="application/rss+xml" title="Le Monde.fr : A la une" href="/rss/une.xml">
        </head><body>
          <a href="/actualite-medias/les-flux-rss.html">Fils RSS</a>
        </body></html>`])
      })
      .mockResolvedValueOnce({
        status: 402,
        headers: {},
        data: Readable.from(['Payment Required'])
      });

    const feeds = await rssParser.discoverFeedUrls('https://www.lemonde.fr/');

    expect(feeds).toHaveLength(10);
    expect(feeds).toContainEqual({
      title: 'Le Monde - International',
      url: 'https://www.lemonde.fr/international/rss_full.xml'
    });
  });

  test('returns a direct feed and caps discovered website feeds', async () => {
    dns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    axios.get
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: Readable.from(['<rss version="2.0"><channel><title>Direct feed</title></channel></rss>'])
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: Readable.from([`<html><head>
          ${Array.from({ length: 10 }, (_, index) => `<link rel="alternate" type="application/rss+xml" href="/${'x'.repeat(2050)}-${index}">`).join('')}
          ${Array.from({ length: 12 }, (_, index) => `<link rel="alternate" type="application/rss+xml" href="/feed-${index}.xml">`).join('')}
        </head></html>`])
      });

    await expect(rssParser.discoverFeedUrls('https://example.com/direct.xml')).resolves.toEqual([
      { title: 'Direct feed', url: 'https://example.com/direct.xml' }
    ]);
    const discoveredFeeds = await rssParser.discoverFeedUrls('https://example.com');
    expect(discoveredFeeds).toHaveLength(10);
    expect(discoveredFeeds[0].url).toBe('https://example.com/feed-0.xml');
  });

  test.each([
    {
      label: 'guid is stable but pubDate changes',
      source: { id: 'ansa' },
      firstItem: { guid: 'article-123', link: 'https://example.com/story', title: 'Stable story', pubDate: '2026-03-11T10:00:00.000Z' },
      secondItem: { guid: 'article-123', link: 'https://example.com/story', title: 'Stable story', pubDate: '2026-03-11T12:00:00.000Z' }
    },
    {
      label: 'link and title are stable and pubDate is missing',
      source: { id: 'bbc' },
      firstItem: { link: 'https://example.com/no-date', title: 'No date story' },
      secondItem: { link: 'https://example.com/no-date', title: 'No date story' }
    },
    {
      label: 'guid changes but the canonical link stays the same',
      source: { id: 'ansa' },
      firstItem: { guid: 'guid-v1', link: 'https://example.com/story?utm_source=rss', title: 'Stable story', pubDate: '2026-03-11T10:00:00.000Z' },
      secondItem: { guid: 'guid-v2', link: 'https://example.com/story?utm_source=homepage', title: 'Stable story', pubDate: '2026-03-11T12:00:00.000Z' }
    },
    {
      label: 'guid and link are missing but title and date are stable',
      source: { id: 'custom' },
      firstItem: { title: 'Fallback story', pubDate: '2026-03-11T10:00:00.000Z' },
      secondItem: { title: 'Fallback story', pubDate: '2026-03-11T10:00:00.000Z' },
      differentItem: { title: 'Fallback story', pubDate: '2026-03-11T11:00:00.000Z' }
    },
    {
      label: 'guid and link are missing but title and summary are stable',
      source: { id: 'custom' },
      firstItem: { title: 'Fallback story', description: 'A stable description for the same article', pubDate: '2026-03-11T10:00:00.000Z' },
      secondItem: { title: 'Fallback story', description: 'A stable description for the same article', pubDate: '2026-03-11T11:00:00.000Z' }
    }
  ])('keeps stable article ids when $label', ({ source, firstItem, secondItem, differentItem }) => {
    const firstId = rssParser._buildArticleId(source, firstItem);
    const secondId = rssParser._buildArticleId(source, secondItem);

    expect(firstId).toBe(secondId);
    if (differentItem) {
      expect(firstId).not.toBe(rssParser._buildArticleId(source, differentItem));
    }
  });

  test('canonical link normalization removes tracking parameters before id generation', () => {
    expect(normalizeArticleUrl('https://example.com/story?utm_source=rss')).toBe('https://example.com/story');
  });

  test('normalizes article links by removing fragments and tracking params while keeping stable query params', () => {
    expect(
      normalizeArticleUrl('https://example.com/story/?b=2&utm_source=rss&a=1#top')
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

  test('skips gif images when selecting article covers', () => {
    expect(rssParser._getImageUrl({
      media: [
        { $: { url: 'https://example.com/animated.gif?size=large' } },
        { $: { url: 'https://example.com/static.jpg' } }
      ]
    })).toBe('https://example.com/static.jpg');

    expect(rssParser._extractImageFromHtml(
      '<figure><img src="/animated.gif" /><img src="/images/story.jpg" /></figure>',
      'https://www.example.com/article'
    )).toBe('https://www.example.com/images/story.jpg');
  });

  test('extracts article images from og:image metadata', () => {
    const html = '<html><head><meta property="og:image" content="/media/story.jpg" /></head></html>';

    expect(rssParser._extractImageFromArticleHtml(html, 'https://www.example.com/article')).toBe('https://www.example.com/media/story.jpg');
  });

  test('normalizes future publication dates to the current day', () => {
    expect(
      normalizePublicationDate('2030-04-01T12:45:00.000Z', '2026-03-15T14:30:00.000Z')
    ).toBe('2026-03-15T00:00:00.000Z');
  });
});
