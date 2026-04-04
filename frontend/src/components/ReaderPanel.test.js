import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReaderPanel from './ReaderPanel';
import { fetchReaderArticle, updateUserSettings } from '../services/api';

jest.mock('../services/api', () => ({
  fetchReaderArticle: jest.fn(),
  updateUserSettings: jest.fn(),
  isRequestCanceled: jest.fn((error) => error?.code === 'ERR_CANCELED')
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

  if (key === 'newsLanguage') {
    return params.language;
  }

  return key;
};

const currentUser = {
  user: { username: 'alice', isAdmin: false },
  settings: {
    readerTextSize: 'medium'
  }
};

describe('ReaderPanel', () => {
  const originalShare = navigator.share;
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    jest.clearAllMocks();
    document.body.style.overflow = '';
  });

  afterEach(() => {
    document.body.style.overflow = '';
    navigator.share = originalShare;
    navigator.clipboard = originalClipboard;
  });

  test('keeps the latest article payload when an older reader request resolves later', async () => {
    const firstRequest = createDeferred();
    const secondRequest = createDeferred();

    fetchReaderArticle
      .mockImplementationOnce(() => firstRequest.promise)
      .mockImplementationOnce(() => secondRequest.promise);

    render(
      <ReaderPanel
        group={group}
        initialArticleId="article-1"
        readerPosition="right"
        locale="en"
        t={t}
        currentUser={currentUser}
        onUserUpdate={jest.fn()}
        onClose={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Source B' }));

    await resolveDeferred(secondRequest, {
      title: 'Latest reader title',
      language: 'en',
      excerpt: 'Latest excerpt',
      contentBlocks: [{ type: 'paragraph', text: 'Latest body' }],
      minutesToRead: 1
    });

    expect(await screen.findByText('Latest reader title')).toBeInTheDocument();

    await resolveDeferred(firstRequest, {
      title: 'Stale reader title',
      language: 'en',
      excerpt: 'Stale excerpt',
      contentBlocks: [{ type: 'paragraph', text: 'Stale body' }],
      minutesToRead: 1
    });

    await waitFor(() => {
      expect(screen.getByText('Latest reader title')).toBeInTheDocument();
      expect(screen.queryByText('Stale reader title')).not.toBeInTheDocument();
    });
  });

  test('applies centered desktop alignment when requested', () => {
    fetchReaderArticle.mockImplementation(() => new Promise(() => {}));

    const { container } = render(
      <ReaderPanel
        group={group}
        initialArticleId="article-1"
        readerPosition="center"
        locale="en"
        t={t}
        currentUser={currentUser}
        onUserUpdate={jest.fn()}
        onClose={jest.fn()}
      />
    );

    expect(container.firstChild).toBeInTheDocument();
    expect(container.querySelector('.lg\\:justify-center')).toBeInTheDocument();
  });

  test('locks body scroll while the reader is open', () => {
    fetchReaderArticle.mockImplementation(() => new Promise(() => {}));

    const { unmount } = render(
      <ReaderPanel
        group={group}
        initialArticleId="article-1"
        readerPosition="right"
        locale="en"
        t={t}
        currentUser={currentUser}
        onUserUpdate={jest.fn()}
        onClose={jest.fn()}
      />
    );

    expect(document.body.style.overflow).toBe('hidden');

    unmount();

    expect(document.body.style.overflow).toBe('');
  });

  test('disables unsafe original-source links', async () => {
    fetchReaderArticle.mockResolvedValue({
      title: 'Unsafe reader title',
      language: 'en',
      excerpt: 'Unsafe excerpt',
      contentBlocks: [{ type: 'paragraph', text: 'Unsafe body' }],
      minutesToRead: 1
    });

    render(
      <ReaderPanel
        group={{
          ...group,
          items: [{
            ...group.items[0],
            url: 'javascript:alert(1)'
          }]
        }}
        initialArticleId="article-1"
        readerPosition="right"
        locale="en"
        t={t}
        currentUser={currentUser}
        onUserUpdate={jest.fn()}
        onClose={jest.fn()}
      />
    );

    await screen.findByText('Unsafe reader title');

    expect(screen.queryByRole('link', { name: 'openOriginalSource' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'shareArticle' })).toBeDisabled();
  });

  test('shares the original article url from reader mode', async () => {
    navigator.share = jest.fn().mockResolvedValue(undefined);
    fetchReaderArticle.mockResolvedValue({
      title: 'Reader title',
      language: 'en',
      excerpt: 'Excerpt',
      contentBlocks: [{ type: 'paragraph', text: 'Body' }],
      minutesToRead: 1
    });

    render(
      <ReaderPanel
        group={group}
        initialArticleId="article-1"
        readerPosition="right"
        locale="en"
        t={t}
        currentUser={currentUser}
        onUserUpdate={jest.fn()}
        onClose={jest.fn()}
      />
    );

    await screen.findByText('Reader title');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'shareArticle' }));
    });

    expect(navigator.share).toHaveBeenCalledWith({
      title: 'Reader title',
      url: 'https://example.com/one'
    });
  });

  test('shows a share status bubble in reader mode when clipboard fallback is used', async () => {
    navigator.share = undefined;
    navigator.clipboard = {
      writeText: jest.fn().mockResolvedValue(undefined)
    };
    fetchReaderArticle.mockResolvedValue({
      title: 'Reader title',
      language: 'en',
      excerpt: 'Excerpt',
      contentBlocks: [{ type: 'paragraph', text: 'Body' }],
      minutesToRead: 1
    });

    render(
      <ReaderPanel
        group={group}
        initialArticleId="article-1"
        readerPosition="right"
        locale="en"
        t={t}
        currentUser={currentUser}
        onUserUpdate={jest.fn()}
        onClose={jest.fn()}
      />
    );

    await screen.findByText('Reader title');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'shareArticle' }));
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://example.com/one');
    expect(screen.getByText('shareCopiedMessage')).toBeInTheDocument();
  });

  test('updates reader text size and persists it without reloading parent state', async () => {
    fetchReaderArticle.mockResolvedValue({
      title: 'Reader title',
      language: 'en',
      excerpt: 'Excerpt',
      contentBlocks: [{ type: 'paragraph', text: 'Body' }],
      minutesToRead: 1
    });
    updateUserSettings.mockResolvedValue({
      settings: {
        ...currentUser.settings,
        readerTextSize: 'large'
      }
    });

    render(
      <ReaderPanel
        group={group}
        initialArticleId="article-1"
        readerPosition="right"
        locale="en"
        t={t}
        currentUser={currentUser}
        onUserUpdate={jest.fn()}
        onClose={jest.fn()}
      />
    );

    await screen.findByText('Reader title');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'increaseReaderTextSize' }));
    });

    expect(updateUserSettings).toHaveBeenCalledWith({ readerTextSize: 'large' });
    expect(window.localStorage.getItem('news-flow-reader-text-size')).toBe('large');
  });
});
