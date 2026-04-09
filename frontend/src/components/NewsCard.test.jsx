import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import NewsCard from './NewsCard';

const t = (key) => key;

const group = {
  id: 'group-1',
  title: 'Headline',
  pubDate: '2026-03-07T10:00:00.000Z',
  topics: [],
  items: [
    {
      id: 'article-1',
      sourceId: 'source-a',
      source: 'Source A'
    }
  ]
};

describe('NewsCard', () => {
  const originalShare = navigator.share;
  const originalClipboard = navigator.clipboard;

  afterEach(() => {
    navigator.share = originalShare;
    navigator.clipboard = originalClipboard;
    jest.restoreAllMocks();
  });

  test('renders a safe external link for http urls', () => {
    render(
      <NewsCard
        group={{ ...group, url: 'https://example.com/story' }}
        locale="en"
        t={t}
        onOpenReader={jest.fn()}
      />
    );

    expect(screen.getByRole('link', { name: 'openOriginalSource' })).toHaveAttribute('href', 'https://example.com/story');
  });

  test('renders the first safe article image in the card', () => {
    render(
      <NewsCard
        group={{
          ...group,
          items: [
            {
              id: 'article-1',
              sourceId: 'source-a',
              source: 'Source A',
              image: 'https://example.com/image.jpg'
            }
          ]
        }}
        locale="en"
        t={t}
        onOpenReader={jest.fn()}
      />
    );

    expect(screen.getByRole('img', { name: 'Headline' })).toHaveAttribute('src', 'https://example.com/image.jpg');
  });

  test('does not render images when card images are disabled', () => {
    render(
      <NewsCard
        group={{
          ...group,
          items: [
            {
              id: 'article-1',
              sourceId: 'source-a',
              source: 'Source A',
              image: 'https://example.com/image.jpg'
            }
          ]
        }}
        showImages={false}
        locale="en"
        t={t}
        onOpenReader={jest.fn()}
      />
    );

    expect(screen.queryByRole('img', { name: 'Headline' })).not.toBeInTheDocument();
  });

  test('renders a generic fallback illustration when the article has no image', () => {
    render(
      <NewsCard
        group={group}
        locale="en"
        t={t}
        onOpenReader={jest.fn()}
      />
    );

    expect(screen.getByRole('img', { name: 'genericNewsCoverAlt' })).toHaveAttribute('src', expect.stringMatching(/generic-news-cover|^data:image\/svg\+xml/));
  });

  test('falls back to the generic illustration for unsafe or broken article images', () => {
    const { rerender } = render(
      <NewsCard
        group={{
          ...group,
          items: [
            {
              id: 'article-1',
              sourceId: 'source-a',
              source: 'Source A',
              image: 'javascript:alert(1)'
            }
          ]
        }}
        locale="en"
        t={t}
        onOpenReader={jest.fn()}
      />
    );

    expect(screen.getByRole('img', { name: 'genericNewsCoverAlt' })).toHaveAttribute('src', expect.stringMatching(/generic-news-cover|^data:image\/svg\+xml/));

    rerender(
      <NewsCard
        group={{
          ...group,
          items: [
            {
              id: 'article-1',
              sourceId: 'source-a',
              source: 'Source A',
              image: 'https://example.com/broken.jpg'
            }
          ]
        }}
        locale="en"
        t={t}
        onOpenReader={jest.fn()}
      />
    );

    const image = screen.getByRole('img', { name: 'Headline' });
    fireEvent.error(image);

    expect(screen.getByRole('img', { name: 'genericNewsCoverAlt' })).toHaveAttribute('src', expect.stringMatching(/generic-news-cover|^data:image\/svg\+xml/));
  });

  test('disables unsafe external links', () => {
    render(
      <NewsCard
        group={{ ...group, url: 'javascript:alert(1)' }}
        locale="en"
        t={t}
        onOpenReader={jest.fn()}
      />
    );

    expect(screen.queryByRole('link', { name: 'openOriginalSource' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'openOriginalSource' })).toBeDisabled();
  });

  test('uses the native share action when available', async () => {
    navigator.share = jest.fn().mockResolvedValue(undefined);

    render(
      <NewsCard
        group={{ ...group, url: 'https://example.com/story' }}
        locale="en"
        t={t}
        onOpenReader={jest.fn()}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'shareArticle' }));
    });

    expect(navigator.share).toHaveBeenCalledWith({
      title: 'Headline',
      url: 'https://example.com/story'
    });
  });

  test('shows a share status bubble when clipboard fallback is used', async () => {
    navigator.share = undefined;
    navigator.clipboard = {
      writeText: jest.fn().mockResolvedValue(undefined)
    };

    render(
      <NewsCard
        group={{ ...group, url: 'https://example.com/story' }}
        locale="en"
        t={t}
        onOpenReader={jest.fn()}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'shareArticle' }));
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://example.com/story');
    expect(screen.getByText('shareCopiedMessage')).toBeInTheDocument();
  });

  test('opens reader mode on title double click and reader button click', () => {
    const onOpenReader = jest.fn();

    render(
      <NewsCard
        group={{
          ...group,
          items: [
            {
              id: 'article-1',
              sourceId: 'source-a',
              source: 'Source A',
              image: 'https://example.com/image.jpg'
            }
          ]
        }}
        locale="en"
        t={t}
        onOpenReader={onOpenReader}
      />
    );

    fireEvent.doubleClick(screen.getByText('Headline'));

    expect(onOpenReader).toHaveBeenCalledWith(expect.objectContaining({ id: 'group-1' }), 'article-1');

    onOpenReader.mockClear();
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000);
    fireEvent.click(screen.getByRole('button', { name: 'readerMode' }));

    expect(onOpenReader).toHaveBeenCalledWith(expect.objectContaining({ id: 'group-1' }), 'article-1');
  });

  test('opens reader mode on image double tap but not single tap', () => {
    const onOpenReader = jest.fn();

    render(
      <NewsCard
        group={{
          ...group,
          items: [
            {
              id: 'article-1',
              sourceId: 'source-a',
              source: 'Source A',
              image: 'https://example.com/image.jpg'
            }
          ]
        }}
        locale="en"
        t={t}
        onOpenReader={onOpenReader}
      />
    );

    const image = screen.getByRole('img', { name: 'Headline' });

    fireEvent.touchEnd(image);
    expect(onOpenReader).not.toHaveBeenCalled();

    fireEvent.touchEnd(image);
    expect(onOpenReader).toHaveBeenCalledWith(expect.objectContaining({ id: 'group-1' }), 'article-1');
  });

  test('renders the compact horizontal layout while preserving actions', () => {
    const { container } = render(
      <NewsCard
        group={{
          ...group,
          url: 'https://example.com/story',
          items: [
            {
              id: 'article-1',
              sourceId: 'source-a',
              source: 'Source A',
              image: 'https://example.com/image.jpg'
            }
          ]
        }}
        compact
        locale="en"
        t={t}
        onOpenReader={jest.fn()}
      />
    );

    expect(container.firstChild).toHaveClass('flex-row');
    expect(screen.getByRole('button', { name: 'shareArticle' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'readerMode' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'openOriginalSource' })).toHaveAttribute('href', 'https://example.com/story');
  });
});
