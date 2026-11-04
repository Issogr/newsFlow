import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import configuredSources from '../config/newsSources';
import type { NewsArticle } from '../utils/types';

let database: typeof import('./database').default;
let query: typeof import('./newsAggregatorQuery').default;
let ingestion: typeof import('./newsAggregatorIngestion').default;
let grouper: typeof import('./aiStoryGrouper').default;

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('NEWS_DB_PATH', ':memory:');
  vi.stubEnv('AI_STORY_GROUPING_CONCURRENCY', '1');
  vi.doMock('./aiStoryGrouper', async () => {
    const { default: actual } = await vi.importActual<typeof import('./aiStoryGrouper')>('./aiStoryGrouper');
    return { default: {
      ...actual,
      isAiStoryGroupingAvailable: vi.fn(() => true),
      findSimilarStoriesForArticle: vi.fn(async () => ({ matches: [], model: 'test-model', candidates: [] }))
    } };
  });
  database = (await import('./database')).default;
  query = (await import('./newsAggregatorQuery')).default;
  ingestion = (await import('./newsAggregatorIngestion')).default;
  grouper = (await import('./aiStoryGrouper')).default;
});

afterEach(() => {
  ingestion._resetRuntimeStateForTests();
  database.closeDb();
  vi.unstubAllEnvs();
});

function article(id: string, overrides: Partial<NewsArticle> = {}): NewsArticle {
  return {
    id, title: `Report ${id}`, sourceId: configuredSources[0].id, source: configuredSources[0].name,
    description: '', content: '', topics: [],
    url: `https://example.com/${id}`, pubDate: new Date(Date.now() - 60_000).toISOString(),
    ...overrides
  };
}

test.each([1, 12])('paginates equal-date story groups without omissions at page size %i', async (pageSize) => {
  const pubDate = new Date(Date.now() - 60_000).toISOString();
  const articles = [...'ABCDEFGHIJKLMNOPQRaz'].map((id, index) => article(id, {
    title: `Distinct report number${index}`, pubDate
  }));
  articles.push(article('older-copy', {
    title: articles[0].title, sourceId: configuredSources[1].id, source: configuredSources[1].name,
    pubDate: new Date(Date.parse(pubDate) - 60_000).toISOString()
  }));
  database.upsertArticles(articles);

  let cursor = {};
  let hasMore = true;
  const seen: string[] = [];
  for (let page = 0; hasMore && page < articles.length; page += 1) {
    const response = await query.getNewsFeed({ ...cursor, pageSize, includeFilters: false });
    seen.push(...response.items.flatMap((group) => group.items.map((item) => item.id)));
    hasMore = response.meta.hasMore;
    if (hasMore) {
      expect(response.meta.nextCursor).not.toBeNull();
      cursor = response.meta.nextCursor!;
    }
  }

  expect(hasMore).toBe(false);
  expect(seen.sort()).toEqual(articles.map((item) => item.id).sort());
});

test('persists private AI grouping without joining another owner or public articles', async () => {
  const now = new Date().toISOString();
  for (const id of ['owner', 'other']) {
    database.createUser({ id, username: id, createdAt: now, updatedAt: now });
  }
  const target = article('private-target', { ownerUserId: 'owner' });
  const candidate = article('private-match', { ownerUserId: 'owner' });
  database.upsertArticles([target, candidate, article('other-private', { ownerUserId: 'other' }), article('public')]);
  vi.mocked(grouper.findSimilarStoriesForArticle).mockResolvedValue({
    matches: [{ articleId: candidate.id, confidence: 0.99, reason: 'Same event' }], model: 'test-model', candidates: [candidate]
  });

  ingestion.scheduleAiStoryGroupingForPendingArticles([target]);

  await vi.waitFor(() => {
    expect(database.getArticleById(target.id, { userId: 'owner' })?.aiStoryGroupStatus).toBe('matched');
  });
  const groupId = database.getArticleById(target.id, { userId: 'owner' })?.storyGroupId;
  expect(database.getArticleById(candidate.id, { userId: 'owner' })?.storyGroupId).toBe(groupId);
  expect(database.getArticleById('other-private', { userId: 'other' })?.storyGroupId).toBeNull();
  expect(database.getArticleById('public')?.storyGroupId).toBeNull();
  expect(grouper.findSimilarStoriesForArticle).toHaveBeenCalledWith(
    expect.objectContaining({ id: target.id }), [expect.objectContaining({ id: candidate.id })]
  );
});

test('shares the story-grouping concurrency limit across overlapping ingestions', async () => {
  const articles = [article('first'), article('second')];
  database.upsertArticles(articles);
  const first = Promise.withResolvers<Awaited<ReturnType<typeof grouper.findSimilarStoriesForArticle>>>();
  const second = Promise.withResolvers<Awaited<ReturnType<typeof grouper.findSimilarStoriesForArticle>>>();
  const result = { matches: [], model: 'test-model', candidates: [] };
  vi.mocked(grouper.findSimilarStoriesForArticle)
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);

  try {
    ingestion.scheduleAiStoryGroupingForPendingArticles([articles[0]], { retryAnchorArticleIds: [] });
    ingestion.scheduleAiStoryGroupingForPendingArticles([articles[1]], { retryAnchorArticleIds: [] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(grouper.findSimilarStoriesForArticle).toHaveBeenCalledTimes(1);
    first.resolve(result);
    await vi.waitFor(() => expect(grouper.findSimilarStoriesForArticle).toHaveBeenCalledTimes(2));
  } finally {
    first.resolve(result);
    second.resolve(result);
    await vi.waitFor(() => {
      expect(articles.map((item) => database.getArticleById(item.id)?.aiStoryGroupStatus)).toEqual(['no_match', 'no_match']);
    });
  }
});

test.each(['target', 'candidate'])('retries grouping against corrected %s evidence instead of publishing an old match', async (changed) => {
  const target = article('target');
  const candidate = article('candidate');
  database.upsertArticles([target, candidate]);
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof grouper.findSimilarStoriesForArticle>>>();
  vi.mocked(grouper.findSimilarStoriesForArticle).mockReturnValueOnce(pending.promise);
  ingestion.scheduleAiStoryGroupingForPendingArticles([target], { retryAnchorArticleIds: [] });
  await vi.waitFor(() => expect(grouper.findSimilarStoriesForArticle).toHaveBeenCalledTimes(1));
  database.upsertArticles([{ ...(changed === 'target' ? target : candidate), title: 'Corrected unrelated event' }]);
  pending.resolve({ matches: [{ articleId: candidate.id, confidence: 0.99, reason: 'Old evidence' }], model: 'test-model', candidates: [candidate] });
  await vi.waitFor(() => expect(grouper.findSimilarStoriesForArticle).toHaveBeenCalledTimes(2));
  await vi.waitFor(() => expect(database.getArticleById(target.id)?.aiStoryGroupStatus).toBe('no_match'));
  expect(database.getArticleById(target.id)?.storyGroupId).toBeNull();
  expect(database.getArticleById(candidate.id)?.storyGroupId).toBeNull();
});

test('returns complete long-running stories exactly once across cursors and preserves source scope', async () => {
  const now = Date.now();
  const articles = Array.from({ length: 351 }, (_, index) => article(`item-${String(index).padStart(3, '0')}`, {
    pubDate: new Date(now - (index * 60_000) - 1000).toISOString()
  }));
  articles.push(article('old-member', { pubDate: new Date(now - 18 * 3600_000).toISOString() }));
  database.upsertArticles(articles);
  database.assignArticlesToStoryGroup([articles[0].id, 'old-member'], 'long-story', 'test', []);
  let cursor = {};
  const seen: string[] = [];
  let response;
  do {
    response = await query.getNewsFeed({ ...cursor, pageSize: 30, includeFilters: false });
    if (!seen.length) expect(response.items[0].items.map((item) => item.id)).toEqual([articles[0].id, 'old-member']);
    seen.push(...response.items.flatMap((group) => group.items.map((item) => item.id)));
    cursor = response.meta.nextCursor || {};
  } while (response.meta.hasMore && seen.length <= articles.length);
  expect(seen.sort()).toEqual(articles.map((item) => item.id).sort());
});

test('saved cursors survive removal and reach beyond 240 groups', async () => {
  const now = new Date().toISOString();
  database.createUser({ id: 'reader', username: 'reader', createdAt: now, updatedAt: now });
  const articles = Array.from({ length: 301 }, (_, index) => article(`saved-${String(index).padStart(3, '0')}`));
  database.upsertArticles(articles);
  database.saveReadLaterArticles('reader', articles.map((item) => item.id));
  const context = { userId: 'reader' };
  let response = await query.getReadLaterFeed({ pageSize: 12, includeFilters: false }, context);
  const seen = response.items.flatMap((group) => group.items.map((item) => item.id));
  // Removing the last returned card must not invalidate the saved position.
  database.removeReadLaterArticles('reader', [seen[seen.length - 1]]);
  while (response.meta.hasMore && seen.length <= articles.length) {
    response = await query.getReadLaterFeed({ ...response.meta.nextCursor, pageSize: 12, includeFilters: false }, context);
    seen.push(...response.items.flatMap((group) => group.items.map((item) => item.id)));
  }
  expect(response.meta.hasMore).toBe(false);
  expect(seen.sort()).toEqual(articles.map((item) => item.id).sort());
});

test('read-later writes reject oversized batches without saving only part', async () => {
  const news = (await import('./newsAggregator')).default;
  const now = new Date().toISOString();
  database.createUser({ id: 'reader', username: 'reader', createdAt: now, updatedAt: now });
  const articles = Array.from({ length: 21 }, (_, index) => article(`member-${index}`));
  database.upsertArticles(articles);
  const ids = articles.map((item) => item.id);
  expect(() => news.saveReadLaterArticles({ userId: 'reader' }, ids)).toThrow('at most 20');
  expect(database.getReadLaterArticleIdSet('reader', ids).size).toBe(0);
  for (let index = 0; index < ids.length; index += 20) news.saveReadLaterArticles({ userId: 'reader' }, ids.slice(index, index + 20));
  expect(database.getReadLaterArticleIdSet('reader', ids).size).toBe(21);
  for (let index = 0; index < ids.length; index += 20) news.removeReadLaterArticles({ userId: 'reader' }, ids.slice(index, index + 20));
  expect(database.getReadLaterArticleIdSet('reader', ids).size).toBe(0);
});
