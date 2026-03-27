import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import NewsAggregator from './NewsAggregator';
import { fetchNews, isRequestCanceled } from '../services/api';
import useWebSocket from '../hooks/useWebSocket';

jest.mock('../services/api', () => ({
  fetchNews: jest.fn(),
  isRequestCanceled: jest.fn((error) => error?.code === 'ERR_CANCELED')
}));

jest.mock('../hooks/useWebSocket');

jest.mock('../hooks/useOnClickOutside', () => ({
  useOnClickOutside: jest.fn()
}));

jest.mock('./NewsCard', () => ({ group }) => <div>{group.title}</div>);
jest.mock('./ReaderPanel', () => () => null);
jest.mock('./BrandMark', () => () => <div />);
jest.mock('./SettingsPanel', () => () => null);
jest.mock('./ErrorMessage', () => ({ error }) => <div>{error?.message || 'error'}</div>);

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

const currentUser = {
  user: { username: 'alice' },
  settings: {
    defaultLanguage: 'en',
    articleRetentionHours: 24,
    recentHours: 3,
    autoRefreshEnabled: true,
    showNewsImages: true,
    readerPanelPosition: 'right',
    excludedSourceIds: [],
    excludedSubSourceIds: []
  },
  limits: {
    articleRetentionHoursMax: 24,
    recentHoursMax: 3
  },
  customSources: []
};

describe('NewsAggregator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
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

    render(
      <NewsAggregator
        currentUser={currentUser}
        onLogout={jest.fn()}
        onUserUpdate={jest.fn()}
      />
    );

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

  test('keeps websocket listening and shows the refresh badge when auto refresh is off', async () => {
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

    await act(async () => {
      render(
        <NewsAggregator
          currentUser={{
            ...currentUser,
            settings: {
              ...currentUser.settings,
              autoRefreshEnabled: false
            }
          }}
          onLogout={jest.fn()}
          onUserUpdate={jest.fn()}
        />
      );
    });

    await waitFor(() => {
      expect(fetchNews).toHaveBeenCalled();
    });

    expect(useWebSocket).toHaveBeenCalledWith('', expect.any(Object), true);
    expect(screen.getByRole('button', { name: 'Refresh, 3 new groups available' })).toBeEnabled();
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

    await act(async () => {
      render(
        <NewsAggregator
          currentUser={{
            ...currentUser,
            settings: {
              ...currentUser.settings,
              excludedSourceIds: ['ansa'],
              excludedSubSourceIds: ['ansa_world']
            }
          }}
          onLogout={jest.fn()}
          onUserUpdate={jest.fn()}
        />
      );
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

    await act(async () => {
      render(
        <NewsAggregator
          currentUser={currentUser}
          onLogout={jest.fn()}
          onUserUpdate={jest.fn()}
        />
      );
    });

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
    render(
      <NewsAggregator
        currentUser={currentUser}
        onLogout={jest.fn()}
        onUserUpdate={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(fetchNews).toHaveBeenCalledWith(expect.objectContaining({
        beforePubDate: '',
        beforeId: ''
      }));
    });

    expect(await screen.findByRole('button', { name: 'Load more groups' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load more groups' }));

    await waitFor(() => {
      expect(fetchNews).toHaveBeenLastCalledWith(expect.objectContaining({
        beforePubDate: '2026-03-14T10:00:00.000Z',
        beforeId: 'article-1'
      }));
    });
    expect(await screen.findByText('Older headline')).toBeInTheDocument();
  });
});
