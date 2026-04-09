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

  test('shows a clear-search button and clears the search field', async () => {
    fetchNews.mockResolvedValue({
      items: [],
      meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 0 },
      filters: { sources: [], sourceCatalog: [], topics: [] }
    });

    await renderNewsAggregator();

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
    });

    expect(backToTopButton).toHaveClass('opacity-100');

    fireEvent.click(backToTopButton);

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });
});
