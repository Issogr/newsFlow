jest.mock('axios', () => ({
  get: jest.fn()
}));

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

const axios = require('axios');
const { Readability } = require('@mozilla/readability');
const database = require('./database');
const logger = require('../utils/logger');
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
    expect(axios.get).not.toHaveBeenCalled();
    expect(database.upsertReaderCache).not.toHaveBeenCalled();
  });

  test('fetches readable content and stores it in cache', async () => {
    axios.get.mockResolvedValue({
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
    axios.get.mockRejectedValue(new Error('Network failed'));

    const payload = await readerService.getReaderArticle(article.id, { userId: 'user-1' });

    expect(payload).toMatchObject({
      articleId: article.id,
      fallback: true,
      cached: false,
      title: article.title,
      excerpt: article.description,
      paragraphs: ['Short description', 'Fallback body paragraph.']
    });
    expect(database.upsertReaderCache).toHaveBeenCalledWith(article.id, expect.objectContaining({
      title: article.title,
      contentText: expect.stringContaining('Fallback body paragraph.')
    }));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Reader mode extraction failed'));
  });

  test('throws when the article is missing', async () => {
    database.getArticleById.mockReturnValue(null);

    await expect(readerService.getReaderArticle('missing-article')).rejects.toMatchObject({
      status: 404,
      code: 'RESOURCE_NOT_FOUND'
    });
  });
});
