jest.mock('@mozilla/readability', () => ({
  Readability: jest.fn()
}));

jest.mock('./database', () => ({
  getArticleById: jest.fn(),
  getReaderCache: jest.fn(),
  upsertReaderCache: jest.fn()
}));

jest.mock('../utils/logger', () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

jest.mock('../utils/urlSafety', () => ({
  fetchSafeTextUrl: jest.fn()
}));

const { Readability } = require('@mozilla/readability');
const database = require('./database');
const logger = require('../utils/logger');
const { fetchSafeTextUrl } = require('../utils/urlSafety');
const readerService = require('./readerService');

describe('readerService', () => {
  const article = {
    id: 'article-1',
    url: 'https://example.com/article',
    title: 'Article title',
    source: 'Example Source',
    author: 'Reporter',
    language: 'en',
    description: 'Short description',
    content: 'Fallback body paragraph.'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    readerService._clearRuntimeState();
    database.getArticleById.mockReturnValue(article);
    database.getReaderCache.mockReturnValue(null);
  });

  test('returns cached reader content when available', async () => {
    database.getReaderCache.mockReturnValue({
      url: article.url,
      title: 'Cached title',
      siteName: 'Cached Site',
      byline: 'Cached Byline',
      language: 'en',
      excerpt: 'Cached excerpt',
      contentText: 'Cached paragraph one\n\nCached paragraph two',
      contentBlocks: [
        { type: 'paragraph', text: 'Cached paragraph one' },
        { type: 'paragraph', text: 'Cached paragraph two' }
      ],
      fetchedAt: '2026-03-07T00:00:00.000Z'
    });

    const payload = await readerService.getReaderArticle(article.id, { userId: 'user-1' });

    expect(payload).toMatchObject({
      articleId: article.id,
      title: 'Cached title',
      cached: true,
      paragraphs: ['Cached paragraph one', 'Cached paragraph two']
    });
    expect(fetchSafeTextUrl).not.toHaveBeenCalled();
    expect(database.upsertReaderCache).not.toHaveBeenCalled();
  });

  test('fetches readable content and stores it in cache', async () => {
    fetchSafeTextUrl.mockResolvedValue({
      data: '<html><body><article><h1>Readable headline</h1><p>First paragraph.</p><p>Second paragraph.</p></article></body></html>'
    });
    Readability.mockImplementation(() => ({
      parse: () => ({
        title: 'Readable headline',
        siteName: 'Readable Site',
        byline: 'Readable Byline',
        lang: 'en',
        excerpt: 'Readable excerpt',
        textContent: 'First paragraph. Second paragraph.',
        content: '<h1>Readable headline</h1><p>First paragraph.</p><p>Second paragraph.</p>'
      })
    }));

    const payload = await readerService.getReaderArticle(article.id, { forceRefresh: true, userId: 'user-1' });

    expect(payload).toMatchObject({
      articleId: article.id,
      title: 'Readable headline',
      siteName: 'Readable Site',
      byline: 'Readable Byline',
      language: 'en',
      excerpt: 'Readable excerpt',
      cached: false
    });
    expect(payload.contentBlocks).toEqual([
      { type: 'heading', text: 'Readable headline', level: 1 },
      { type: 'paragraph', text: 'First paragraph.' },
      { type: 'paragraph', text: 'Second paragraph.' }
    ]);
    expect(payload.paragraphs).toEqual(['First paragraph.', 'Second paragraph.']);
    expect(database.upsertReaderCache).toHaveBeenCalledWith(article.id, expect.objectContaining({
      title: 'Readable headline',
      contentText: expect.stringContaining('First paragraph.')
    }));
  });

  test('falls back to feed content when extraction fails', async () => {
    fetchSafeTextUrl.mockRejectedValue(new Error('Network failed'));

    const payload = await readerService.getReaderArticle(article.id, { userId: 'user-1' });

    expect(payload).toMatchObject({
      articleId: article.id,
      fallback: true,
      cached: false,
      title: article.title,
      excerpt: article.description,
      paragraphs: ['Short description', 'Fallback body paragraph.']
    });
    expect(database.upsertReaderCache).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Reader mode extraction fell back'));
  });

  test('uses a short fallback cache after extraction fails', async () => {
    fetchSafeTextUrl.mockRejectedValue(new Error('Network failed'));

    const firstPayload = await readerService.getReaderArticle(article.id, { userId: 'user-1' });
    const secondPayload = await readerService.getReaderArticle(article.id, { userId: 'user-1' });

    expect(firstPayload).toMatchObject({ fallback: true, cached: false });
    expect(secondPayload).toMatchObject({ fallback: true, cached: false });
    expect(fetchSafeTextUrl).toHaveBeenCalledTimes(1);
  });

  test('prunes expired cold fallback cache entries', async () => {
    fetchSafeTextUrl.mockRejectedValue(new Error('Network failed'));

    await readerService.getReaderArticle(article.id, { userId: 'user-1' });

    expect(readerService._getFallbackCacheSize()).toBe(1);
    expect(readerService._pruneExpiredFallbackCache(Date.now() + (16 * 60 * 1000))).toBe(1);
    expect(readerService._getFallbackCacheSize()).toBe(0);
  });

  test('deduplicates concurrent extraction requests for the same article', async () => {
    let resolveFetch;
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    fetchSafeTextUrl.mockReturnValue(fetchPromise);
    Readability.mockImplementation(() => ({
      parse: () => ({
        title: 'Readable headline',
        siteName: 'Readable Site',
        byline: 'Readable Byline',
        lang: 'en',
        excerpt: 'Readable excerpt',
        textContent: 'First paragraph. Second paragraph.',
        content: '<h1>Readable headline</h1><p>First paragraph.</p><p>Second paragraph.</p>'
      })
    }));

    const firstRequest = readerService.getReaderArticle(article.id, { userId: 'user-1' });
    const secondRequest = readerService.getReaderArticle(article.id, { userId: 'user-1' });
    resolveFetch({
      data: '<html><body><article><h1>Readable headline</h1><p>First paragraph.</p><p>Second paragraph.</p></article></body></html>'
    });

    await expect(Promise.all([firstRequest, secondRequest])).resolves.toEqual([
      expect.objectContaining({ articleId: article.id, title: 'Readable headline' }),
      expect.objectContaining({ articleId: article.id, title: 'Readable headline' })
    ]);
    expect(fetchSafeTextUrl).toHaveBeenCalledTimes(1);
    expect(database.upsertReaderCache).toHaveBeenCalledTimes(1);
  });

  test('deduplicates concurrent forced refreshes for the same article', async () => {
    let resolveFetch;
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    fetchSafeTextUrl.mockReturnValue(fetchPromise);
    Readability.mockImplementation(() => ({
      parse: () => ({
        title: 'Forced readable headline',
        siteName: 'Readable Site',
        byline: 'Readable Byline',
        lang: 'en',
        excerpt: 'Readable excerpt',
        textContent: 'First paragraph. Second paragraph.',
        content: '<h1>Forced readable headline</h1><p>First paragraph.</p><p>Second paragraph.</p>'
      })
    }));

    const firstRequest = readerService.getReaderArticle(article.id, { forceRefresh: true, userId: 'user-1' });
    const secondRequest = readerService.getReaderArticle(article.id, { forceRefresh: true, userId: 'user-1' });
    resolveFetch({
      data: '<html><body><article><h1>Forced readable headline</h1><p>First paragraph.</p><p>Second paragraph.</p></article></body></html>'
    });

    await expect(Promise.all([firstRequest, secondRequest])).resolves.toEqual([
      expect.objectContaining({ articleId: article.id, title: 'Forced readable headline' }),
      expect.objectContaining({ articleId: article.id, title: 'Forced readable headline' })
    ]);
    expect(fetchSafeTextUrl).toHaveBeenCalledTimes(1);
    expect(database.upsertReaderCache).toHaveBeenCalledTimes(1);
  });

  test('rejects new extractions when one user saturates the pending queue', async () => {
    let resolveFetch;
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    fetchSafeTextUrl.mockReturnValue(fetchPromise);
    database.getArticleById.mockImplementation((articleId) => ({
      ...article,
      id: articleId,
      url: `https://example.com/${articleId}`
    }));
    Readability.mockImplementation(() => ({
      parse: () => ({
        title: 'Readable headline',
        siteName: 'Readable Site',
        byline: 'Readable Byline',
        lang: 'en',
        excerpt: 'Readable excerpt',
        textContent: 'First paragraph. Second paragraph.',
        content: '<h1>Readable headline</h1><p>First paragraph.</p><p>Second paragraph.</p>'
      })
    }));

    const pendingRequests = Array.from({ length: 20 }, (_, index) => {
      return readerService.getReaderArticle(`article-${index}`, { userId: 'user-1' });
    });

    await expect(readerService.getReaderArticle('article-overflow', { userId: 'user-1' })).rejects.toMatchObject({
      status: 429,
      code: 'READER_EXTRACTION_BUSY'
    });
    expect(readerService._getReaderExtractionStats().pending).toBe(20);

    resolveFetch({
      data: '<html><body><article><h1>Readable headline</h1><p>First paragraph.</p><p>Second paragraph.</p></article></body></html>'
    });

    await expect(Promise.all(pendingRequests)).resolves.toHaveLength(20);
  });

  test('falls back without fetching unsafe article destinations', async () => {
    fetchSafeTextUrl.mockRejectedValue(Object.assign(new Error('blocked'), {
      status: 403,
      code: 'FORBIDDEN_URL'
    }));

    const payload = await readerService.getReaderArticle(article.id, { userId: 'user-1' });

    expect(fetchSafeTextUrl).toHaveBeenCalledWith(article.url, expect.any(Object));
    expect(payload).toMatchObject({
      articleId: article.id,
      fallback: true,
      cached: false
    });
  });

  test('throws when the article is missing', async () => {
    database.getArticleById.mockReturnValue(null);

    await expect(readerService.getReaderArticle('missing-article')).rejects.toMatchObject({
      status: 404,
      code: 'RESOURCE_NOT_FOUND'
    });
  });
});
