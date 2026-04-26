import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import NewsAggregator from './NewsAggregator';
import { fetchNews, isRequestCanceled } from '../services/api';
import useWebSocket from '../hooks/useWebSocket';

vi.mock('../services/api', () => ({
  fetchNews: vi.fn(),
  isRequestCanceled: vi.fn((error) => error?.code === 'ERR_CANCELED')
}));

vi.mock('../hooks/useWebSocket', () => ({
  default: vi.fn()
}));

vi.mock('../hooks/useOnClickOutside', () => ({
  useOnClickOutside: vi.fn()
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

const currentUser = {
  user: { username: 'alice' },
  settings: {
    defaultLanguage: 'en',
    themeMode: 'system',
    articleRetentionHours: 24,
    recentHours: 3,
    autoRefreshEnabled: true,
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
    useWebSocket.mockReturnValue({
      isConnected: true,
      notifications: [],
      lastNewsUpdate: null,
      newArticlesCount: 0,
      updateSubscriptionFilters: jest.fn(),
      resetNewArticlesCount: jest.fn(),
      markGroupsSeen: jest.fn(),
      removeNotification: jest.fn()
    });
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

  test('disables websocket listening when auto refresh is off', async () => {
    fetchNews.mockResolvedValue({
      items: [],
      meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 0 },
      filters: { sources: [], sourceCatalog: [], topics: [] }
    });
    useWebSocket.mockReturnValue({
      isConnected: true,
      notifications: [],
      lastNewsUpdate: null,
      newArticlesCount: 3,
      updateSubscriptionFilters: jest.fn(),
      resetNewArticlesCount: jest.fn(),
      markGroupsSeen: jest.fn(),
      removeNotification: jest.fn()
    });

    await renderNewsAggregator({
      currentUser: {
        ...currentUser,
        settings: {
          ...currentUser.settings,
          autoRefreshEnabled: false
        }
      }
    });

    await waitFor(() => {
      expect(fetchNews).toHaveBeenCalled();
    });

    expect(useWebSocket).toHaveBeenCalledWith('', expect.any(Object), false);
    expect(screen.getAllByRole('button', { name: 'Refresh' })[1]).toBeEnabled();
  });

  test('retries once for fresh feed data on open when auto refresh is off and a user refresh is pending', async () => {
    fetchNews
      .mockResolvedValueOnce({
        items: [{ id: 'group-stale', title: 'Stale headline' }],
        meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1, pendingUserRefresh: true },
        filters: { sources: [], sourceCatalog: [], topics: [] }
      })
      .mockResolvedValueOnce({
        items: [{ id: 'group-fresh', title: 'Fresh headline' }],
        meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1, pendingUserRefresh: false },
        filters: { sources: [], sourceCatalog: [], topics: [] }
      });

    await renderNewsAggregator({
      currentUser: {
        ...currentUser,
        settings: {
          ...currentUser.settings,
          autoRefreshEnabled: false
        }
      }
    });

    expect(await screen.findByText('Fresh headline')).toBeInTheDocument();
    expect(fetchNews).toHaveBeenCalledTimes(2);
  });

  test('subscribes realtime updates with source exclusions', async () => {
    const updateSubscriptionFilters = jest.fn();

    fetchNews.mockResolvedValue({
      items: [{ id: 'group-1', title: 'First headline' }],
      meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 },
      filters: { sources: [], sourceCatalog: [], topics: [] }
    });
    useWebSocket.mockReturnValue({
      isConnected: true,
      notifications: [],
      lastNewsUpdate: null,
      newArticlesCount: 0,
      updateSubscriptionFilters,
      resetNewArticlesCount: jest.fn(),
      markGroupsSeen: jest.fn(),
      removeNotification: jest.fn()
    });

    await renderNewsAggregator({
      currentUser: {
        ...currentUser,
        settings: {
          ...currentUser.settings,
          excludedSourceIds: ['ansa'],
          excludedSubSourceIds: ['ansa_world']
        }
      }
    });

    await waitFor(() => {
      expect(updateSubscriptionFilters).toHaveBeenCalledWith({
        topics: [],
        sourceIds: [],
        excludedSourceIds: ['ansa'],
        excludedSubSourceIds: ['ansa_world']
      });
    });
  });

  test('passes the compact card preference to news cards', async () => {
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
          compactNewsCards: true,
          compactNewsCardsMode: 'desktop'
        }
      }
    });

    expect(await screen.findByText('First headline compact')).toBeInTheDocument();
  });

  test('keeps standard cards when compact mode is mobile-only on desktop', async () => {
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
          compactNewsCardsMode: 'mobile'
        }
      }
    });

    expect(await screen.findByText('First headline')).toBeInTheDocument();
    expect(screen.queryByText('First headline compact')).not.toBeInTheDocument();
  });

  test('marks already visible groups as seen after loading news', async () => {
    const markGroupsSeen = jest.fn();

    fetchNews.mockResolvedValue({
      items: [
        { id: 'group-1', title: 'First headline' },
        { id: 'group-2', title: 'Second headline' }
      ],
      meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 2 },
      filters: { sources: [], sourceCatalog: [], topics: [] }
    });
    useWebSocket.mockReturnValue({
      isConnected: true,
      notifications: [],
      lastNewsUpdate: {
        timestamp: '2026-03-14T10:00:00.000Z',
        count: 1,
        groupIds: ['group-1']
      },
      newArticlesCount: 1,
      updateSubscriptionFilters: jest.fn(),
      resetNewArticlesCount: jest.fn(),
      markGroupsSeen,
      removeNotification: jest.fn()
    });

    await renderNewsAggregator();

    await waitFor(() => {
      expect(markGroupsSeen).toHaveBeenCalledWith(['group-1', 'group-2']);
    });
  });

  test('reloads the current feed when realtime requests a topic refresh', async () => {
    const websocketState = {
      isConnected: true,
      notifications: [],
      lastNewsUpdate: null,
      newArticlesCount: 0,
      updateSubscriptionFilters: jest.fn(),
      resetNewArticlesCount: jest.fn(),
      markGroupsSeen: jest.fn(),
      removeNotification: jest.fn()
    };

    fetchNews
      .mockResolvedValueOnce({
        items: [{ id: 'group-1', title: 'Fallback topic headline' }],
        meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 },
        filters: { sources: [], sourceCatalog: [], topics: [] }
      })
      .mockResolvedValueOnce({
        items: [{ id: 'group-1', title: 'AI topic headline' }],
        meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 },
        filters: { sources: [], sourceCatalog: [], topics: [] }
      });

    useWebSocket.mockImplementation(() => websocketState);

    const view = await renderNewsAggregator();

    await waitFor(() => {
      expect(fetchNews).toHaveBeenCalled();
    });
    const initialCallCount = fetchNews.mock.calls.length;

    websocketState.lastNewsUpdate = {
      timestamp: '2026-03-14T10:15:00.000Z',
      count: 1,
      refresh: true,
      reason: 'topics',
      groupIds: [],
      data: []
    };

    await act(async () => {
      view.rerender(
        <NewsAggregator
          currentUser={currentUser}
          onLogout={jest.fn()}
          onUserUpdate={jest.fn()}
        />
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(fetchNews).toHaveBeenCalledTimes(initialCallCount + 1);
    });
  });

  test('preserves scroll position when realtime topic refresh reloads the current feed', async () => {
    const websocketState = {
      isConnected: true,
      notifications: [],
      lastNewsUpdate: null,
      newArticlesCount: 0,
      updateSubscriptionFilters: jest.fn(),
      resetNewArticlesCount: jest.fn(),
      markGroupsSeen: jest.fn(),
      removeNotification: jest.fn()
    };

    fetchNews
      .mockResolvedValueOnce({
        items: [{ id: 'group-1', title: 'Existing headline' }],
        meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 },
        filters: { sources: [], sourceCatalog: [], topics: [] }
      })
      .mockResolvedValueOnce({
        items: [{ id: 'group-1', title: 'Existing headline' }],
        meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 },
        filters: { sources: [], sourceCatalog: [], topics: [] }
      });

    useWebSocket.mockImplementation(() => websocketState);
    Object.defineProperty(window, 'scrollY', {
      value: 420,
      writable: true,
      configurable: true
    });

    const view = await renderNewsAggregator();
    const initialCallCount = fetchNews.mock.calls.length;

    const existingHeadlineWrapper = (await screen.findByText('Existing headline')).parentElement;
    let measurementCount = 0;
    existingHeadlineWrapper.getBoundingClientRect = jest.fn(() => {
      const top = measurementCount++ === 0 ? 120 : 340;

      return {
        top,
        bottom: top + 80,
        left: 0,
        right: 0,
        width: 0,
        height: 80,
        x: 0,
        y: top,
        toJSON: () => ({})
      };
    });

    websocketState.lastNewsUpdate = {
      timestamp: '2026-03-14T10:18:00.000Z',
      count: 1,
      refresh: true,
      reason: 'topics',
      groupIds: [],
      data: []
    };

    await act(async () => {
      view.rerender(
        <NewsAggregator
          currentUser={currentUser}
          onLogout={jest.fn()}
          onUserUpdate={jest.fn()}
        />
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(fetchNews).toHaveBeenCalledTimes(initialCallCount + 1);
    });
    expect(window.scrollBy).toHaveBeenCalledWith(0, 220);
  });

  test('ignores live websocket groups already present in the loaded feed', async () => {
    fetchNews.mockResolvedValue({
      items: [{ id: 'group-1', title: 'Existing headline' }],
      meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 },
      filters: { sources: [], sourceCatalog: [], topics: [] }
    });

    const websocketState = {
      isConnected: true,
      notifications: [],
      lastNewsUpdate: null,
      newArticlesCount: 0,
      updateSubscriptionFilters: jest.fn(),
      resetNewArticlesCount: jest.fn(),
      markGroupsSeen: jest.fn(),
      removeNotification: jest.fn()
    };

    useWebSocket.mockImplementation(() => websocketState);

    const view = await renderNewsAggregator();

    expect(await screen.findByText('Existing headline')).toBeInTheDocument();

    websocketState.lastNewsUpdate = {
      timestamp: '2026-03-14T10:20:00.000Z',
      count: 1,
      groupIds: ['group-1'],
      data: [{ id: 'group-1', title: 'Existing headline' }]
    };

    await act(async () => {
      view.rerender(
        <NewsAggregator
          currentUser={currentUser}
          onLogout={jest.fn()}
          onUserUpdate={jest.fn()}
        />
      );
      await Promise.resolve();
    });

    expect(screen.getAllByText('Existing headline')).toHaveLength(1);
    expect(websocketState.resetNewArticlesCount).toHaveBeenCalled();
  });

  test('preserves scroll position when live auto refresh prepends new groups', async () => {
    fetchNews.mockResolvedValue({
      items: [{ id: 'group-1', title: 'Existing headline' }],
      meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 },
      filters: { sources: [], sourceCatalog: [], topics: [] }
    });

    const websocketState = {
      isConnected: true,
      notifications: [],
      lastNewsUpdate: null,
      newArticlesCount: 0,
      updateSubscriptionFilters: jest.fn(),
      resetNewArticlesCount: jest.fn(),
      markGroupsSeen: jest.fn(),
      removeNotification: jest.fn()
    };

    useWebSocket.mockImplementation(() => websocketState);
    Object.defineProperty(window, 'scrollY', {
      value: 420,
      writable: true,
      configurable: true
    });

    const view = await renderNewsAggregator();

    const existingHeadlineWrapper = (await screen.findByText('Existing headline')).parentElement;
    let measurementCount = 0;
    existingHeadlineWrapper.getBoundingClientRect = jest.fn(() => ({
      top: measurementCount++ === 0 ? 120 : 360,
      bottom: measurementCount === 1 ? 200 : 440,
      left: 0,
      right: 0,
      width: 0,
      height: 80,
      x: 0,
      y: measurementCount === 1 ? 120 : 360,
      toJSON: () => ({})
    }));

    websocketState.lastNewsUpdate = {
      timestamp: '2026-03-14T10:25:00.000Z',
      count: 1,
      groupIds: ['group-new'],
      data: [{ id: 'group-new', title: 'New headline' }]
    };

    await act(async () => {
      view.rerender(
        <NewsAggregator
          currentUser={currentUser}
          onLogout={jest.fn()}
          onUserUpdate={jest.fn()}
        />
      );
      await Promise.resolve();
    });

    expect(await screen.findByText('New headline')).toBeInTheDocument();
    expect(window.scrollBy).toHaveBeenCalledWith(0, 240);
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

  test('clears loading-more state when a list reload cancels pagination', async () => {
    const appendRequest = createDeferred();
    const reloadRequest = createDeferred();
    let callCount = 0;

    fetchNews.mockImplementation(() => {
      callCount += 1;

      if (callCount <= 2) {
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

      if (callCount === 3) {
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

  test('shows a back-to-top button after scrolling and scrolls smoothly to the top', async () => {
    fetchNews.mockResolvedValue({
      items: [{ id: 'group-1', title: 'First headline' }],
      meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 },
      filters: { sources: [], sourceCatalog: [], topics: [] }
    });

    await renderNewsAggregator();

    const backToTopButton = screen.getByRole('button', { name: 'Back to top' });
    expect(backToTopButton).toHaveClass('pointer-events-none');

    await act(async () => {
      Object.defineProperty(window, 'scrollY', {
        value: 360,
        writable: true,
        configurable: true
      });
      fireEvent.scroll(window);
      jest.advanceTimersByTime(16);
    });

    expect(backToTopButton).toHaveClass('opacity-100');

    fireEvent.click(backToTopButton);

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });
});
