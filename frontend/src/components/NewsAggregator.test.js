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
jest.mock('./NotificationCenter', () => () => <div />);
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
      removeNotification: jest.fn()
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
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
});
