import { vi, type MockedFunction } from 'vitest';
import {
  addUserSource, AUTH_EXPIRED_EVENT, discoverRssFeeds, fetchCurrentUser, fetchNews,
  fetchReadLaterNews, fetchReaderArticle, fetchThematicSummaries, importUserSettings,
  isRequestCanceled, loginUser, removeReadLaterArticles, saveReadLaterArticles,
  submitFeedback, updateUserSource, updateUserSettings
} from './api';

let fetchMock: MockedFunction<typeof fetch>;

beforeEach(() => {
  fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ success: true }));
});

afterEach(() => vi.restoreAllMocks());

test('uses same-origin browser requests and returns decoded JSON', async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ user: { username: 'alice' } }));
  await expect(fetchCurrentUser()).resolves.toEqual({ user: { username: 'alice' } });
  expect(fetchMock).toHaveBeenCalledWith('/api/me', expect.objectContaining({ method: 'GET', credentials: 'same-origin' }));
  await updateUserSettings({ themeMode: 'dark' });
  expect(fetchMock).toHaveBeenLastCalledWith('/api/me/settings', expect.objectContaining({
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"themeMode":"dark"}'
  }));
});

test('encodes active filters, pagination and reader ids', async () => {
  await fetchNews({
    refresh: true, search: '  economy & science  ', sourceIds: ['ansa', 'bbc'], topics: ['Economy'],
    beforePubDate: '2026-05-21T10:00:00.000Z', beforeId: 'article-10',
    excludeArticleIds: ['article-2', 'article-3'], includeFilters: false
  });
  const url = new URL(String(fetchMock.mock.calls[0][0]), 'https://news.example');
  expect(url.pathname).toBe('/api/news');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    page: '1', pageSize: '12', refresh: 'true', search: 'economy & science', sources: 'ansa,bbc',
    topics: 'Economy', beforePubDate: '2026-05-21T10:00:00.000Z', beforeId: 'article-10',
    excludeArticleIds: 'article-2,article-3'
  });
  await fetchReaderArticle('source/article 1', { refresh: true });
  expect(fetchMock.mock.lastCall?.[0]).toBe('/api/articles/source%2Farticle%201/reader?refresh=true');
});

test('preserves the request budgets and composes caller cancellation', async () => {
  const timeout = vi.spyOn(AbortSignal, 'timeout');
  const controller = new AbortController();
  const signal = controller.signal;
  await fetchCurrentUser();
  await fetchReaderArticle('article-1', { signal });
  await addUserSource({ url: 'https://example.com/feed' }, { signal });
  await updateUserSource('source-1', { name: 'Feed' }, { signal });
  await importUserSettings({ customSources: [] }, { signal });
  await discoverRssFeeds('https://example.com', { signal });
  await submitFeedback({ category: 'bug', title: 'Upload bug', description: 'Details' });
  expect(timeout.mock.calls.map(([budget]) => budget)).toEqual([15000, 30000, 45000, 45000, 45000, 45000, 60000]);
  controller.abort();
  expect(fetchMock.mock.calls.slice(1, 6).every(([, options]) => options?.signal?.aborted)).toBe(true);
});

test('lets the browser set multipart feedback boundaries', async () => {
  const attachment = new File(['image'], 'screenshot.png', { type: 'image/png' });
  await submitFeedback({ category: 'bug', title: 'Upload bug', description: 'Details', attachment });
  const [url, options] = fetchMock.mock.lastCall!;
  expect(url).toBe('/api/me/feedback');
  expect(options?.headers).toBeUndefined();
  const body = options?.body as FormData;
  expect(body.get('category')).toBe('bug');
  expect(body.get('title')).toBe('Upload bug');
  expect(body.get('description')).toBe('Details');
  expect(body.get('attachment')).toBe(attachment);
});

test('uses cached summary, RSS discovery and read-later endpoints', async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ feeds: [{ url: 'https://example.com/rss' }] }));
  await expect(discoverRssFeeds('https://example.com')).resolves.toEqual({ feeds: [{ url: 'https://example.com/rss' }] });
  expect(fetchMock).toHaveBeenLastCalledWith('/api/me/sources/discover', expect.objectContaining({ method: 'POST', body: '{"url":"https://example.com"}' }));
  await fetchReadLaterNews({ page: 2, sourceIds: ['source-a'], topics: ['Tecnologia'] });
  expect(fetchMock.mock.lastCall?.[0]).toBe('/api/read-later?page=2&pageSize=12&sources=source-a&topics=Tecnologia&includeFilters=true');
  await saveReadLaterArticles(['article-1']);
  expect(fetchMock).toHaveBeenLastCalledWith('/api/me/read-later', expect.objectContaining({ method: 'POST', body: '{"articleIds":["article-1"]}' }));
  await removeReadLaterArticles(['article-1']);
  expect(fetchMock).toHaveBeenLastCalledWith('/api/me/read-later/remove', expect.objectContaining({ method: 'POST', body: '{"articleIds":["article-1"]}' }));
  await fetchThematicSummaries();
  expect(fetchMock.mock.lastCall?.[0]).toBe('/api/thematic-summaries');
});

test('notifies auth expiry only for non-auth 401 responses, including non-JSON errors', async () => {
  const listener = vi.fn();
  window.addEventListener(AUTH_EXPIRED_EVENT, listener);
  try {
    fetchMock.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));
    await expect(fetchCurrentUser()).rejects.toMatchObject({ response: { status: 401, data: 'Unauthorized' } });
    expect(listener).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(Response.json({ error: { message: 'Invalid credentials' } }, { status: 401 }));
    await expect(loginUser({ username: 'alice', password: 'incorrect' })).rejects.toMatchObject({ response: { status: 401 } });
    expect(listener).toHaveBeenCalledTimes(1);
  } finally {
    window.removeEventListener(AUTH_EXPIRED_EVENT, listener);
  }
});

test('preserves HTTP errors and distinguishes network failures', async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Slow down' } }, { status: 429 }));
  const error = await fetchCurrentUser().catch((error: unknown) => error);
  expect(error).toMatchObject({ response: { status: 429, data: { error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Slow down' } } } });
  expect(error).not.toHaveProperty('newsFlowClientCode');
  fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  await expect(fetchCurrentUser()).rejects.toMatchObject({ newsFlowClientCode: 'network' });
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
  await expect(fetchCurrentUser()).resolves.toBe('');
});

test.each(['fetch', 'body'])('enforces the deadline during %s', async (phase) => {
  const deadline = new AbortController();
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
  fetchMock.mockImplementation(async (_url, options) => {
    const pending = new Promise<never>((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), { once: true });
    });
    return phase === 'fetch' ? pending : { text: () => pending } as unknown as Response;
  });
  const result = fetchCurrentUser();
  await Promise.resolve();
  deadline.abort(new DOMException('Timed out', 'TimeoutError'));
  const error = await result.catch((error: unknown) => error);
  expect(error).toMatchObject({ code: 'ECONNABORTED', newsFlowClientCode: 'timeout' });
  expect(isRequestCanceled(error)).toBe(false);
});

test('cancels before sending and while fetching, including custom abort reasons', async () => {
  const controller = new AbortController();
  fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
    options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), { once: true });
  }));
  const result = fetchThematicSummaries({ signal: controller.signal });
  controller.abort('user navigated away');
  const error = await result.catch((error: unknown) => error);
  expect(isRequestCanceled(error)).toBe(true);
  expect(error).toMatchObject({ code: 'ERR_CANCELED' });
  expect(error).not.toHaveProperty('newsFlowClientCode');
  fetchMock.mockClear();
  await expect(fetchThematicSummaries({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(isRequestCanceled(new Error('other'))).toBe(false);
});
