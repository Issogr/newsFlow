import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import NewsAggregator from './NewsAggregator';
import { fetchNews, fetchReadLaterNews, fetchThematicSummaries, isRequestCanceled, updateUserSettings } from '../services/api';
import useTopicRefreshSocket from '../hooks/useTopicRefreshSocket';
import { createDeferred, resolveDeferred } from '../test-utils/deferred';

vi.mock('../services/api', () => ({
  fetchNews: vi.fn(),
  fetchReadLaterNews: vi.fn(),
  fetchThematicSummaries: vi.fn(),
  saveReadLaterArticles: vi.fn(),
  removeReadLaterArticles: vi.fn(),
  updateUserSettings: vi.fn(),
  isRequestCanceled: vi.fn((error) => error?.code === 'ERR_CANCELED')
}));

vi.mock('../hooks/useOnClickOutside', () => ({
  useOnClickOutside: vi.fn()
}));

vi.mock('../hooks/useTopicRefreshSocket', () => ({
  default: vi.fn()
}));

vi.mock('./NewsCard', () => {
  const getRenderedTopicSummary = (group = {}) => {
    const topicEntries = [
      ...(group.topicDetails || []).map((entry) => `${entry.topic}:${entry.source || ''}`),
      ...(group.topics || []).map((topic) => `${topic}:`),
      ...(group.items || []).flatMap((item) => [
        ...(item.topicDetails || []).map((entry) => `${entry.topic}:${entry.source || ''}`),
        ...(item.topics || []).map((topic) => `${topic}:`)
      ])
    ];

    return topicEntries.join('|');
  };

  return {
    default: ({ group, onOpenReader }) => (
      <div>
        <div>{group.title}</div>
        <div data-testid={`topics-${group.id}`}>{getRenderedTopicSummary(group)}</div>
        <button type="button" onClick={() => onOpenReader(group, group.items?.[0]?.id)}>
          Open reader {group.id}
        </button>
      </div>
    )
  };
});
vi.mock('./ReaderPanel', () => ({
  default: ({ group }) => <div data-testid="reader-item-count">{group.items?.length || 0}</div>
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

function createRetitledGroups(idPrefix, titlePrefix, start, count) {
  return createGroups(idPrefix, start, count).map((group, index) => {
    const number = start + index;
    const title = `${titlePrefix} headline ${number}`;

    return {
      ...group,
      title,
      items: group.items.map((item) => ({
        ...item,
        title
      }))
    };
  });
}

function createGroup(id, title, pubDate = '2026-03-14T10:00:00.000Z') {
  return {
    id,
    title,
    items: [{ id: `article-${id}`, title, pubDate }]
  };
}

const currentUser = {
  user: { username: 'alice' },
  settings: {
    defaultLanguage: 'en',
    themeMode: 'system',
    articleRetentionHours: 24,
    recentHours: 3,
    showNewsImages: true,
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
    window.localStorage.clear();
    desktopMediaQuery = {
      matches: true,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn()
    };
    window.matchMedia = jest.fn().mockImplementation(() => desktopMediaQuery);
    fetchThematicSummaries.mockResolvedValue({ items: [] });
    useTopicRefreshSocket.mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  test('ignores main-feed refresh socket events while viewing read later', async () => {
    let onTopicRefresh;
    useTopicRefreshSocket.mockImplementation(({ onTopicRefresh: handleTopicRefresh }) => {
      onTopicRefresh = handleTopicRefresh;
    });
    fetchNews.mockResolvedValue({
      items: [createGroup('news', 'News headline')],
      meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 },
      filters: { sources: [], sourceCatalog: [], topics: [] }
    });
    fetchReadLaterNews.mockResolvedValue({
      items: [createGroup('saved', 'Saved headline')],
      meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 },
      filters: { sources: [], sourceCatalog: [], topics: [] }
    });

    await renderNewsAggregator();
    fireEvent.click(screen.getAllByRole('button', { name: 'Read later' })[0]);
    await waitFor(() => expect(fetchReadLaterNews).toHaveBeenCalled());
    fetchNews.mockClear();
    fetchReadLaterNews.mockClear();

    await act(async () => {
      onTopicRefresh({ refresh: true, reason: 'news' });
      await Promise.resolve();
    });

    expect(fetchNews).not.toHaveBeenCalled();
    expect(fetchReadLaterNews).not.toHaveBeenCalled();
  });

  test('keeps an open reader synchronized with refreshed feed groups', async () => {
    let onTopicRefresh;
    const initialGroup = createGroup('group-1', 'Current headline');
    const refreshedGroup = {
      ...initialGroup,
      items: [
        ...initialGroup.items,
        { id: 'article-group-1-extra', title: 'Extra source', pubDate: '2026-03-14T10:01:00.000Z' }
      ]
    };
    useTopicRefreshSocket.mockImplementation(({ onTopicRefresh: handleTopicRefresh }) => {
      onTopicRefresh = handleTopicRefresh;
    });
    fetchNews
      .mockResolvedValueOnce({
        items: [initialGroup],
        meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 },
        filters: { sources: [], sourceCatalog: [], topics: [] }
      })
      .mockResolvedValueOnce({
        items: [refreshedGroup],
        meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 }
      });

    await renderNewsAggregator();
    expect(await screen.findByText('Current headline')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open reader group-1' }));
    expect(screen.getByTestId('reader-item-count')).toHaveTextContent('1');

    await act(async () => {
      onTopicRefresh({ refresh: true, reason: 'topics' });
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByTestId('reader-item-count')).toHaveTextContent('2'));
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
        items: [createGroup('new-group', 'New headline')],
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
      items: [createGroup('new-group', 'New headline')],
      meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 },
      filters: { sources: [], sourceCatalog: [], topics: [] }
    });

    expect(await screen.findByText('New headline')).toBeInTheDocument();

    await resolveDeferred(firstRequest, {
      items: [createGroup('old-group', 'Old headline')],
      meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 },
      filters: { sources: [], sourceCatalog: [], topics: [] }
    });

    await waitFor(() => {
      expect(screen.getByText('New headline')).toBeInTheDocument();
      expect(screen.queryByText('Old headline')).not.toBeInTheDocument();
    });
    expect(isRequestCanceled).not.toHaveBeenCalled();
  });

  test('renders thematic summary stories and opens the summary panel', async () => {
    fetchNews.mockResolvedValue({
      items: [createGroup('group-1', 'Top headline')],
      meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 },
      filters: { sources: [], sourceCatalog: [], topics: [] }
    });
    fetchThematicSummaries.mockResolvedValue({
      items: [
        {
          id: 'summary-technology',
          topicKey: 'technology',
          topicLabel: 'Technology',
          topics: ['Tecnologia'],
          periodStart: '2026-05-21T07:00:00.000Z',
          periodEnd: '2026-05-21T13:00:00.000Z',
          summaryText: 'AI chips moved quickly during the window [1].',
          summaryTextByLocale: {
            en: 'AI chips moved quickly during the window [1].',
            it: 'I chip AI sono avanzati rapidamente nella finestra [1].'
          },
          articleCount: 1,
          sources: [{ index: 1, articleId: 'article-1', title: 'AI chips accelerate', source: 'BBC', sourceIconUrl: 'https://example.com/favicon.ico', url: 'https://example.com/ai' }]
        }
      ]
    });

    await renderNewsAggregator({
      currentUser: {
        ...currentUser,
        settings: {
          ...currentUser.settings,
          defaultLanguage: 'it'
        }
      }
    });

    const storyButton = await screen.findByRole('button', { name: 'Apri sintesi Tecnologia' });
    expect(screen.queryByText('Storie per topic')).not.toBeInTheDocument();
    expect(screen.queryByText('Tecnologia')).not.toBeInTheDocument();

    fireEvent.click(storyButton);

    expect(screen.getByText('Ora di pranzo')).toBeInTheDocument();
    expect(screen.getByText('1 articolo valutato')).toBeInTheDocument();
    expect(screen.queryByText('I chip AI sono avanzati rapidamente nella finestra [1].')).not.toBeInTheDocument();
    expect(screen.getAllByText('BBC')).not.toHaveLength(0);
    expect(screen.queryByText('AI chips accelerate')).not.toBeInTheDocument();
  });

  test('refreshes thematic stories when summary socket refresh arrives', async () => {
    let onSummariesRefresh;

    useTopicRefreshSocket.mockImplementation(({ onSummariesRefresh: handleSummariesRefresh }) => {
      onSummariesRefresh = handleSummariesRefresh;
    });
    fetchNews.mockResolvedValue({
      items: [createGroup('group-1', 'Top headline')],
      meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 },
      filters: { sources: [], sourceCatalog: [], topics: [] }
    });
    fetchThematicSummaries
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({
        items: [
          {
            id: 'summary-science',
            topicKey: 'science',
            topicLabel: 'Science',
            topics: ['Scienza'],
            periodStart: '2026-05-21T07:00:00.000Z',
            periodEnd: '2026-05-21T13:00:00.000Z',
            summaryTextByLocale: { en: 'Science update [1].', it: 'Aggiornamento scienza [1].' },
            sources: []
          }
        ]
      });

    await renderNewsAggregator();
    expect(screen.queryByRole('button', { name: 'Open Science summary' })).not.toBeInTheDocument();

    await act(async () => {
      await onSummariesRefresh({ refresh: true, reason: 'summaries' });
    });

    expect(await screen.findByRole('button', { name: 'Open Science summary' })).toBeInTheDocument();
  });

  test('updates the open summary panel when refreshed summary data arrives', async () => {
    let onSummariesRefresh;

    useTopicRefreshSocket.mockImplementation(({ onSummariesRefresh: handleSummariesRefresh }) => {
      onSummariesRefresh = handleSummariesRefresh;
    });
    fetchNews.mockResolvedValue({
      items: [createGroup('group-1', 'Top headline')],
      meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 },
      filters: { sources: [], sourceCatalog: [], topics: [] }
    });
    fetchThematicSummaries
      .mockResolvedValueOnce({
        items: [
          {
            id: 'summary-technology',
            topicKey: 'technology',
            topicLabel: 'Technology',
            topics: ['Technology'],
            periodStart: '2026-05-21T07:00:00.000Z',
            periodEnd: '2026-05-21T13:00:00.000Z',
            summaryTextByLocale: { en: 'First technology update [1].', it: 'Primo aggiornamento tecnologia [1].' },
            articleCount: 1,
            sources: []
          }
        ]
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: 'summary-technology',
            topicKey: 'technology',
            topicLabel: 'Technology',
            topics: ['Technology'],
            periodStart: '2026-05-21T07:00:00.000Z',
            periodEnd: '2026-05-21T13:00:00.000Z',
            summaryTextByLocale: { en: 'Updated technology update [1].', it: 'Aggiornamento tecnologia aggiornato [1].' },
            articleCount: 2,
            sources: []
          }
        ]
      });

    await renderNewsAggregator();
    fireEvent.click(await screen.findByRole('button', { name: 'Open Technology summary' }));

    expect(screen.getByText('1 article evaluated')).toBeInTheDocument();

    await act(async () => {
      await onSummariesRefresh({ refresh: true, reason: 'summaries' });
    });

    expect(await screen.findByText('2 articles evaluated')).toBeInTheDocument();
    expect(screen.queryByText('1 article evaluated')).not.toBeInTheDocument();
  });

  test('closes an open summary panel when refreshed summaries no longer include it', async () => {
    let onSummariesRefresh;

    useTopicRefreshSocket.mockImplementation(({ onSummariesRefresh: handleSummariesRefresh }) => {
      onSummariesRefresh = handleSummariesRefresh;
    });
    fetchNews.mockResolvedValue({
      items: [createGroup('group-1', 'Top headline')],
      meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 },
      filters: { sources: [], sourceCatalog: [], topics: [] }
    });
    fetchThematicSummaries
      .mockResolvedValueOnce({
        items: [
          {
            id: 'summary-technology',
            topicKey: 'technology',
            topicLabel: 'Technology',
            topics: ['Technology'],
            periodStart: '2026-05-21T07:00:00.000Z',
            periodEnd: '2026-05-21T13:00:00.000Z',
            summaryTextByLocale: { en: 'Technology update [1].', it: 'Aggiornamento tecnologia [1].' },
            articleCount: 1,
            sources: []
          }
        ]
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: 'summary-science',
            topicKey: 'science',
            topicLabel: 'Science',
            topics: ['Science'],
            periodStart: '2026-05-21T07:00:00.000Z',
            periodEnd: '2026-05-21T13:00:00.000Z',
            summaryTextByLocale: { en: 'Science update [1].', it: 'Aggiornamento scienza [1].' },
            articleCount: 1,
            sources: []
          }
        ]
      });

    await renderNewsAggregator();
    fireEvent.click(await screen.findByRole('button', { name: 'Open Technology summary' }));
    expect(screen.getByText('1 article evaluated')).toBeInTheDocument();

    await act(async () => {
      await onSummariesRefresh({ refresh: true, reason: 'summaries' });
    });

    expect(await screen.findByRole('button', { name: 'Open Science summary' })).toBeInTheDocument();
    expect(screen.queryByText('1 article evaluated')).not.toBeInTheDocument();
  });

  test('ignores stale thematic summary responses after a newer refresh', async () => {
    let onSummariesRefresh;
    const firstSummariesRequest = createDeferred();
    const secondSummariesRequest = createDeferred();

    useTopicRefreshSocket.mockImplementation(({ onSummariesRefresh: handleSummariesRefresh }) => {
      onSummariesRefresh = handleSummariesRefresh;
    });
    fetchNews.mockResolvedValue({
      items: [createGroup('group-1', 'Top headline')],
      meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 },
      filters: { sources: [], sourceCatalog: [], topics: [] }
    });
    fetchThematicSummaries
      .mockImplementationOnce(() => firstSummariesRequest.promise)
      .mockImplementationOnce(() => secondSummariesRequest.promise);

    await renderNewsAggregator();

    const refreshPromise = act(async () => {
      await onSummariesRefresh({ refresh: true, reason: 'summaries' });
    });
    await resolveDeferred(secondSummariesRequest, {
      items: [
        {
          id: 'summary-science',
          topicKey: 'science',
          topicLabel: 'Science',
          topics: ['Scienza'],
          periodStart: '2026-05-21T07:00:00.000Z',
          periodEnd: '2026-05-21T13:00:00.000Z',
          summaryTextByLocale: { en: 'Science update [1].', it: 'Aggiornamento scienza [1].' },
          sources: []
        }
      ]
    });
    await refreshPromise;

    expect(await screen.findByRole('button', { name: 'Open Science summary' })).toBeInTheDocument();

    await resolveDeferred(firstSummariesRequest, {
      items: [
        {
          id: 'summary-technology',
          topicKey: 'technology',
          topicLabel: 'Technology',
          topics: ['Tecnologia'],
          periodStart: '2026-05-21T07:00:00.000Z',
          periodEnd: '2026-05-21T13:00:00.000Z',
          summaryTextByLocale: { en: 'Technology update [1].', it: 'Aggiornamento tecnologia [1].' },
          sources: []
        }
      ]
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open Science summary' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Open Technology summary' })).not.toBeInTheDocument();
    });
  });

  test('shows one-time source setup and excludes unselected sources and sub-feeds', async () => {
    const onUserUpdate = jest.fn();
    let socketOptions;
    const setupUser = {
      ...currentUser,
      settings: {
        ...currentUser.settings,
        sourceSetupCompleted: false,
        excludedSourceIds: ['ansa.it', 'repubblica.it', 'bbc.co.uk']
      },
      sourceCatalog: [
        { id: 'ansa.it', name: 'ANSA', language: 'it', subSources: [{ id: 'ansa_home', label: 'Home' }, { id: 'ansa_mondo', label: 'Mondo' }] },
        { id: 'repubblica.it', name: 'La Repubblica', language: 'it', subSources: [] },
        { id: 'bbc.co.uk', name: 'BBC News', language: 'en', subSources: [] }
      ]
    };

    updateUserSettings.mockResolvedValueOnce({
      settings: {
        ...setupUser.settings,
        sourceSetupCompleted: true,
        excludedSourceIds: ['repubblica.it', 'bbc.co.uk'],
        excludedSubSourceIds: ['ansa_mondo']
      }
    });
    useTopicRefreshSocket.mockImplementation((options) => {
      socketOptions = options;
    });

    await renderNewsAggregator({ currentUser: setupUser, onUserUpdate });

    expect(screen.getByRole('heading', { name: 'Choose your news sources' })).toBeInTheDocument();
    expect(screen.getByText('This only updates your built-in RSS source selection. Your custom sources and account settings are preserved.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Italian sources' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'English sources' })).toBeInTheDocument();
    expect(fetchNews).not.toHaveBeenCalled();
    expect(socketOptions).toEqual(expect.objectContaining({ enabled: false }));
    expect(screen.queryByRole('button', { name: /Mondo/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start reading' })).toBeDisabled();

    await act(async () => {
      socketOptions.onTopicRefresh({ refresh: true, reason: 'topics' });
      await Promise.resolve();
    });

    expect(fetchNews).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Expand ANSA feeds' }));
    fireEvent.click(screen.getByRole('button', { name: /Home/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start reading' }));
    });

    expect(updateUserSettings).toHaveBeenCalledWith({
      excludedSourceIds: ['repubblica.it', 'bbc.co.uk'],
      excludedSubSourceIds: ['ansa_mondo'],
      sourceSetupCompleted: true
    });
    expect(onUserUpdate).toHaveBeenCalledWith(expect.objectContaining({
      settings: expect.objectContaining({
        sourceSetupCompleted: true,
        excludedSourceIds: ['repubblica.it', 'bbc.co.uk'],
        excludedSubSourceIds: ['ansa_mondo']
      })
    }));
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

  test('forces a source refresh and reloads existing thematic summaries from the top navigation refresh button', async () => {
    fetchNews.mockResolvedValue({
      items: [createGroup('group-1', 'Current headline')],
      meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 },
      filters: { sources: [], sourceCatalog: [], topics: [] }
    });

    await renderNewsAggregator();

    expect(await screen.findByText('Current headline')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => {
      expect(fetchNews).toHaveBeenLastCalledWith(expect.objectContaining({ refresh: true }));
    });
    expect(fetchThematicSummaries).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('You reached the end of the available results.')).toBeInTheDocument();
  });

  test('keeps manual refresh clickable while the server cooldown is active', async () => {
    const allowedAt = new Date(Date.now() + (5 * 60 * 1000)).toISOString();

    fetchNews.mockResolvedValue({
      items: [createGroup('group-1', 'Current headline')],
      meta: {
        page: 1,
        pageSize: 12,
        hasMore: false,
        totalGroups: 1,
        manualRefreshAllowedAt: allowedAt,
        manualRefreshAllowed: false,
        manualRefreshCooldownSeconds: 300
      },
      filters: { sources: [], sourceCatalog: [], topics: [] }
    });

    await renderNewsAggregator();

    const refreshButton = await screen.findByRole('button', { name: 'Refresh' });

    expect(refreshButton).toBeEnabled();
    fireEvent.click(refreshButton);
    await waitFor(() => {
      expect(fetchNews).toHaveBeenLastCalledWith(expect.objectContaining({ refresh: true }));
    });
  });

  test('reloads cached feed silently when AI topic updates complete', async () => {
    let onTopicRefresh;

    useTopicRefreshSocket.mockImplementation(({ onTopicRefresh: handleTopicRefresh }) => {
      onTopicRefresh = handleTopicRefresh;
    });
    fetchNews
      .mockResolvedValueOnce({
        items: [createGroup('group-1', 'Fallback topic headline')],
        meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 },
        filters: { sources: [], sourceCatalog: [], topics: [] }
      })
      .mockResolvedValue({
        items: [createGroup('group-1', 'AI topic headline')],
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
      includeFilters: false
    }));
  });

  test('does not let silent topic refresh cancel the initial feed load', async () => {
    let onTopicRefresh;
    const initialRequest = createDeferred();
    let initialRequestAborted = false;

    useTopicRefreshSocket.mockImplementation(({ onTopicRefresh: handleTopicRefresh }) => {
      onTopicRefresh = handleTopicRefresh;
    });
    fetchNews.mockImplementationOnce(({ signal }) => {
      signal.addEventListener('abort', () => {
        initialRequestAborted = true;
      });
      return initialRequest.promise;
    });

    await renderNewsAggregator();

    await act(async () => {
      onTopicRefresh({ refresh: true, reason: 'topics' });
      await Promise.resolve();
    });

    expect(fetchNews).toHaveBeenCalledTimes(1);
    expect(initialRequestAborted).toBe(false);

    await resolveDeferred(initialRequest, {
      items: [createGroup('group-1', 'Initial headline')],
      meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 },
      filters: { sources: [], sourceCatalog: [], topics: [] }
    });

    expect(await screen.findByText('Initial headline')).toBeInTheDocument();
    expect(screen.queryByText('Unexpected silent headline')).not.toBeInTheDocument();
  });

  test('replaces stale fallback topics after a silent AI topic reload', async () => {
    let onTopicRefresh;
    const fallbackTopic = { topic: 'Economia', source: 'local' };
    const aiTopic = { topic: 'Tecnologia', source: 'ai', confidence: 0.9 };

    useTopicRefreshSocket.mockImplementation(({ onTopicRefresh: handleTopicRefresh }) => {
      onTopicRefresh = handleTopicRefresh;
    });
    fetchNews
      .mockResolvedValueOnce({
        items: [{
          id: 'group-1',
          title: 'Topic headline',
          topics: ['Economia'],
          topicDetails: [fallbackTopic],
          items: [{
            id: 'article-group-1',
            title: 'Topic headline',
            pubDate: '2026-03-14T10:00:00.000Z',
            topics: ['Economia'],
            topicDetails: [fallbackTopic]
          }]
        }],
        meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 },
        filters: { sources: [], sourceCatalog: [], topics: ['Economia'] }
      })
      .mockResolvedValueOnce({
        items: [{
          id: 'group-1',
          title: 'Topic headline',
          topics: ['Tecnologia'],
          topicDetails: [aiTopic],
          items: [{
            id: 'article-group-1',
            title: 'Topic headline',
            pubDate: '2026-03-14T10:00:00.000Z',
            topics: ['Tecnologia'],
            topicDetails: [aiTopic]
          }]
        }],
        meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 },
        filters: { sources: [], sourceCatalog: [], topics: ['Tecnologia'] }
      });

    await renderNewsAggregator();
    expect(await screen.findByTestId('topics-group-1')).toHaveTextContent('Economia:local');

    await act(async () => {
      onTopicRefresh({ refresh: true, reason: 'topics' });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId('topics-group-1')).toHaveTextContent('Tecnologia:ai');
    });
    expect(screen.getByTestId('topics-group-1')).not.toHaveTextContent('Economia');
  });

  test('adds brand-new cards when a manual refresh completion reload arrives', async () => {
    let socketHandlers;

    useTopicRefreshSocket.mockImplementation((handlers) => {
      socketHandlers = handlers;
    });
    fetchNews
      .mockResolvedValueOnce({
        items: [createGroup('group-current', 'Current headline')],
        meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 },
        filters: { sources: [], sourceCatalog: [], topics: [] }
      })
      .mockResolvedValueOnce({
        items: [createGroup('group-current', 'Current headline')],
        meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1, pendingUserRefresh: true },
        filters: { sources: [], sourceCatalog: [], topics: [] }
      })
      .mockResolvedValueOnce({
        items: [
          createGroup('group-new', 'Fresh manual refresh headline', '2026-03-14T11:00:00.000Z'),
          createGroup('group-current', 'Current headline')
        ],
        meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 2 },
        filters: { sources: [], sourceCatalog: [], topics: [] }
      });

    await renderNewsAggregator();
    expect(await screen.findByText('Current headline')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => {
      expect(fetchNews).toHaveBeenLastCalledWith(expect.objectContaining({ refresh: true }));
    });

    await act(async () => {
      socketHandlers.onTopicRefresh({ refresh: true, reason: 'news' });
      await Promise.resolve();
    });

    expect(await screen.findByText('Fresh manual refresh headline')).toBeInTheDocument();
    expect(fetchNews).toHaveBeenLastCalledWith(expect.objectContaining({
      refresh: false,
      includeFilters: true
    }));
  });

  test('keeps pending new article notice after silent topic reloads', async () => {
    let socketHandlers;

    useTopicRefreshSocket.mockImplementation((handlers) => {
      socketHandlers = handlers;
    });
    fetchNews
      .mockResolvedValueOnce({
        items: [createGroup('group-current', 'Current headline')],
        meta: { page: 1, pageSize: 12, hasMore: true, totalGroups: 2 },
        filters: { sources: [], sourceCatalog: [], topics: [] }
      })
      .mockResolvedValueOnce({
        items: [
          createGroup('group-new', 'New automatic headline', '2026-03-14T11:00:00.000Z'),
          createGroup('group-current', 'Current headline with AI topics')
        ],
        meta: { page: 1, pageSize: 12, hasMore: true, totalGroups: 2 },
        filters: { sources: [], sourceCatalog: [], topics: ['Technology'] }
      });

    await renderNewsAggregator();
    expect(await screen.findByText('Current headline')).toBeInTheDocument();

    await act(async () => {
      socketHandlers.onNewsUpdate({ count: 1, groupIds: ['group-new'] });
      await Promise.resolve();
    });

    expect(screen.getByText('1 new article available')).toBeInTheDocument();

    await act(async () => {
      socketHandlers.onTopicRefresh({ refresh: true, reason: 'topics' });
      await Promise.resolve();
    });

    expect(await screen.findByText('Current headline with AI topics')).toBeInTheDocument();
    expect(screen.queryByText('New automatic headline')).not.toBeInTheDocument();
    expect(screen.getByText('1 new article available')).toBeInTheDocument();
  });

  test('does not cancel manual refresh loading when a silent topic reload arrives', async () => {
    let onTopicRefresh;
    const manualRefreshRequest = createDeferred();
    let manualRequestAborted = false;

    useTopicRefreshSocket.mockImplementation(({ onTopicRefresh: handleTopicRefresh }) => {
      onTopicRefresh = handleTopicRefresh;
    });
    fetchNews
      .mockResolvedValueOnce({
        items: [createGroup('group-1', 'Current headline')],
        meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 },
        filters: { sources: [], sourceCatalog: [], topics: [] }
      })
      .mockImplementationOnce(({ signal }) => {
        signal.addEventListener('abort', () => {
          manualRequestAborted = true;
        });
        return manualRefreshRequest.promise;
      });

    await renderNewsAggregator();
    expect(await screen.findByText('Current headline')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => {
      expect(fetchNews).toHaveBeenLastCalledWith(expect.objectContaining({ refresh: true }));
    });
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();

    await act(async () => {
      onTopicRefresh({ refresh: true, reason: 'topics' });
      await Promise.resolve();
    });

    expect(fetchNews).toHaveBeenCalledTimes(2);
    expect(manualRequestAborted).toBe(false);
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();

    await resolveDeferred(manualRefreshRequest, {
      items: [createGroup('group-1', 'Manual refresh headline')],
      meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 },
      filters: { sources: [], sourceCatalog: [], topics: [] }
    });

    expect(await screen.findByText('Manual refresh headline')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
    });
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
          items: [
            ...createRetitledGroups('initial', 'refreshed', 1, 12),
            ...createRetitledGroups('older', 'refreshed', 13, 1)
          ],
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
      includeFilters: false
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
          items: [
            ...createRetitledGroups('initial', 'refreshed', 1, 12),
            ...createRetitledGroups('older', 'refreshed', 13, 1)
          ],
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
      includeFilters: false
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
          items: createRetitledGroups('initial', 'refreshed', 1, 12),
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

  test('reloads cached feed from the new article pill', async () => {
    let socketHandlers;

    useTopicRefreshSocket.mockImplementation((handlers) => {
      socketHandlers = handlers;
    });
    fetchNews.mockReset();
    fetchNews
      .mockResolvedValueOnce({
        items: [{ id: 'group-1', title: 'Current headline', items: [{ id: 'article-1', pubDate: '2026-03-14T10:00:00.000Z' }] }],
        meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 },
        filters: { sources: [], sourceCatalog: [], topics: [] }
      })
      .mockResolvedValueOnce({
        items: [{ id: 'group-2', title: 'Fresh headline', items: [{ id: 'article-2', pubDate: '2026-03-14T11:00:00.000Z' }] }],
        meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 },
        filters: { sources: [], sourceCatalog: [], topics: [] }
      });

    await renderNewsAggregator();

    expect(await screen.findByText('Current headline')).toBeInTheDocument();
    const initialCallCount = fetchNews.mock.calls.length;

    await act(async () => {
      socketHandlers.onNewsUpdate({ count: 2, groupIds: ['group-2', 'group-3'] });
      socketHandlers.onNewsUpdate({ count: 1, groupIds: ['group-3'] });
      await Promise.resolve();
    });

    const newArticlesButton = screen.getByRole('button', { name: '2 new articles available' });
    fireEvent.click(newArticlesButton);

    await waitFor(() => {
      expect(fetchNews).toHaveBeenCalledTimes(initialCallCount + 1);
    });
    expect(fetchNews).toHaveBeenLastCalledWith(expect.objectContaining({
      refresh: false,
      includeFilters: true
    }));
    expect(await screen.findByText('Fresh headline')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '2 new articles available' })).not.toBeInTheDocument();
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
            beforeId: 'article-1',
            excludeArticleIds: ['article-1', 'article-related']
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
        beforeId: 'article-1',
        excludeArticleIds: ['article-1', 'article-related']
      }));
    });
    expect(await screen.findByText('Older headline')).toBeInTheDocument();
  });

  test('does not leave an empty grid cell for groups without articles', async () => {
    fetchNews.mockResolvedValue({
      items: [
        { id: 'empty-group', title: 'Empty headline', items: [] },
        { id: 'visible-group', title: 'Visible headline', items: [{ id: 'article-1', pubDate: '2026-03-14T10:00:00.000Z' }] }
      ],
      meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1 },
      filters: { sources: [], sourceCatalog: [], topics: [] }
    });

    const { container } = await renderNewsAggregator();

    expect(await screen.findByText('Visible headline')).toBeInTheDocument();
    expect(screen.queryByText('Empty headline')).not.toBeInTheDocument();
    expect(container.querySelector('main .grid')?.children).toHaveLength(1);
  });

  test('merges appended groups that share an AI story id', async () => {
    fetchNews.mockImplementation(({ beforeId }) => {
      if (beforeId === 'article-current') {
        return Promise.resolve({
          items: [
            {
              id: 'group-older-duplicate',
              title: 'Older duplicate headline',
              items: [
                {
                  id: 'article-older',
                  title: 'Older duplicate headline',
                  sourceId: 'source-b',
                  source: 'Source B',
                  storyGroupId: 'ai-story-1',
                  aiStoryGroupStatus: 'matched',
                  pubDate: '2026-03-14T09:00:00.000Z'
                }
              ]
            }
          ],
          meta: { page: 1, pageSize: 12, hasMore: false, nextCursor: null },
          filters: { sources: [], sourceCatalog: [], topics: [] }
        });
      }

      return Promise.resolve({
        items: [
          {
            id: 'group-current',
            title: 'Current merged headline',
            items: [
              {
                id: 'article-current',
                title: 'Current merged headline',
                sourceId: 'source-a',
                source: 'Source A',
                storyGroupId: 'ai-story-1',
                aiStoryGroupStatus: 'matched',
                pubDate: '2026-03-14T10:00:00.000Z'
              }
            ]
          }
        ],
        meta: {
          page: 1,
          pageSize: 12,
          hasMore: true,
          nextCursor: {
            beforePubDate: '2026-03-14T10:00:00.000Z',
            beforeId: 'article-current'
          }
        },
        filters: { sources: [], sourceCatalog: [], topics: [] }
      });
    });

    await renderNewsAggregator();
    expect(await screen.findByText('Current merged headline')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() => {
      expect(fetchNews).toHaveBeenLastCalledWith(expect.objectContaining({
        beforeId: 'article-current'
      }));
    });
    expect(screen.getByText('Current merged headline')).toBeInTheDocument();
    expect(screen.queryByText('Older duplicate headline')).not.toBeInTheDocument();
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
    const searchInput = screen.getByRole('searchbox', { name: 'Search' });
    fireEvent.change(searchInput, { target: { value: 'economy' } });

    expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));

    expect(searchInput).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
  });

});
