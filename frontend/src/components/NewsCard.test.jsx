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

function createGroup(overrides = {}) {
  return {
    ...group,
    ...overrides,
    items: overrides.items || group.items
  };
}

function createItem(overrides = {}) {
  return {
    id: 'article-1',
    sourceId: 'source-a',
    source: 'Source A',
    ...overrides
  };
}

function createNewsCardElement({ cardGroup = group, ...props } = {}) {
  return (
    <NewsCard
      group={cardGroup}
      locale="en"
      t={t}
      onOpenReader={jest.fn()}
      {...props}
    />
  );
}

function renderNewsCard({ cardGroup = group, ...props } = {}) {
  return render(createNewsCardElement({ cardGroup, ...props }));
}

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

    renderNewsCard({ cardGroup: createGroup({ url: 'https://example.com/story' }) });

    fireEvent.click(screen.getByRole('button', { name: 'openOriginalSource' }));

    expect(window.open).toHaveBeenCalledWith('https://example.com/story', '_blank', 'noopener,noreferrer');
  });

  test('uses safe static covers and falls back when images are unavailable or disabled', () => {
    const { rerender } = renderNewsCard({
      cardGroup: createGroup({
        id: 'safe-image',
        items: [createItem({ image: 'https://example.com/image.jpg' })]
      })
    });

    expect(screen.getByRole('img', { name: 'Headline' })).toHaveAttribute('src', 'https://example.com/image.jpg');

    rerender(
      createNewsCardElement({
        cardGroup: createGroup({
          id: 'gif-image',
          items: [
            createItem({ image: 'https://example.com/animated.gif?width=640' }),
            createItem({
              id: 'article-2',
              sourceId: 'source-b',
              source: 'Source B',
              image: 'https://example.com/static.jpg'
            })
          ]
        })
      })
    );

    expect(screen.getByRole('img', { name: 'Headline' })).toHaveAttribute('src', 'https://example.com/static.jpg');

    rerender(
      createNewsCardElement({ cardGroup: createGroup({ id: 'no-image' }) })
    );

    expect(screen.getByRole('img', { name: 'genericNewsCoverAlt' })).toHaveAttribute('src', expect.stringMatching(/generic-news-cover/));

    rerender(
      createNewsCardElement({
        cardGroup: createGroup({
          id: 'unsafe-image',
          items: [createItem({ image: 'javascript:alert(1)' })]
        })
      })
    );

    expect(screen.getByRole('img', { name: 'genericNewsCoverAlt' })).toHaveAttribute('src', expect.stringMatching(/generic-news-cover/));

    rerender(
      createNewsCardElement({
        cardGroup: createGroup({
          id: 'broken-image',
          items: [createItem({ image: 'https://example.com/broken.jpg' })]
        })
      })
    );

    fireEvent.error(screen.getByRole('img', { name: 'Headline' }));

    expect(screen.getByRole('img', { name: 'genericNewsCoverAlt' })).toHaveAttribute('src', expect.stringMatching(/generic-news-cover/));

    rerender(
      createNewsCardElement({
        cardGroup: createGroup({
          id: 'disabled-image',
          items: [createItem({ image: 'https://example.com/image.jpg' })]
        }),
        showImages: false
      })
    );

    expect(screen.queryByRole('img', { name: 'Headline' })).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'genericNewsCoverAlt' })).not.toBeInTheDocument();
  });

  test('renders icon-only topic pills on standard cards', () => {
    renderNewsCard({ cardGroup: createGroup({ topics: ['Tecnologia', 'Economia'] }) });

    expect(screen.getByLabelText('Technology')).toBeInTheDocument();
    expect(screen.getByLabelText('Economy')).toBeInTheDocument();
    expect(screen.queryByText('Technology')).not.toBeInTheDocument();
    expect(screen.queryByText('Economy')).not.toBeInTheDocument();
  });

  test('renders the published date and time pill', () => {
    renderNewsCard();

    const publishedAt = screen.getByLabelText('publishedAt');
    expect(publishedAt.tagName).toBe('TIME');
    expect(publishedAt).toHaveAttribute('dateTime', '2026-03-07T10:00:00.000Z');
    expect(publishedAt).toHaveTextContent(/\d/);
  });

  test('renders source favicons and a social source summary', () => {
    renderNewsCard({
      cardGroup: createGroup({
        items: [
          createItem({ sourceIconUrl: 'https://example.com/a.ico', image: 'https://example.com/image.jpg' }),
          createItem({
            id: 'article-2',
            sourceId: 'source-b',
            source: 'Source B',
            sourceIconUrl: 'https://example.com/b.ico',
            image: 'https://example.com/image-b.jpg'
          })
        ]
      })
    });

    expect(screen.getByLabelText('Source A')).toBeInTheDocument();
    expect(screen.getByLabelText('Source B')).toBeInTheDocument();
    expect(screen.getByText('Source A +1')).toBeInTheDocument();
    expect(screen.queryByText('Source B')).not.toBeInTheDocument();
  });

  test('surfaces merged same-source versions in the source summary', () => {
    renderNewsCard({
      cardGroup: createGroup({
        items: [
          createItem({ image: 'https://example.com/image.jpg' }),
          createItem({ id: 'article-2', image: 'https://example.com/image-b.jpg' })
        ]
      })
    });

    expect(screen.getByText('Source A +1')).toBeInTheDocument();
  });

  test('shows an AI-grouped badge only for matched AI stories', () => {
    const { rerender } = renderNewsCard({
      cardGroup: createGroup({
        items: [
          createItem({ storyGroupId: 'ai-story-1', aiStoryGroupStatus: 'matched' }),
          createItem({ id: 'article-2', sourceId: 'source-b', source: 'Source B', storyGroupId: 'ai-story-1', aiStoryGroupStatus: 'matched' })
        ]
      })
    });

    expect(screen.getByLabelText('aiGroupedStory')).toBeInTheDocument();

    rerender(
      createNewsCardElement({
        cardGroup: createGroup({
          items: [createItem({ storyGroupId: 'ai-story-1', aiStoryGroupStatus: 'matched' })]
        })
      })
    );

    expect(screen.queryByLabelText('aiGroupedStory')).not.toBeInTheDocument();

    rerender(
      createNewsCardElement()
    );

    expect(screen.queryByLabelText('aiGroupedStory')).not.toBeInTheDocument();
  });

  test('toggles the read-later action from the card header', () => {
    const onToggleReadLater = jest.fn();

    renderNewsCard({ onToggleReadLater });

    fireEvent.click(screen.getByRole('button', { name: 'saveReadLater' }));

    expect(onToggleReadLater).toHaveBeenCalledWith(expect.objectContaining({ id: 'group-1' }));
  });

  test('disables unsafe external links', () => {
    renderNewsCard({ cardGroup: createGroup({ url: 'javascript:alert(1)' }) });

    expect(screen.getByRole('button', { name: 'openOriginalSource' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'openOriginalSource' })).toHaveAttribute('title', 'openOriginalSourceUnavailable');
    expect(screen.getByText('openOriginalSourceUnavailable')).toBeInTheDocument();
  });

  test('uses the native share action when available', async () => {
    navigator.share = jest.fn().mockResolvedValue(undefined);

    renderNewsCard({ cardGroup: createGroup({ url: 'https://example.com/story' }) });

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

    renderNewsCard({ cardGroup: createGroup({ url: 'https://example.com/story' }) });

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

    renderNewsCard({ cardGroup: createGroup({ url: 'https://example.com/story' }) });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'shareArticle' }));
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://example.com/story');
    expect(screen.getByText('shareFailedMessage')).toBeInTheDocument();
  });

  test('opens reader mode on title double click and reader button click', () => {
    const onOpenReader = jest.fn();

    renderNewsCard({
      cardGroup: createGroup({ items: [createItem({ image: 'https://example.com/image.jpg' })] }),
      onOpenReader
    });

    fireEvent.doubleClick(screen.getByText('Headline'));

    expect(onOpenReader).toHaveBeenCalledWith(expect.objectContaining({ id: 'group-1' }), 'article-1');

    onOpenReader.mockClear();
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000);
    fireEvent.click(screen.getByRole('button', { name: 'readerMode' }));

    expect(onOpenReader).toHaveBeenCalledWith(expect.objectContaining({ id: 'group-1' }), 'article-1');
  });

  test('opens reader mode on image double tap but not single tap', () => {
    const onOpenReader = jest.fn();

    renderNewsCard({
      cardGroup: createGroup({ items: [createItem({ image: 'https://example.com/image.jpg' })] }),
      onOpenReader
    });

    const image = screen.getByRole('img', { name: 'Headline' });

    fireEvent.touchEnd(image);
    expect(onOpenReader).not.toHaveBeenCalled();

    fireEvent.touchEnd(image);
    expect(onOpenReader).toHaveBeenCalledWith(expect.objectContaining({ id: 'group-1' }), 'article-1');
  });

});
