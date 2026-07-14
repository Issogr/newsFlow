import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import NewsAggregator from './NewsAggregator';
import { fetchNews, fetchReadLaterNews, fetchThematicSummaries, isRequestCanceled, markThematicSummariesRead, updateUserSettings } from '../services/api';
import useTopicRefreshSocket from '../hooks/useTopicRefreshSocket';
import { createDeferred, resolveDeferred } from '../test-utils/deferred';
import { createTestCurrentUser } from '../test-utils/currentUser';
import { createPodcastSummary } from '../test-utils/thematicSummaries';

vi.mock('../services/api', () => ({
  fetchNews: vi.fn(),
  fetchReadLaterNews: vi.fn(),
  fetchThematicSummaries: vi.fn(),
  markThematicSummariesRead: vi.fn(),
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
        onLogout={overrides.onLogout || vi.fn()}
        onUserUpdate={overrides.onUserUpdate || vi.fn()}
      />
    );
    await Promise.resolve();
  });

  return view;
}

function openDesktopSearch() {
  fireEvent.click(screen.getAllByRole('button', { name: 'Search' })[0]);
}

function getDesktopRefreshButton() {
  return screen.getAllByRole('button', { name: 'Refresh' })[0];
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

function createFeedResponse(items = [], overrides = {}) {
  return {
    items,
    meta: { page: 1, pageSize: 12, hasMore: false, totalGroups: 1, ...(overrides.meta || {}) },
    filters: { sources: [], sourceCatalog: [], topics: [], ...(overrides.filters || {}) },
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'meta' && key !== 'filters'))
  };
}

function createSingleGroupFeedResponse(id, title, options = {}) {
  const { pubDate, ...overrides } = options;
  return createFeedResponse([createGroup(id, title, pubDate)], overrides);
}

function createThematicSummary(overrides = {}) {
  const topicKey = overrides.topicKey || 'technology';
  const topicLabel = overrides.topicLabel || `${topicKey.charAt(0).toUpperCase()}${topicKey.slice(1)}`;

  return {
    id: `summary-${topicKey}`,
    topicKey,
    topicLabel,
    topics: [topicLabel],
    periodStart: '2026-05-21T07:00:00.000Z',
    periodEnd: '2026-05-21T13:00:00.000Z',
    summaryTextByLocale: {
      en: `${topicLabel} update [1].`,
      it: `Aggiornamento ${topicKey} [1].`
    },
    sources: [],
    ...overrides
  };
}

function captureSocketHandlers() {
  const socketHandlers = {};
  useTopicRefreshSocket.mockImplementation((handlers) => {
    Object.assign(socketHandlers, handlers);
  });
  return socketHandlers;
}

const currentUser = createTestCurrentUser();

describe('NewsAggregator', () => {
  let desktopMediaQuery;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    Object.defineProperty(window, 'scrollY', {
      value: 0,
      writable: true,
      configurable: true
    });
    window.scrollTo = vi.fn();
    window.localStorage.clear();
    desktopMediaQuery = {
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    };
    window.matchMedia = vi.fn().mockImplementation(() => desktopMediaQuery);
    fetchThematicSummaries.mockResolvedValue({ items: [] });
    markThematicSummariesRead.mockResolvedValue({ readSummaryIds: [] });
    useTopicRefreshSocket.mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
  });

  test('shows account initials and falls back to the user icon without a username', async () => {
    fetchNews.mockResolvedValue(createFeedResponse([], { meta: { totalGroups: 0 } }));

    const namedView = await renderNewsAggregator({
      currentUser: createTestCurrentUser({ user: { username: 'simone.rossi' } })
    });

    expect(screen.getByText('SR')).toBeInTheDocument();
    expect(screen.queryByText('User')).not.toBeInTheDocument();

    namedView.unmount();
    fetchNews.mockClear();

    const unnamedView = await renderNewsAggregator({
      currentUser: createTestCurrentUser({ user: { username: '' } })
    });

    expect(screen.queryByText('?')).not.toBeInTheDocument();
    expect(unnamedView.container.querySelector('button[aria-label="User"] .lucide-user')).toBeInTheDocument();
  });

  test('shows card-shaped placeholders while the initial feed loads', async () => {
    const request = createDeferred();
    fetchNews.mockReturnValue(request.promise);

    await renderNewsAggregator();

    const loadingStatus = screen.getByRole('status', { name: 'Loading...' });
    expect(loadingStatus.querySelectorAll('article')).toHaveLength(6);

    await resolveDeferred(request, createFeedResponse([], { meta: { totalGroups: 0 } }));
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Loading...' })).not.toBeInTheDocument());
  });

  test('ignores main-feed refresh socket events while viewing read later', async () => {
    const socketHandlers = captureSocketHandlers();
    fetchNews.mockResolvedValue(createSingleGroupFeedResponse('news', 'News headline'));
    fetchReadLaterNews.mockResolvedValue(createSingleGroupFeedResponse('saved', 'Saved headline'));

    await renderNewsAggregator();
    fireEvent.click(screen.getAllByRole('button', { name: 'Read later' })[0]);
    await waitFor(() => expect(fetchReadLaterNews).toHaveBeenCalled());
    fetchNews.mockClear();
    fetchReadLaterNews.mockClear();

    await act(async () => {
      socketHandlers.onTopicRefresh({ refresh: true, reason: 'news' });
      await Promise.resolve();
    });

    expect(fetchNews).not.toHaveBeenCalled();
    expect(fetchReadLaterNews).not.toHaveBeenCalled();
  });

  test('keeps an open reader synchronized with refreshed feed groups', async () => {
    const socketHandlers = captureSocketHandlers();
    const initialGroup = createGroup('group-1', 'Current headline');
    const refreshedGroup = {
      ...initialGroup,
      items: [
        ...initialGroup.items,
        { id: 'article-group-1-extra', title: 'Extra source', pubDate: '2026-03-14T10:01:00.000Z' }
      ]
    };
    fetchNews
      .mockResolvedValueOnce(createFeedResponse([initialGroup]))
      .mockResolvedValueOnce(createFeedResponse([refreshedGroup]));

    await renderNewsAggregator();
    expect(await screen.findByText('Current headline')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open reader group-1' }));
    expect(screen.getByTestId('reader-item-count')).toHaveTextContent('1');

    await act(async () => {
      socketHandlers.onTopicRefresh({ refresh: true, reason: 'topics' });
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

      return Promise.resolve(createSingleGroupFeedResponse('new-group', 'New headline'));
    });

    await renderNewsAggregator();

    openDesktopSearch();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'economy' } });

    await act(async () => {
      vi.advanceTimersByTime(350);
    });

    await resolveDeferred(secondRequest, createSingleGroupFeedResponse('new-group', 'New headline'));

    expect(await screen.findByText('New headline')).toBeInTheDocument();

    await resolveDeferred(firstRequest, createSingleGroupFeedResponse('old-group', 'Old headline'));

    await waitFor(() => {
      expect(screen.getByText('New headline')).toBeInTheDocument();
      expect(screen.queryByText('Old headline')).not.toBeInTheDocument();
    });
    expect(isRequestCanceled).not.toHaveBeenCalled();
  });

  test('renders thematic summary stories and opens the summary panel', async () => {
    fetchNews.mockResolvedValue(createSingleGroupFeedResponse('group-1', 'Top headline'));
    fetchThematicSummaries.mockResolvedValue({
      items: [
        createThematicSummary({
          topics: ['Tecnologia'],
          summaryText: 'AI chips moved quickly during the window [1].',
          summaryTextByLocale: {
            en: 'AI chips moved quickly during the window [1].',
            it: 'I chip AI sono avanzati rapidamente nella finestra [1].'
          },
          articleCount: 1,
          sources: [{ index: 1, articleId: 'article-1', title: 'AI chips accelerate', source: 'BBC', sourceIconUrl: 'https://example.com/favicon.ico', url: 'https://example.com/ai' }]
        })
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

    await act(async () => {
      fireEvent.click(storyButton);
      await Promise.resolve();
    });

    expect(markThematicSummariesRead).toHaveBeenCalledWith(['summary-technology']);
    expect(screen.getByText('Ora di pranzo')).toBeInTheDocument();
    expect(screen.getByText('1 articolo valutato')).toBeInTheDocument();
    expect(screen.queryByText('I chip AI sono avanzati rapidamente nella finestra [1].')).not.toBeInTheDocument();
    expect(screen.getAllByText('BBC')).not.toHaveLength(0);
    expect(screen.queryByText('AI chips accelerate')).not.toBeInTheDocument();
  });

  test('uses server read summary ids to hide already-read thematic summary badges', async () => {
    fetchNews.mockResolvedValue(createSingleGroupFeedResponse('group-1', 'Top headline'));
    fetchThematicSummaries.mockResolvedValue({
      readSummaryIds: ['summary-technology'],
      items: [
        createThematicSummary({
          summaryTextByLocale: { en: 'Technology update [1].', it: 'Aggiornamento tecnologia [1].' },
          sources: []
        })
      ]
    });

    await renderNewsAggregator();

    const storyButton = await screen.findByRole('button', { name: 'Open Technology summary' });
    expect(storyButton.querySelector('.lucide-sparkles')).toBeNull();
  });

  test('does not fetch thematic summaries when summary and podcast features are disabled', async () => {
    fetchNews.mockResolvedValue(createSingleGroupFeedResponse('group-1', 'Top headline'));

    await renderNewsAggregator({
      currentUser: {
        ...currentUser,
        features: {
          ai: {
            thematicSummariesEnabled: false,
            podcastsEnabled: false
          }
        }
      }
    });

    expect(await screen.findByText('Top headline')).toBeInTheDocument();
    expect(fetchThematicSummaries).not.toHaveBeenCalled();
  });

  test('hides podcast stories when the podcast feature is disabled', async () => {
    fetchNews.mockResolvedValue(createSingleGroupFeedResponse('group-1', 'Top headline'));
    fetchThematicSummaries.mockResolvedValue({
      items: [
        createPodcastSummary(),
        createThematicSummary({
          summaryTextByLocale: { en: 'Technology update [1].', it: 'Aggiornamento tecnologia [1].' },
          sources: []
        })
      ]
    });

    await renderNewsAggregator({
      currentUser: {
        ...currentUser,
        features: {
          ai: {
            thematicSummariesEnabled: true,
            podcastsEnabled: false
          }
        }
      }
    });

    expect(await screen.findByRole('button', { name: 'Open Technology summary' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open podcast briefing' })).not.toBeInTheDocument();
  });

  test('refreshes thematic stories when summary socket refresh arrives', async () => {
    const socketHandlers = captureSocketHandlers();
    fetchNews.mockResolvedValue(createSingleGroupFeedResponse('group-1', 'Top headline'));
    fetchThematicSummaries
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({
        items: [
          createThematicSummary({
            topicKey: 'science',
            topicLabel: 'Science',
            topics: ['Scienza'],
            summaryTextByLocale: { en: 'Science update [1].', it: 'Aggiornamento scienza [1].' },
            sources: []
          })
        ]
      });

    await renderNewsAggregator();
    expect(screen.queryByRole('button', { name: 'Open Science summary' })).not.toBeInTheDocument();

    await act(async () => {
      await socketHandlers.onSummariesRefresh({ refresh: true, reason: 'summaries' });
    });

    expect(await screen.findByRole('button', { name: 'Open Science summary' })).toBeInTheDocument();
  });

  test('updates the open summary panel when refreshed summary data arrives', async () => {
    const socketHandlers = captureSocketHandlers();
    fetchNews.mockResolvedValue(createSingleGroupFeedResponse('group-1', 'Top headline'));
    fetchThematicSummaries
      .mockResolvedValueOnce({
        items: [
          createThematicSummary({
            summaryTextByLocale: { en: 'First technology update [1].', it: 'Primo aggiornamento tecnologia [1].' },
            articleCount: 1,
            sources: []
          })
        ]
      })
      .mockResolvedValueOnce({
        items: [
          createThematicSummary({
            summaryTextByLocale: { en: 'Updated technology update [1].', it: 'Aggiornamento tecnologia aggiornato [1].' },
            articleCount: 2,
            sources: []
          })
        ]
      });

    await renderNewsAggregator();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Open Technology summary' }));
      await Promise.resolve();
    });

    expect(screen.getByText('1 article evaluated')).toBeInTheDocument();

    await act(async () => {
      await socketHandlers.onSummariesRefresh({ refresh: true, reason: 'summaries' });
    });

    expect(await screen.findByText('2 articles evaluated')).toBeInTheDocument();
    expect(screen.queryByText('1 article evaluated')).not.toBeInTheDocument();
  });

  test('closes an open summary panel when refreshed summaries no longer include it', async () => {
    const socketHandlers = captureSocketHandlers();
    fetchNews.mockResolvedValue(createSingleGroupFeedResponse('group-1', 'Top headline'));
    fetchThematicSummaries
      .mockResolvedValueOnce({
        items: [
          createThematicSummary({
            summaryTextByLocale: { en: 'Technology update [1].', it: 'Aggiornamento tecnologia [1].' },
            articleCount: 1,
            sources: []
          })
        ]
      })
      .mockResolvedValueOnce({
        items: [
          createThematicSummary({
            topicKey: 'science',
            topicLabel: 'Science',
            summaryTextByLocale: { en: 'Science update [1].', it: 'Aggiornamento scienza [1].' },
            articleCount: 1,
            sources: []
          })
        ]
      });

    await renderNewsAggregator();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Open Technology summary' }));
      await Promise.resolve();
    });
    expect(screen.getByText('1 article evaluated')).toBeInTheDocument();

    await act(async () => {
      await socketHandlers.onSummariesRefresh({ refresh: true, reason: 'summaries' });
    });

    expect(await screen.findByRole('button', { name: 'Open Science summary' })).toBeInTheDocument();
    expect(screen.queryByText('1 article evaluated')).not.toBeInTheDocument();
  });

  test('ignores stale thematic summary responses after a newer refresh', async () => {
    const socketHandlers = captureSocketHandlers();
    const firstSummariesRequest = createDeferred();
    const secondSummariesRequest = createDeferred();

    fetchNews.mockResolvedValue(createSingleGroupFeedResponse('group-1', 'Top headline'));
    fetchThematicSummaries
      .mockImplementationOnce(() => firstSummariesRequest.promise)
      .mockImplementationOnce(() => secondSummariesRequest.promise);

    await renderNewsAggregator();

    let refreshPromise;
    await act(async () => {
      refreshPromise = socketHandlers.onSummariesRefresh({ refresh: true, reason: 'summaries' });
      await Promise.resolve();
    });
    await resolveDeferred(secondSummariesRequest, {
      items: [
        createThematicSummary({
          topicKey: 'science',
          topicLabel: 'Science',
          topics: ['Scienza'],
          summaryTextByLocale: { en: 'Science update [1].', it: 'Aggiornamento scienza [1].' },
          sources: []
        })
      ]
    });
    await act(async () => {
      await refreshPromise;
    });

    expect(await screen.findByRole('button', { name: 'Open Science summary' })).toBeInTheDocument();

    await resolveDeferred(firstSummariesRequest, {
      items: [
        createThematicSummary({
          topics: ['Tecnologia'],
          summaryTextByLocale: { en: 'Technology update [1].', it: 'Aggiornamento tecnologia [1].' },
          sources: []
        })
      ]
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open Science summary' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Open Technology summary' })).not.toBeInTheDocument();
    });
  });

  test('shows one-time source setup and excludes unselected sources and sub-feeds', async () => {
    const onUserUpdate = vi.fn();
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

  test('clears an active source filter when the source is removed', async () => {
    const source = { id: 'custom-source', name: 'Custom Feed', url: 'https://example.com/rss', language: 'en' };
    const userWithSource = createTestCurrentUser({ customSources: [source] });
    const onUserUpdate = vi.fn();
    const onLogout = vi.fn();
    const sourceResponse = createSingleGroupFeedResponse('group-1', 'Custom headline', {
      filters: { sources: [{ ...source, count: 1 }], sourceCatalog: [], topics: [] }
    });
    fetchNews.mockResolvedValue(sourceResponse);
    const view = await renderNewsAggregator({ currentUser: userWithSource, onUserUpdate, onLogout });

    fireEvent.click(screen.getAllByRole('button', { name: 'Sources' })[0]);
    fireEvent.click(screen.getByRole('button', { name: /Custom Feed/ }));
    await waitFor(() => {
      expect(fetchNews).toHaveBeenLastCalledWith(expect.objectContaining({ sourceIds: ['custom-source'] }));
    });

    const activeFilterCallCount = fetchNews.mock.calls.length;
    fetchNews.mockResolvedValue(createSingleGroupFeedResponse('group-2', 'Remaining headline'));
    await act(async () => {
      view.rerender(
        <NewsAggregator
          currentUser={createTestCurrentUser({ customSources: [] })}
          onLogout={onLogout}
          onUserUpdate={onUserUpdate}
        />
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(fetchNews.mock.calls.slice(activeFilterCallCount).some(([params]) => params.sourceIds.length === 0)).toBe(true);
    });
  });

  test('loads cached news on open without forcing a source refresh', async () => {
    fetchNews.mockResolvedValue(createFeedResponse([], { meta: { totalGroups: 0 } }));

    await renderNewsAggregator();

    await waitFor(() => {
      expect(fetchNews).toHaveBeenCalledWith(expect.objectContaining({ refresh: false }));
    });

    expect(fetchNews).toHaveBeenCalledTimes(1);
    expect(getDesktopRefreshButton()).toBeEnabled();
  });

  test('forces a source refresh without reloading unchanged thematic summaries from the refresh button', async () => {
    fetchNews.mockResolvedValue(createSingleGroupFeedResponse('group-1', 'Current headline'));

    await renderNewsAggregator();

    expect(await screen.findByText('Current headline')).toBeInTheDocument();

    fireEvent.click(getDesktopRefreshButton());

    await waitFor(() => {
      expect(fetchNews).toHaveBeenLastCalledWith(expect.objectContaining({ refresh: true }));
    });
    expect(fetchThematicSummaries).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('You reached the end of the available results.')).toBeInTheDocument();
  });

  test('keeps manual refresh clickable while the server cooldown is active', async () => {
    const allowedAt = new Date(Date.now() + (5 * 60 * 1000)).toISOString();

    fetchNews.mockResolvedValue(createSingleGroupFeedResponse('group-1', 'Current headline', {
      meta: {
        manualRefreshAllowedAt: allowedAt,
        manualRefreshAllowed: false,
        manualRefreshCooldownSeconds: 300
      },
    }));

    await renderNewsAggregator();

    const refreshButton = getDesktopRefreshButton();

    expect(refreshButton).toBeEnabled();
    fireEvent.click(refreshButton);
    await waitFor(() => {
      expect(fetchNews).toHaveBeenLastCalledWith(expect.objectContaining({ refresh: true }));
    });
  });

  test('reloads cached feed silently when AI topic updates complete', async () => {
    const socketHandlers = captureSocketHandlers();
    fetchNews
      .mockResolvedValueOnce(createSingleGroupFeedResponse('group-1', 'Fallback topic headline'))
      .mockResolvedValue(createSingleGroupFeedResponse('group-1', 'AI topic headline'));

    await renderNewsAggregator();
    await waitFor(() => {
      expect(fetchNews).toHaveBeenCalled();
    });
    const initialCallCount = fetchNews.mock.calls.length;

    await act(async () => {
      socketHandlers.onTopicRefresh({ refresh: true, reason: 'topics' });
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
    const socketHandlers = captureSocketHandlers();
    const initialRequest = createDeferred();
    let initialRequestAborted = false;

    fetchNews.mockImplementationOnce(({ signal }) => {
      signal.addEventListener('abort', () => {
        initialRequestAborted = true;
      });
      return initialRequest.promise;
    });

    await renderNewsAggregator();

    await act(async () => {
      socketHandlers.onTopicRefresh({ refresh: true, reason: 'topics' });
      await Promise.resolve();
    });

    expect(fetchNews).toHaveBeenCalledTimes(1);
    expect(initialRequestAborted).toBe(false);

    await resolveDeferred(initialRequest, createSingleGroupFeedResponse('group-1', 'Initial headline'));

    expect(await screen.findByText('Initial headline')).toBeInTheDocument();
    expect(screen.queryByText('Unexpected silent headline')).not.toBeInTheDocument();
  });

  test('replaces stale fallback topics after a silent AI topic reload', async () => {
    const socketHandlers = captureSocketHandlers();
    const fallbackTopic = { topic: 'Economia', source: 'local' };
    const aiTopic = { topic: 'Tecnologia', source: 'ai', confidence: 0.9 };

    fetchNews
      .mockResolvedValueOnce(createFeedResponse([{
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
        }], { filters: { topics: ['Economia'] } }))
      .mockResolvedValueOnce(createFeedResponse([{
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
        }], { filters: { topics: ['Tecnologia'] } }));

    await renderNewsAggregator();
    expect(await screen.findByTestId('topics-group-1')).toHaveTextContent('Economia:local');

    await act(async () => {
      socketHandlers.onTopicRefresh({ refresh: true, reason: 'topics' });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId('topics-group-1')).toHaveTextContent('Tecnologia:ai');
    });
    expect(screen.getByTestId('topics-group-1')).not.toHaveTextContent('Economia');
  });

  test('adds brand-new cards when a manual refresh completion reload arrives', async () => {
    const socketHandlers = captureSocketHandlers();
    fetchNews
      .mockResolvedValueOnce(createSingleGroupFeedResponse('group-current', 'Current headline'))
      .mockResolvedValueOnce(createSingleGroupFeedResponse('group-current', 'Current headline', { meta: { pendingUserRefresh: true } }))
      .mockResolvedValueOnce(createFeedResponse([
          createGroup('group-new', 'Fresh manual refresh headline', '2026-03-14T11:00:00.000Z'),
          createGroup('group-current', 'Current headline')
        ], { meta: { totalGroups: 2 } }));

    await renderNewsAggregator();
    expect(await screen.findByText('Current headline')).toBeInTheDocument();

    fireEvent.click(getDesktopRefreshButton());
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
    const socketHandlers = captureSocketHandlers();
    fetchNews
      .mockResolvedValueOnce(createSingleGroupFeedResponse('group-current', 'Current headline', { meta: { hasMore: true, totalGroups: 2 } }))
      .mockResolvedValueOnce(createFeedResponse([
          createGroup('group-new', 'New automatic headline', '2026-03-14T11:00:00.000Z'),
          createGroup('group-current', 'Current headline with AI topics')
        ], { meta: { hasMore: true, totalGroups: 2 }, filters: { topics: ['Technology'] } }));

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
    const socketHandlers = captureSocketHandlers();
    const manualRefreshRequest = createDeferred();
    let manualRequestAborted = false;

    fetchNews
      .mockResolvedValueOnce(createSingleGroupFeedResponse('group-1', 'Current headline'))
      .mockImplementationOnce(({ signal }) => {
        signal.addEventListener('abort', () => {
          manualRequestAborted = true;
        });
        return manualRefreshRequest.promise;
      });

    await renderNewsAggregator();
    expect(await screen.findByText('Current headline')).toBeInTheDocument();

    fireEvent.click(getDesktopRefreshButton());
    await waitFor(() => {
      expect(fetchNews).toHaveBeenLastCalledWith(expect.objectContaining({ refresh: true }));
    });
    expect(getDesktopRefreshButton()).toBeDisabled();

    await act(async () => {
      socketHandlers.onTopicRefresh({ refresh: true, reason: 'topics' });
      await Promise.resolve();
    });

    expect(fetchNews).toHaveBeenCalledTimes(2);
    expect(manualRequestAborted).toBe(false);
    expect(getDesktopRefreshButton()).toBeDisabled();

    await resolveDeferred(manualRefreshRequest, createSingleGroupFeedResponse('group-1', 'Manual refresh headline'));

    expect(await screen.findByText('Manual refresh headline')).toBeInTheDocument();
    await waitFor(() => {
      expect(getDesktopRefreshButton()).toBeEnabled();
    });
  });

  test('keeps loaded-more articles during silent AI topic reloads', async () => {
    const socketHandlers = captureSocketHandlers();

    fetchNews.mockImplementation(({ beforeId, pageSize }) => {
      if (beforeId === 'article-initial-12') {
        return Promise.resolve(createFeedResponse(createGroups('older', 13, 1), { meta: { nextCursor: null } }));
      }

      if (pageSize === 13) {
        return Promise.resolve(createFeedResponse([
            ...createRetitledGroups('initial', 'refreshed', 1, 12),
            ...createRetitledGroups('older', 'refreshed', 13, 1)
          ], { meta: { pageSize: 13, nextCursor: null }, filters: { topics: ['Technology'] } }));
      }

      return Promise.resolve(createFeedResponse(createGroups('initial', 1, 12), {
        meta: {
          hasMore: true,
          nextCursor: {
            beforePubDate: '2026-03-14T10:12:00.000Z',
            beforeId: 'article-initial-12'
          }
        }
      }));
    });

    await renderNewsAggregator();
    expect(await screen.findByText('initial headline 12')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('older headline 13')).toBeInTheDocument();

    await act(async () => {
      socketHandlers.onTopicRefresh({ refresh: true, reason: 'topics' });
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
    const socketHandlers = captureSocketHandlers();
    const appendRequest = createDeferred();

    fetchNews.mockImplementation(({ beforeId, pageSize }) => {
      if (beforeId === 'article-initial-12') {
        return appendRequest.promise;
      }

      if (pageSize > 12) {
        return Promise.resolve(createFeedResponse([
            ...createRetitledGroups('initial', 'refreshed', 1, 12),
            ...createRetitledGroups('older', 'refreshed', 13, 1)
          ], { meta: { pageSize: 13, nextCursor: null } }));
      }

      return Promise.resolve(createFeedResponse(createGroups('initial', 1, 12), {
        meta: {
          hasMore: true,
          nextCursor: {
            beforePubDate: '2026-03-14T10:12:00.000Z',
            beforeId: 'article-initial-12'
          }
        }
      }));
    });

    await renderNewsAggregator();
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));

    await act(async () => {
      appendRequest.resolve(createFeedResponse(createGroups('older', 13, 1), { meta: { nextCursor: null } }));
      await appendRequest.promise;
      socketHandlers.onTopicRefresh({ refresh: true, reason: 'topics' });
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
    const socketHandlers = captureSocketHandlers();

    fetchNews.mockImplementation(({ beforeId, pageSize }) => {
      if (beforeId === 'article-initial-12') {
        return Promise.resolve(createFeedResponse(createGroups('older', 13, 12), {
          meta: {
            hasMore: true,
            nextCursor: {
              beforePubDate: '2026-03-14T10:24:00.000Z',
              beforeId: 'article-older-24'
            }
          }
        }));
      }

      if (pageSize > 12) {
        return Promise.resolve(createFeedResponse(createRetitledGroups('initial', 'refreshed', 1, 12), {
          meta: { nextCursor: null }
        }));
      }

      return Promise.resolve(createFeedResponse(createGroups('initial', 1, 12), {
        meta: {
          hasMore: true,
          nextCursor: {
            beforePubDate: '2026-03-14T10:12:00.000Z',
            beforeId: 'article-initial-12'
          }
        }
      }));
    });

    await renderNewsAggregator();
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('older headline 24')).toBeInTheDocument();

    await act(async () => {
      socketHandlers.onTopicRefresh({ refresh: true, reason: 'topics' });
      await Promise.resolve();
    });

    expect(await screen.findByText('refreshed headline 12')).toBeInTheDocument();
    expect(screen.getByText('older headline 24')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load more' })).toBeEnabled();
  });

  test('reloads cached feed from the new article pill', async () => {
    const socketHandlers = captureSocketHandlers();
    fetchNews.mockReset();
    fetchNews
      .mockResolvedValueOnce(createFeedResponse([{ id: 'group-1', title: 'Current headline', items: [{ id: 'article-1', pubDate: '2026-03-14T10:00:00.000Z' }] }]))
      .mockResolvedValueOnce(createFeedResponse([{ id: 'group-2', title: 'Fresh headline', items: [{ id: 'article-2', pubDate: '2026-03-14T11:00:00.000Z' }] }]));

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
        return Promise.resolve(createFeedResponse([{ id: 'group-older', title: 'Older headline', items: [{ id: 'article-0', pubDate: '2026-03-14T09:00:00.000Z' }] }], {
          meta: { nextCursor: null }
        }));
      }

      return Promise.resolve(createFeedResponse([{ id: 'group-1', title: 'Current headline', items: [{ id: 'article-1', pubDate: '2026-03-14T10:00:00.000Z' }] }], {
        meta: {
          hasMore: true,
          nextCursor: {
            beforePubDate: '2026-03-14T10:00:00.000Z',
            beforeId: 'article-1',
            excludeArticleIds: ['article-1', 'article-related']
          }
        }
      }));
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
    fetchNews.mockResolvedValue(createFeedResponse([
        { id: 'empty-group', title: 'Empty headline', items: [] },
        { id: 'visible-group', title: 'Visible headline', items: [{ id: 'article-1', pubDate: '2026-03-14T10:00:00.000Z' }] }
      ]));

    const { container } = await renderNewsAggregator();

    expect(await screen.findByText('Visible headline')).toBeInTheDocument();
    expect(screen.queryByText('Empty headline')).not.toBeInTheDocument();
    expect(container.querySelector('main .grid')?.children).toHaveLength(1);
  });

  test('merges appended groups that share an AI story id', async () => {
    fetchNews.mockImplementation(({ beforeId }) => {
      if (beforeId === 'article-current') {
        return Promise.resolve(createFeedResponse([
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
          ], { meta: { nextCursor: null } }));
      }

      return Promise.resolve(createFeedResponse([
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
        ], {
        meta: {
          hasMore: true,
          nextCursor: {
            beforePubDate: '2026-03-14T10:00:00.000Z',
            beforeId: 'article-current'
          }
        }
      }));
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

      return Promise.resolve(createFeedResponse(items, {
        meta: {
          hasMore,
          nextCursor: hasMore ? {
            beforePubDate: `2026-03-14T10:${String(start + 11).padStart(2, '0')}:00.000Z`,
            beforeId: `article-page-${pageNumber}-${start + 11}`
          } : null
        }
      }));
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
        return Promise.resolve(createFeedResponse([{ id: 'group-1', title: 'Current headline', items: [{ id: 'article-1', pubDate: '2026-03-14T10:00:00.000Z' }] }], {
          meta: {
            hasMore: true,
            nextCursor: {
              beforePubDate: '2026-03-14T10:00:00.000Z',
              beforeId: 'article-1'
            }
          }
        }));
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
      vi.advanceTimersByTime(350);
    });

    await resolveDeferred(reloadRequest, createFeedResponse([{ id: 'group-reloaded', title: 'Reloaded headline', items: [{ id: 'article-2', pubDate: '2026-03-14T11:00:00.000Z' }] }], {
      meta: {
        hasMore: true,
        nextCursor: {
          beforePubDate: '2026-03-14T11:00:00.000Z',
          beforeId: 'article-2'
        }
      }
    }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Load more' })).toBeEnabled();
    });
  });

  test('shows a clear-search button and clears the search field', async () => {
    fetchNews.mockResolvedValue(createFeedResponse([], { meta: { totalGroups: 0 } }));

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
