import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import NewsAggregator from './NewsAggregator';
import { fetchNews, isRequestCanceled } from '../services/api';
import useTopicRefreshSocket from '../hooks/useTopicRefreshSocket';

vi.mock('../services/api', () => ({
  fetchNews: vi.fn(),
  isRequestCanceled: vi.fn((error) => error?.code === 'ERR_CANCELED')
}));

vi.mock('../hooks/useOnClickOutside', () => ({
  useOnClickOutside: vi.fn()
}));

vi.mock('../hooks/useTopicRefreshSocket', () => ({
  default: vi.fn()
}));

vi.mock('./NewsCard', () => ({
  default: ({ group, compact }) => <div>{group.title}{compact ? ' compact' : ''}</div>
}));
vi.mock('./ReaderPanel', () => ({
  default: () => null
}));
vi.mock('./BrandMark', () => ({
  default: () => <div />
}));
vi.mock('./SettingsPanel', () => ({
  default: () => null
}));
vi.mock('./ErrorMessage', () => ({
  default: ({ error }) => <div>{error?.message || 'error'}</div>
}));

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

async function resolveDeferred(deferred, value) {
  await act(async () => {
    deferred.resolve(value);
    await deferred.promise;
  });
}

async function renderNewsAggregator(overrides = {}) {
  let view;

  await act(async () => {
    view = render(
      <NewsAggregator
        currentUser={overrides.currentUser || currentUser}
        onLogout={overrides.onLogout || jest.fn()}
        onUserUpdate={overrides.onUserUpdate || jest.fn()}
      />
    );
    await Promise.resolve();
  });

  return view;
}

function openDesktopSearch() {
  fireEvent.click(screen.getAllByRole('button', { name: 'Search' })[0]);
}

function createGroups(prefix, start, count) {
  return Array.from({ length: count }, (_, index) => {
    const number = start + index;

    return {
      id: `group-${prefix}-${number}`,
      title: `${prefix} headline ${number}`,
      items: [{ id: `article-${prefix}-${number}`, pubDate: `2026-03-14T10:${String(number).padStart(2, '0')}:00.000Z` }]
    };
  });
}

const currentUser = {
  user: { username: 'alice' },
  settings: {
    defaultLanguage: 'en',
    themeMode: 'system',
    articleRetentionHours: 24,
    recentHours: 3,
    showNewsImages: true,
    compactNewsCards: false,
    compactNewsCardsMode: 'off',
    readerPanelPosition: 'right',
    readerTextSize: 'medium',
    excludedSourceIds: [],
    excludedSubSourceIds: []
  },
  limits: {
    articleRetentionHoursMax: 24,
    recentHoursMax: 3,
    apiTokenTtlDays: 30
  },
  customSources: [],
  apiToken: null
};

describe('NewsAggregator', () => {
  let desktopMediaQuery;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    Object.defineProperty(window, 'scrollY', {
      value: 0,
      writable: true,
      configurable: true
    });
    window.scrollBy = jest.fn();
    window.scrollTo = jest.fn();
    desktopMediaQuery = {
      matches: true,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn()
    };
    window.matchMedia = jest.fn().mockImplementation(() => desktopMediaQuery);
    useTopicRefreshSocket.mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  test('keeps the latest news response when an older request resolves later', async () => {
    const firstRequest = createDeferred();
    const secondRequest = createDeferred();
    let callCount = 0;

    fetchNews.mockImplementation(() => {
      callCount += 1;

      if (callCount === 1) {
        return firstRequest.promise;
      }

      if (callCount === 2) {
        return secondRequest.promise;
      }

      return Promise.resolve({
        items: [{ id: 'new-group', title: 'New headline' }],
        meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 },
        filters: { sources: [], sourceCatalog: [], topics: [] }
      });
    });

    await renderNewsAggregator();

    openDesktopSearch();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'economy' } });

    await act(async () => {
      jest.advanceTimersByTime(350);
    });

    await resolveDeferred(secondRequest, {
      items: [{ id: 'new-group', title: 'New headline' }],
      meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 },
      filters: { sources: [], sourceCatalog: [], topics: [] }
    });

    expect(await screen.findByText('New headline')).toBeInTheDocument();

    await resolveDeferred(firstRequest, {
      items: [{ id: 'old-group', title: 'Old headline' }],
      meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 },
      filters: { sources: [], sourceCatalog: [], topics: [] }
    });

    await waitFor(() => {
      expect(screen.getByText('New headline')).toBeInTheDocument();
      expect(screen.queryByText('Old headline')).not.toBeInTheDocument();
    });
    expect(isRequestCanceled).not.toHaveBeenCalled();
  });

  test('loads cached news on open without forcing a source refresh', async () => {
    fetchNews.mockResolvedValue({
      items: [],
      meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 0 },
      filters: { sources: [], sourceCatalog: [], topics: [] }
    });

    await renderNewsAggregator();

    await waitFor(() => {
      expect(fetchNews).toHaveBeenCalledWith(expect.objectContaining({ refresh: false }));
    });

    expect(fetchNews).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
  });

  test('forces a source refresh from the top navigation refresh button', async () => {
    fetchNews.mockResolvedValue({
      items: [{ id: 'group-1', title: 'Current headline' }],
      meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 },
      filters: { sources: [], sourceCatalog: [], topics: [] }
    });

    await renderNewsAggregator();

    expect(await screen.findByText('Current headline')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => {
      expect(fetchNews).toHaveBeenLastCalledWith(expect.objectContaining({ refresh: true }));
    });
    expect(screen.getByText('You reached the end of the available results.')).toBeInTheDocument();
  });

  test('reloads cached feed silently when AI topic updates complete', async () => {
    let onTopicRefresh;

    useTopicRefreshSocket.mockImplementation(({ onTopicRefresh: handleTopicRefresh }) => {
      onTopicRefresh = handleTopicRefresh;
    });
    fetchNews
      .mockResolvedValueOnce({
        items: [{ id: 'group-1', title: 'Fallback topic headline' }],
        meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 },
        filters: { sources: [], sourceCatalog: [], topics: [] }
      })
      .mockResolvedValue({
        items: [{ id: 'group-1', title: 'AI topic headline' }],
        meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 },
        filters: { sources: [], sourceCatalog: [], topics: [] }
      });

    await renderNewsAggregator();
    await waitFor(() => {
      expect(fetchNews).toHaveBeenCalled();
    });
    const initialCallCount = fetchNews.mock.calls.length;

    await act(async () => {
      onTopicRefresh({ refresh: true, reason: 'topics' });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(fetchNews).toHaveBeenCalledTimes(initialCallCount + 1);
    });
    expect(await screen.findByText('AI topic headline')).toBeInTheDocument();
    expect(fetchNews).toHaveBeenLastCalledWith(expect.objectContaining({
      refresh: false,
      includeFilters: true
    }));
  });

  test('keeps loaded-more articles during silent AI topic reloads', async () => {
    let onTopicRefresh;

    useTopicRefreshSocket.mockImplementation(({ onTopicRefresh: handleTopicRefresh }) => {
      onTopicRefresh = handleTopicRefresh;
    });

    fetchNews.mockImplementation(({ beforeId, pageSize }) => {
      if (beforeId === 'article-initial-12') {
        return Promise.resolve({
          items: createGroups('older', 13, 1),
          meta: { page: 1, pageSize: 12, hasMore: false, nextCursor: null },
          filters: { sources: [], sourceCatalog: [], topics: [] }
        });
      }

      if (pageSize === 13) {
        return Promise.resolve({
          items: createGroups('refreshed', 1, 13),
          meta: { page: 1, pageSize: 13, hasMore: false, nextCursor: null },
          filters: { sources: [], sourceCatalog: [], topics: ['Technology'] }
        });
      }

      return Promise.resolve({
        items: createGroups('initial', 1, 12),
        meta: {
          page: 1,
          pageSize: 12,
          hasMore: true,
          nextCursor: {
            beforePubDate: '2026-03-14T10:12:00.000Z',
            beforeId: 'article-initial-12'
          }
        },
        filters: { sources: [], sourceCatalog: [], topics: [] }
      });
    });

    await renderNewsAggregator();
    expect(await screen.findByText('initial headline 12')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('older headline 13')).toBeInTheDocument();

    await act(async () => {
      onTopicRefresh({ refresh: true, reason: 'topics' });
      await Promise.resolve();
    });

    expect(await screen.findByText('refreshed headline 13')).toBeInTheDocument();
    expect(screen.queryByText('older headline 13')).not.toBeInTheDocument();
    expect(fetchNews).toHaveBeenLastCalledWith(expect.objectContaining({
      pageSize: 13,
      beforePubDate: '',
      beforeId: '',
      refresh: false,
      includeFilters: true
    }));
  });

  test('preserves the loaded article count when a topic refresh lands right after load more resolves', async () => {
    let onTopicRefresh;
    const appendRequest = createDeferred();

    useTopicRefreshSocket.mockImplementation(({ onTopicRefresh: handleTopicRefresh }) => {
      onTopicRefresh = handleTopicRefresh;
    });

    fetchNews.mockImplementation(({ beforeId, pageSize }) => {
      if (beforeId === 'article-initial-12') {
        return appendRequest.promise;
      }

      if (pageSize > 12) {
        return Promise.resolve({
          items: createGroups('refreshed', 1, 13),
          meta: { page: 1, pageSize: 13, hasMore: false, nextCursor: null },
          filters: { sources: [], sourceCatalog: [], topics: [] }
        });
      }

      return Promise.resolve({
        items: createGroups('initial', 1, 12),
        meta: {
          page: 1,
          pageSize: 12,
          hasMore: true,
          nextCursor: {
            beforePubDate: '2026-03-14T10:12:00.000Z',
            beforeId: 'article-initial-12'
          }
        },
        filters: { sources: [], sourceCatalog: [], topics: [] }
      });
    });

    await renderNewsAggregator();
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));

    await act(async () => {
      appendRequest.resolve({
        items: createGroups('older', 13, 1),
        meta: { page: 1, pageSize: 12, hasMore: false, nextCursor: null },
        filters: { sources: [], sourceCatalog: [], topics: [] }
      });
      await appendRequest.promise;
      onTopicRefresh({ refresh: true, reason: 'topics' });
      await Promise.resolve();
    });

    expect(await screen.findByText('refreshed headline 13')).toBeInTheDocument();
    expect(fetchNews.mock.calls.at(-1)?.[0]?.pageSize).toBeGreaterThan(12);
    expect(fetchNews).toHaveBeenLastCalledWith(expect.objectContaining({
      beforePubDate: '',
      beforeId: '',
      includeFilters: true
    }));
  });

  test('keeps the visible tail if a silent topic refresh only returns the first page', async () => {
    let onTopicRefresh;

    useTopicRefreshSocket.mockImplementation(({ onTopicRefresh: handleTopicRefresh }) => {
      onTopicRefresh = handleTopicRefresh;
    });

    fetchNews.mockImplementation(({ beforeId, pageSize }) => {
      if (beforeId === 'article-initial-12') {
        return Promise.resolve({
          items: createGroups('older', 13, 12),
          meta: {
            page: 1,
            pageSize: 12,
            hasMore: true,
            nextCursor: {
              beforePubDate: '2026-03-14T10:24:00.000Z',
              beforeId: 'article-older-24'
            }
          },
          filters: { sources: [], sourceCatalog: [], topics: [] }
        });
      }

      if (pageSize > 12) {
        return Promise.resolve({
          items: createGroups('refreshed', 1, 12),
          meta: {
            page: 1,
            pageSize: 12,
            hasMore: false,
            nextCursor: null
          },
          filters: { sources: [], sourceCatalog: [], topics: [] }
        });
      }

      return Promise.resolve({
        items: createGroups('initial', 1, 12),
        meta: {
          page: 1,
          pageSize: 12,
          hasMore: true,
          nextCursor: {
            beforePubDate: '2026-03-14T10:12:00.000Z',
            beforeId: 'article-initial-12'
          }
        },
        filters: { sources: [], sourceCatalog: [], topics: [] }
      });
    });

    await renderNewsAggregator();
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('older headline 24')).toBeInTheDocument();

    await act(async () => {
      onTopicRefresh({ refresh: true, reason: 'topics' });
      await Promise.resolve();
    });

    expect(await screen.findByText('refreshed headline 12')).toBeInTheDocument();
    expect(screen.getByText('older headline 24')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load more' })).toBeEnabled();
  });

  test('shows a passive pill for unseen new articles without triggering a refresh', async () => {
    let socketHandlers;

    useTopicRefreshSocket.mockImplementation((handlers) => {
      socketHandlers = handlers;
    });
    fetchNews.mockReset();
    fetchNews.mockImplementation(({ refresh }) => Promise.resolve(
      refresh
        ? {
          items: [{ id: 'group-2', title: 'Fresh headline', items: [{ id: 'article-2', pubDate: '2026-03-14T11:00:00.000Z' }] }],
          meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 },
          filters: { sources: [], sourceCatalog: [], topics: [] }
        }
        : {
          items: [{ id: 'group-1', title: 'Current headline', items: [{ id: 'article-1', pubDate: '2026-03-14T10:00:00.000Z' }] }],
          meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 },
          filters: { sources: [], sourceCatalog: [], topics: [] }
        }
    ));

    await renderNewsAggregator();

    expect(await screen.findByText('Current headline')).toBeInTheDocument();
    const initialCallCount = fetchNews.mock.calls.length;

    await act(async () => {
      socketHandlers.onNewsUpdate({ count: 2, groupIds: ['group-2', 'group-3'] });
      socketHandlers.onNewsUpdate({ count: 1, groupIds: ['group-3'] });
      await Promise.resolve();
    });

    expect(screen.getByRole('status')).toHaveTextContent('2 new articles available');
    expect(screen.queryByRole('button', { name: '2 new articles available' })).not.toBeInTheDocument();
    expect(fetchNews).toHaveBeenCalledTimes(initialCallCount);
    expect(screen.queryByText('Fresh headline')).not.toBeInTheDocument();
  });

  test.each([
    ['desktop', true, 'First headline compact'],
    ['mobile', false, 'First headline']
  ])('resolves compact card mode %s on desktop', async (mode, compactNewsCards, expectedText) => {
    fetchNews.mockResolvedValue({
      items: [{ id: 'group-1', title: 'First headline' }],
      meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 },
      filters: { sources: [], sourceCatalog: [], topics: [] }
    });

    await renderNewsAggregator({
      currentUser: {
        ...currentUser,
        settings: {
          ...currentUser.settings,
          compactNewsCards,
          compactNewsCardsMode: mode
        }
      }
    });

    expect(await screen.findByText(expectedText)).toBeInTheDocument();
    if (!compactNewsCards) {
      expect(screen.queryByText('First headline compact')).not.toBeInTheDocument();
    }
  });

  test('uses the server cursor for load more requests', async () => {
    fetchNews.mockImplementation(({ beforeId }) => {
      if (beforeId === 'article-1') {
        return Promise.resolve({
          items: [{ id: 'group-older', title: 'Older headline', items: [{ id: 'article-0', pubDate: '2026-03-14T09:00:00.000Z' }] }],
          meta: { page: 1, pageSize: 12, hasMore: false, nextCursor: null },
          filters: { sources: [], sourceCatalog: [], topics: [] }
        });
      }

      return Promise.resolve({
        items: [{ id: 'group-1', title: 'Current headline', items: [{ id: 'article-1', pubDate: '2026-03-14T10:00:00.000Z' }] }],
        meta: {
          page: 1,
          pageSize: 12,
          hasMore: true,
          nextCursor: {
            beforePubDate: '2026-03-14T10:00:00.000Z',
            beforeId: 'article-1'
          }
        },
        filters: { sources: [], sourceCatalog: [], topics: [] }
      });
    });
    await renderNewsAggregator();

    await waitFor(() => {
      expect(fetchNews).toHaveBeenCalledWith(expect.objectContaining({
        beforePubDate: '',
        beforeId: ''
      }));
    });

    expect(await screen.findByRole('button', { name: 'Load more' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() => {
      expect(fetchNews).toHaveBeenLastCalledWith(expect.objectContaining({
        beforePubDate: '2026-03-14T10:00:00.000Z',
        beforeId: 'article-1'
      }));
    });
    expect(await screen.findByText('Older headline')).toBeInTheDocument();
  });

  test('keeps newest groups when appended pages exceed the retention cap', async () => {
    fetchNews.mockImplementation(({ beforeId }) => {
      const previousPage = beforeId ? Number(beforeId.replace('article-page-','').split('-')[0]) : 0;
      const pageNumber = previousPage + 1;
      const start = ((pageNumber - 1) * 12) + 1;
      const items = createGroups(`page-${pageNumber}`, start, 12);
      const hasMore = pageNumber < 7;

      return Promise.resolve({
        items,
        meta: {
          page: 1,
          pageSize: 12,
          hasMore,
          nextCursor: hasMore ? {
            beforePubDate: `2026-03-14T10:${String(start + 11).padStart(2, '0')}:00.000Z`,
            beforeId: `article-page-${pageNumber}-${start + 11}`
          } : null
        },
        filters: { sources: [], sourceCatalog: [], topics: [] }
      });
    });

    await renderNewsAggregator();
    expect(await screen.findByText('page-1 headline 1')).toBeInTheDocument();

    for (let pageNumber = 2; pageNumber <= 6; pageNumber += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
      expect(await screen.findByText(`page-${pageNumber} headline ${pageNumber * 12}`)).toBeInTheDocument();
    }

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    });

    expect(screen.getByText('page-1 headline 1')).toBeInTheDocument();
    expect(screen.getByText('page-6 headline 72')).toBeInTheDocument();
    expect(screen.queryByText('page-7 headline 73')).not.toBeInTheDocument();
    expect(fetchNews.mock.calls.some(([params]) => params.beforeId === 'article-page-6-72')).toBe(false);
  });

  test('clears loading-more state when a list reload cancels pagination', async () => {
    const appendRequest = createDeferred();
    const reloadRequest = createDeferred();
    let callCount = 0;

    fetchNews.mockImplementation(() => {
      callCount += 1;

      if (callCount === 1) {
        return Promise.resolve({
          items: [{ id: 'group-1', title: 'Current headline', items: [{ id: 'article-1', pubDate: '2026-03-14T10:00:00.000Z' }] }],
          meta: {
            page: 1,
            pageSize: 12,
            hasMore: true,
            nextCursor: {
              beforePubDate: '2026-03-14T10:00:00.000Z',
              beforeId: 'article-1'
            }
          },
          filters: { sources: [], sourceCatalog: [], topics: [] }
        });
      }

      if (callCount === 2) {
        return appendRequest.promise;
      }

      return reloadRequest.promise;
    });

    await renderNewsAggregator();
    const loadMoreButton = await screen.findByRole('button', { name: 'Load more' });

    fireEvent.click(loadMoreButton);
    expect(await screen.findByRole('button', { name: 'Loading...' })).toBeDisabled();

    openDesktopSearch();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'economy' } });

    await act(async () => {
      jest.advanceTimersByTime(350);
    });

    await resolveDeferred(reloadRequest, {
      items: [{ id: 'group-reloaded', title: 'Reloaded headline', items: [{ id: 'article-2', pubDate: '2026-03-14T11:00:00.000Z' }] }],
      meta: {
        page: 1,
        pageSize: 12,
        hasMore: true,
        nextCursor: {
          beforePubDate: '2026-03-14T11:00:00.000Z',
          beforeId: 'article-2'
        }
      },
      filters: { sources: [], sourceCatalog: [], topics: [] }
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Load more' })).toBeEnabled();
    });
  });

  test('shows a clear-search button and clears the search field', async () => {
    fetchNews.mockResolvedValue({
      items: [],
      meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 0 },
      filters: { sources: [], sourceCatalog: [], topics: [] }
    });

    await renderNewsAggregator();

    openDesktopSearch();
    const searchInput = screen.getByRole('searchbox');
    fireEvent.change(searchInput, { target: { value: 'economy' } });

    expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));

    expect(searchInput).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
  });

  test('scrolls smoothly to the top from the back-to-top control', async () => {
    fetchNews.mockResolvedValue({
      items: [{ id: 'group-1', title: 'First headline' }],
      meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 },
      filters: { sources: [], sourceCatalog: [], topics: [] }
    });

    await renderNewsAggregator();

    const backToTopButton = screen.getByRole('button', { name: 'Back to top' });

    await act(async () => {
      Object.defineProperty(window, 'scrollY', {
        value: 360,
        writable: true,
        configurable: true
      });
      fireEvent.scroll(window);
      jest.advanceTimersByTime(16);
    });

    fireEvent.click(backToTopButton);

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });
});
