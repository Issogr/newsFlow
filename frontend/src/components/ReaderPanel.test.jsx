import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReaderPanel from './ReaderPanel';
import { fetchReaderArticle, updateUserSettings } from '../services/api';
import { createDeferred, resolveDeferred } from '../test-utils/deferred';

vi.mock('../services/api', () => ({
  fetchReaderArticle: vi.fn(),
  updateUserSettings: vi.fn(),
  isRequestCanceled: vi.fn((error) => error?.code === 'ERR_CANCELED')
}));

const group = {
  id: 'group-1',
  items: [
    {
      id: 'article-1',
      sourceId: 'source-a',
      source: 'Source A',
      title: 'Article one',
      url: 'https://example.com/one',
      pubDate: '2026-03-07T10:00:00.000Z',
      language: 'en'
    },
    {
      id: 'article-2',
      sourceId: 'source-b',
      source: 'Source B',
      title: 'Article two',
      url: 'https://example.com/two',
      pubDate: '2026-03-07T11:00:00.000Z',
      language: 'en'
    }
  ]
};

const t = (key, params = {}) => {
  if (key === 'readTime') {
    return `${params.minutes} min read`;
  }

  return key;
};

const currentUser = {
  user: { username: 'alice', isAdmin: false },
  settings: {
    readerTextSize: 'medium',
    readerTextWidth: 'default'
  }
};

function buildReaderPanel(props = {}) {
  return (
    <ReaderPanel
      group={group}
      initialArticleId="article-1"
      readerPosition="right"
      t={t}
      currentUser={currentUser}
      onClose={vi.fn()}
      {...props}
    />
  );
}

function renderReaderPanel(props = {}) {
  return render(buildReaderPanel(props));
}

function selectSourceVersion(articleId) {
  fireEvent.change(screen.getByRole('combobox', { name: 'sourceVersions' }), {
    target: { value: articleId }
  });
}

function createReaderPayload(text = 'Body', overrides = {}) {
  return {
    title: 'Reader title',
    language: 'en',
    excerpt: 'Excerpt',
    contentBlocks: [{ type: 'paragraph', text }],
    minutesToRead: 1,
    ...overrides
  };
}

describe('ReaderPanel', () => {
  const originalShare = navigator.share;
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.style.overflow = '';
  });

  afterEach(() => {
    document.body.style.overflow = '';
    navigator.share = originalShare;
    navigator.clipboard = originalClipboard;
    window.localStorage.removeItem('news-flow-reader-text-size');
    window.localStorage.removeItem('news-flow-reader-text-width');
  });

  test('keeps the latest article payload when an older reader request resolves later', async () => {
    const firstRequest = createDeferred();
    const secondRequest = createDeferred();

    fetchReaderArticle
      .mockImplementationOnce(() => firstRequest.promise)
      .mockImplementationOnce(() => secondRequest.promise);

    renderReaderPanel();

    selectSourceVersion('article-2');

    await resolveDeferred(secondRequest, createReaderPayload('Latest body', {
      title: 'Latest reader title',
      excerpt: 'Latest excerpt'
    }));

    expect(await screen.findByText('Latest body')).toBeInTheDocument();
    expect(screen.getByText('Article two')).toBeInTheDocument();

    await resolveDeferred(firstRequest, createReaderPayload('Stale body', {
      title: 'Stale reader title',
      excerpt: 'Stale excerpt'
    }));

    await waitFor(() => {
      expect(screen.getByText('Latest body')).toBeInTheDocument();
      expect(screen.queryByText('Stale body')).not.toBeInTheDocument();
    });
  });

  test('fetches reader content from the backend on open', async () => {
    fetchReaderArticle.mockResolvedValue(createReaderPayload('Cached body', {
      title: 'Backend cached reader title',
      excerpt: 'Cached excerpt',
      minutesToRead: 2
    }));

    renderReaderPanel();

    expect(await screen.findByText('Cached body')).toBeInTheDocument();
    expect(screen.getByText('Article one')).toBeInTheDocument();
    expect(screen.queryByText('Backend cached reader title')).not.toBeInTheDocument();
    const textSizeControls = screen.getByRole('group', { name: 'readerTextSizeSetting' });
    const textWidthControls = screen.getByRole('group', { name: 'readerTextWidthSetting' });
    const headerActions = textSizeControls.parentElement;
    const closeButton = screen.getByRole('button', { name: 'closeReader' });
    expect(headerActions).toHaveClass('ml-auto', 'gap-1.5');
    expect(textWidthControls.nextElementSibling).toBe(textSizeControls);
    expect(textWidthControls).toHaveClass('hidden', 'sm:flex');
    expect(textWidthControls).toHaveTextContent('64ch');
    expect(textSizeControls.nextElementSibling).toBe(closeButton);
    expect(screen.getByRole('combobox', { name: 'sourceVersions' }).parentElement.parentElement).toHaveClass('min-w-0', 'flex-1');
    expect(screen.getByRole('button', { name: 'shareArticle' }).parentElement.parentElement).toHaveClass('shrink-0');
    expect(fetchReaderArticle).toHaveBeenCalledWith('article-1', expect.objectContaining({
      refresh: false
    }));
    expect(fetchReaderArticle).toHaveBeenCalledTimes(1);
  });

  test('shows text-shaped loading feedback while reader content loads', async () => {
    const request = createDeferred();
    fetchReaderArticle.mockReturnValue(request.promise);

    const { container } = renderReaderPanel();

    const loadingStatus = screen.getByRole('status', { name: 'loadingReader' });
    expect(loadingStatus).toHaveClass('animate-pulse');
    expect(loadingStatus.querySelectorAll('.rounded-full')).toHaveLength(8);
    expect(container.querySelector('.border-4')).toBeNull();

    await resolveDeferred(request, createReaderPayload('Loaded body'));
    expect(await screen.findByText('Loaded body')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'loadingReader' })).not.toBeInTheDocument();
  });

  test('ignores malformed reader list blocks without crashing', async () => {
    fetchReaderArticle.mockResolvedValue(createReaderPayload('Visible body', {
      title: 'Reader title',
      excerpt: 'Excerpt',
      contentBlocks: [
        { type: 'paragraph', text: 'Visible body' },
        { type: 'unordered-list', items: null }
      ],
      minutesToRead: 1
    }));

    renderReaderPanel();

    expect(await screen.findByText('Visible body')).toBeInTheDocument();
  });

  test('clears a stale reader error when switching to another article', async () => {
    fetchReaderArticle
      .mockRejectedValueOnce(new Error('Reader failed'))
      .mockResolvedValueOnce(createReaderPayload('Second body', {
        title: 'Second reader title',
        excerpt: 'Cached excerpt',
        minutesToRead: 2
      }));

    renderReaderPanel();

    expect(await screen.findByText('readerUnavailable')).toBeInTheDocument();

    selectSourceVersion('article-2');

    expect(await screen.findByText('Second body')).toBeInTheDocument();
    expect(screen.getByText('Article two')).toBeInTheDocument();
    expect(screen.queryByText('readerUnavailable')).not.toBeInTheDocument();
  });

  test('reuses cached reader content when returning to a source version', async () => {
    fetchReaderArticle
      .mockResolvedValueOnce(createReaderPayload('First body', {
        title: 'First reader title',
        excerpt: 'First excerpt'
      }))
      .mockResolvedValueOnce(createReaderPayload('Second body', {
        title: 'Second reader title',
        excerpt: 'Second excerpt'
      }));

    renderReaderPanel();

    expect(await screen.findByText('First body')).toBeInTheDocument();
    selectSourceVersion('article-2');
    expect(await screen.findByText('Second body')).toBeInTheDocument();
    selectSourceVersion('article-1');

    expect(await screen.findByText('First body')).toBeInTheDocument();
    expect(fetchReaderArticle).toHaveBeenCalledTimes(2);
  });

  test('preserves the selected source version across refreshed group objects', async () => {
    fetchReaderArticle
      .mockResolvedValueOnce(createReaderPayload('First body'))
      .mockResolvedValueOnce(createReaderPayload('Second body'));
    const { rerender } = renderReaderPanel();

    expect(await screen.findByText('First body')).toBeInTheDocument();
    selectSourceVersion('article-2');
    expect(await screen.findByText('Second body')).toBeInTheDocument();

    rerender(buildReaderPanel({
      group: {
        ...group,
        items: group.items.map((item) => ({
          ...item,
          title: `${item.title} refreshed`
        }))
      }
    }));

    expect(screen.getByText('Second body')).toBeInTheDocument();
    expect(screen.getByText('Article two refreshed')).toBeInTheDocument();
    expect(fetchReaderArticle).toHaveBeenCalledTimes(2);
  });

  test('keeps same-source grouped articles selectable as separate versions', async () => {
    fetchReaderArticle
      .mockResolvedValueOnce(createReaderPayload('First body', {
        title: 'First same-source reader title',
        excerpt: 'First excerpt'
      }))
      .mockResolvedValueOnce(createReaderPayload('Second body', {
        title: 'Second same-source reader title',
        excerpt: 'Second excerpt'
      }));

    renderReaderPanel({
      group: {
          ...group,
          items: [
            {
              ...group.items[0],
              id: 'same-source-1',
              sourceId: 'source-a',
              source: 'Source A'
            },
            {
              ...group.items[1],
              id: 'same-source-2',
              sourceId: 'source-a',
              source: 'Source A'
            }
          ]
        },
      initialArticleId: 'same-source-1'
    });

    expect(await screen.findByText('First body')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Source A #1' })).toBeInTheDocument();

    selectSourceVersion('same-source-2');

    expect(await screen.findByText('Second body')).toBeInTheDocument();
    expect(fetchReaderArticle).toHaveBeenNthCalledWith(2, 'same-source-2', expect.objectContaining({
      refresh: false
    }));
  });

  test('keeps many grouped source versions in one compact selector', async () => {
    fetchReaderArticle.mockResolvedValue(createReaderPayload());
    const sixSourceGroup = {
      ...group,
      items: Array.from({ length: 6 }, (_, index) => ({
        id: `similar-article-${index + 1}`,
        sourceId: `source-${index + 1}`,
        source: `Source ${index + 1}`,
        title: `Similar article ${index + 1}`,
        url: `https://example.com/similar-${index + 1}`,
        pubDate: `2026-03-07T1${index}:00:00.000Z`,
        language: 'en'
      }))
    };

    renderReaderPanel({
      group: sixSourceGroup,
      initialArticleId: 'similar-article-1'
    });

    expect(await screen.findByText('Body')).toBeInTheDocument();

    const sourceVersionSelector = screen.getByRole('combobox', { name: 'sourceVersions' });
    expect(sourceVersionSelector).toHaveValue('similar-article-1');
    expect(screen.getAllByRole('option')).toHaveLength(6);

    for (let index = 1; index <= 6; index += 1) {
      expect(screen.getByRole('option', { name: `Source ${index}` })).toBeInTheDocument();
    }
  });

  test('disables unsafe original-source links', async () => {
    fetchReaderArticle.mockResolvedValue(createReaderPayload('Unsafe body', {
      title: 'Unsafe reader title',
      excerpt: 'Unsafe excerpt'
    }));

    renderReaderPanel({
      group: {
          ...group,
          items: [{
            ...group.items[0],
            url: 'javascript:alert(1)'
          }]
        }
    });

    await screen.findByText('Unsafe body');

    expect(screen.queryByRole('link', { name: 'openOriginalSource' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'shareArticle' })).toBeDisabled();
  });

  test('shares the original article url from reader mode', async () => {
    navigator.share = vi.fn().mockResolvedValue(undefined);
    fetchReaderArticle.mockResolvedValue(createReaderPayload());

    renderReaderPanel();

    await screen.findByText('Body');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'shareArticle' }));
    });

    expect(navigator.share).toHaveBeenCalledWith({
      title: 'Article one',
      url: 'https://example.com/one'
    });
  });

  test('updates reader text size and persists it without reloading parent state', async () => {
    fetchReaderArticle.mockResolvedValue(createReaderPayload());
    updateUserSettings.mockResolvedValue({
      settings: {
        ...currentUser.settings,
        readerTextSize: 'large'
      }
    });

    renderReaderPanel();

    await screen.findByText('Body');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'increaseReaderTextSize' }));
    });

    expect(updateUserSettings).toHaveBeenCalledWith({ readerTextSize: 'large' });
    expect(window.localStorage.getItem('news-flow-reader-text-size')).toBe('large');
  });

  test('updates reader text width and persists it without reloading parent state', async () => {
    fetchReaderArticle.mockResolvedValue(createReaderPayload());
    updateUserSettings.mockResolvedValue({
      settings: {
        ...currentUser.settings,
        readerTextWidth: 'wide'
      }
    });

    renderReaderPanel();

    await screen.findByText('Body');
    const textContainer = screen.getByText('Article one').closest('.mx-auto');
    expect(textContainer).toHaveClass('max-w-[64ch]');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'increaseReaderTextWidth' }));
    });

    expect(updateUserSettings).toHaveBeenCalledWith({ readerTextWidth: 'wide' });
    expect(window.localStorage.getItem('news-flow-reader-text-width')).toBe('wide');
    expect(textContainer).toHaveClass('max-w-[72ch]');
    expect(screen.getByRole('group', { name: 'readerTextWidthSetting' })).toHaveTextContent('72ch');
  });

  test('refreshes reader mode and bypasses the cached article payload', async () => {
    fetchReaderArticle
      .mockResolvedValueOnce(createReaderPayload())
      .mockResolvedValueOnce(createReaderPayload('Updated body', {
        title: 'Refreshed reader title',
        excerpt: 'Updated excerpt'
      }));

    renderReaderPanel();

    await screen.findByText('Body');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'refreshReader' }));
    });

    expect(fetchReaderArticle).toHaveBeenNthCalledWith(2, 'article-1', expect.objectContaining({
      refresh: true
    }));
    expect(await screen.findByText('Updated body')).toBeInTheDocument();
    expect(screen.getByText('Article one')).toBeInTheDocument();
  });

  test('keeps stale reader content visible when manual refresh fails', async () => {
    fetchReaderArticle
      .mockResolvedValueOnce(createReaderPayload())
      .mockRejectedValueOnce(new Error('Refresh failed'));

    renderReaderPanel();

    expect(await screen.findByText('Body')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'refreshReader' }));
    });

    expect(screen.getByText('Body')).toBeInTheDocument();
    expect(screen.getByText('readerUnavailable')).toBeInTheDocument();
  });

});
