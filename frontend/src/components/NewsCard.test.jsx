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
  const originalWindowOpen = window.open;

  afterEach(() => {
    navigator.share = originalShare;
    navigator.clipboard = originalClipboard;
    window.open = originalWindowOpen;
    jest.restoreAllMocks();
  });

  test('opens a safe external url in a new tab', () => {
    window.open = jest.fn();

    render(
      <NewsCard
        group={{ ...group, url: 'https://example.com/story' }}
        locale="en"
        t={t}
        onOpenReader={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'openOriginalSource' }));

    expect(window.open).toHaveBeenCalledWith('https://example.com/story', '_blank', 'noopener,noreferrer');
  });

  test('uses safe static covers and falls back when images are unavailable or disabled', () => {
    const { rerender } = render(
      <NewsCard
        group={{
          ...group,
          id: 'safe-image',
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

    rerender(
      <NewsCard
        group={{
          ...group,
          id: 'gif-image',
          items: [
            {
              id: 'article-1',
              sourceId: 'source-a',
              source: 'Source A',
              image: 'https://example.com/animated.gif?width=640'
            },
            {
              id: 'article-2',
              sourceId: 'source-b',
              source: 'Source B',
              image: 'https://example.com/static.jpg'
            }
          ]
        }}
        locale="en"
        t={t}
        onOpenReader={jest.fn()}
      />
    );

    expect(screen.getByRole('img', { name: 'Headline' })).toHaveAttribute('src', 'https://example.com/static.jpg');

    rerender(
      <NewsCard
        group={{ ...group, id: 'no-image' }}
        locale="en"
        t={t}
        onOpenReader={jest.fn()}
      />
    );

    expect(screen.getByRole('img', { name: 'genericNewsCoverAlt' })).toHaveAttribute('src', expect.stringMatching(/generic-news-cover/));

    rerender(
      <NewsCard
        group={{
          ...group,
          id: 'unsafe-image',
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

    expect(screen.getByRole('img', { name: 'genericNewsCoverAlt' })).toHaveAttribute('src', expect.stringMatching(/generic-news-cover/));

    rerender(
      <NewsCard
        group={{
          ...group,
          id: 'broken-image',
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

    fireEvent.error(screen.getByRole('img', { name: 'Headline' }));

    expect(screen.getByRole('img', { name: 'genericNewsCoverAlt' })).toHaveAttribute('src', expect.stringMatching(/generic-news-cover/));

    rerender(
      <NewsCard
        group={{
          ...group,
          id: 'disabled-image',
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
    expect(screen.queryByRole('img', { name: 'genericNewsCoverAlt' })).not.toBeInTheDocument();
  });

  test('renders icon-only topic pills on standard cards', () => {
    render(
      <NewsCard
        group={{ ...group, topics: ['Tecnologia', 'Economia'] }}
        locale="en"
        t={t}
        onOpenReader={jest.fn()}
      />
    );

    expect(screen.getByLabelText('Technology')).toBeInTheDocument();
    expect(screen.getByLabelText('Economy')).toBeInTheDocument();
    expect(screen.queryByText('Technology')).not.toBeInTheDocument();
    expect(screen.queryByText('Economy')).not.toBeInTheDocument();
  });

  test('renders source favicons and a social source summary', () => {
    render(
      <NewsCard
        group={{
          ...group,
          items: [
            {
              id: 'article-1',
              sourceId: 'source-a',
              source: 'Source A',
              sourceIconUrl: 'https://example.com/a.ico',
              image: 'https://example.com/image.jpg'
            },
            {
              id: 'article-2',
              sourceId: 'source-b',
              source: 'Source B',
              sourceIconUrl: 'https://example.com/b.ico',
              image: 'https://example.com/image-b.jpg'
            }
          ]
        }}
        locale="en"
        t={t}
        onOpenReader={jest.fn()}
      />
    );

    expect(screen.getByLabelText('Source A')).toBeInTheDocument();
    expect(screen.getByLabelText('Source B')).toBeInTheDocument();
    expect(screen.getByText('Source A +1')).toBeInTheDocument();
    expect(screen.queryByText('Source B')).not.toBeInTheDocument();
  });

  test('surfaces merged same-source versions in the source summary', () => {
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
            },
            {
              id: 'article-2',
              sourceId: 'source-a',
              source: 'Source A',
              image: 'https://example.com/image-b.jpg'
            }
          ]
        }}
        locale="en"
        t={t}
        onOpenReader={jest.fn()}
      />
    );

    expect(screen.getByText('Source A +1')).toBeInTheDocument();
  });

  test('shows an AI-grouped badge only for matched AI stories', () => {
    const { rerender } = render(
      <NewsCard
        group={{
          ...group,
          items: [
            {
              id: 'article-1',
              sourceId: 'source-a',
              source: 'Source A',
              storyGroupId: 'ai-story-1',
              aiStoryGroupStatus: 'matched'
            },
            {
              id: 'article-2',
              sourceId: 'source-b',
              source: 'Source B',
              storyGroupId: 'ai-story-1',
              aiStoryGroupStatus: 'matched'
            }
          ]
        }}
        locale="en"
        t={t}
        onOpenReader={jest.fn()}
      />
    );

    expect(screen.getByLabelText('aiGroupedStory')).toBeInTheDocument();

    rerender(
      <NewsCard
        group={group}
        locale="en"
        t={t}
        onOpenReader={jest.fn()}
      />
    );

    expect(screen.queryByLabelText('aiGroupedStory')).not.toBeInTheDocument();
  });

  test('toggles the read-later action from the card header', () => {
    const onToggleReadLater = jest.fn();

    render(
      <NewsCard
        group={group}
        locale="en"
        t={t}
        onOpenReader={jest.fn()}
        onToggleReadLater={onToggleReadLater}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'saveReadLater' }));

    expect(onToggleReadLater).toHaveBeenCalledWith(expect.objectContaining({ id: 'group-1' }));
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

    expect(screen.getByRole('button', { name: 'openOriginalSource' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'openOriginalSource' })).toHaveAttribute('title', 'openOriginalSourceUnavailable');
    expect(screen.getByText('openOriginalSourceUnavailable')).toBeInTheDocument();
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

  test('shows a share failure bubble when clipboard fallback is denied', async () => {
    navigator.share = undefined;
    navigator.clipboard = {
      writeText: jest.fn().mockRejectedValue(new Error('denied'))
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
    expect(screen.getByText('shareFailedMessage')).toBeInTheDocument();
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

});
