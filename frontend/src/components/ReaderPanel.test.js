import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReaderPanel from './ReaderPanel';
import { fetchReaderArticle } from '../services/api';

jest.mock('../services/api', () => ({
  fetchReaderArticle: jest.fn(),
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

describe('ReaderPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
        onClose={jest.fn()}
      />
    );

    expect(container.firstChild).toBeInTheDocument();
    expect(container.querySelector('.lg\\:justify-center')).toBeInTheDocument();
  });
});
