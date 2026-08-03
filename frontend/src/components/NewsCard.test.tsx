import { act, fireEvent, render, screen } from '@testing-library/react';
import NewsCard from './NewsCard';
import type { ComponentProps } from 'react';
import type { NewsArticle, NewsGroup, Translator } from '../types';

const t: Translator = (key) => key;

const group: NewsGroup = {
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

function createGroup(overrides: Partial<NewsGroup> = {}): NewsGroup {
  return {
    ...group,
    ...overrides,
    items: overrides.items || group.items
  };
}

function createItem(overrides: Partial<NewsArticle> = {}): NewsArticle {
  return {
    id: 'article-1',
    sourceId: 'source-a',
    source: 'Source A',
    ...overrides
  };
}

type NewsCardTestProps = Partial<Omit<ComponentProps<typeof NewsCard>, 'group'>> & { cardGroup?: NewsGroup };

function createNewsCardElement({ cardGroup = group, ...props }: NewsCardTestProps = {}) {
  return (
    <NewsCard
      group={cardGroup}
      locale="en"
      t={t}
      onOpenReader={vi.fn()}
      {...props}
    />
  );
}

function renderNewsCard({ cardGroup = group, ...props }: NewsCardTestProps = {}) {
  return render(createNewsCardElement({ cardGroup, ...props }));
}

describe('NewsCard', () => {
  const originalShare = navigator.share;
  const originalClipboard = navigator.clipboard;
  const originalWindowOpen = window.open;

  afterEach(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: originalShare });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: originalClipboard });
    window.open = originalWindowOpen;
    vi.restoreAllMocks();
  });

  test('clamps the headline to two lines', () => {
    renderNewsCard();

    expect(screen.getByText('Headline', { selector: 'button' })).toHaveClass('line-clamp-2');
  });

  test('opens a safe external url in a new tab', () => {
    window.open = vi.fn();

    renderNewsCard({ cardGroup: createGroup({ url: 'https://example.com/story' }) });

    const originalSourceButton = screen.getByRole('button', { name: 'openOriginalSource' });
    const readLaterButton = screen.getByRole('button', { name: 'saveReadLater' });

    expect(originalSourceButton).toHaveClass('border-slate-200', 'bg-white', 'text-slate-600');
    expect(originalSourceButton.nextElementSibling).toBe(readLaterButton);
    fireEvent.click(originalSourceButton);

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
    const topicGroup = createGroup({
      topicDetails: [
        { topic: 'Tecnologia', source: 'ai' },
        { topic: 'Economia', source: 'canonical' }
      ]
    });
    const { rerender } = renderNewsCard({ cardGroup: topicGroup });

    const technologyTopic = screen.getByLabelText('Technology');
    expect(technologyTopic).toHaveClass('rounded-full');
    expect(technologyTopic.firstElementChild).toHaveClass('rounded-full');
    expect(technologyTopic.getAttribute('style')).toContain('conic-gradient');
    expect(screen.getByLabelText('Economy')).toHaveClass('rounded-full');
    expect(technologyTopic.parentElement).toHaveClass('-space-x-1');
    expect(screen.queryByText('Technology')).not.toBeInTheDocument();
    expect(screen.queryByText('Economy')).not.toBeInTheDocument();

    rerender(createNewsCardElement({ cardGroup: topicGroup, showImages: false }));

    expect(screen.getByLabelText('Technology')).toBeInTheDocument();
    expect(screen.getByLabelText('Economy')).toBeInTheDocument();
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
    expect(screen.getByLabelText('Source A')).toHaveClass('flex', 'h-10', 'w-10', 'leading-none');
    expect(screen.getByLabelText('Source A').querySelector('img')!.parentElement).toHaveClass('h-10', 'w-10', 'outline-2');
    expect(screen.getByLabelText('Source A').querySelector('img')!.parentElement).not.toHaveClass('border-2');
    expect(screen.getByLabelText('sources')).toHaveClass('rounded-full');
    expect(screen.getByText('Source A +1')).toBeInTheDocument();
    expect(screen.queryByText('Source B')).not.toBeInTheDocument();
  });

  test('limits combined story source circles and keeps overflow in the summary text', () => {
    renderNewsCard({
      cardGroup: createGroup({
        items: [
          createItem({ sourceIconUrl: 'https://example.com/a.ico' }),
          createItem({ id: 'article-2', sourceId: 'source-b', source: 'Source B', sourceIconUrl: 'https://example.com/b.ico' }),
          createItem({ id: 'article-3', sourceId: 'source-c', source: 'Source C', sourceIconUrl: 'https://example.com/c.ico' }),
          createItem({ id: 'article-4', sourceId: 'source-d', source: 'Source D', sourceIconUrl: 'https://example.com/d.ico' })
        ]
      })
    });

    expect(screen.getByLabelText('Source A')).toBeInTheDocument();
    expect(screen.getByLabelText('Source B')).toBeInTheDocument();
    expect(screen.queryByLabelText('Source C')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Source D')).not.toBeInTheDocument();
    expect(screen.getByText('Source A +3')).toBeInTheDocument();
    expect(screen.queryByText('+2')).not.toBeInTheDocument();
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

  test('shows an AI-grouped source border only for matched AI stories', () => {
    const { rerender } = renderNewsCard({
      cardGroup: createGroup({
        items: [
          createItem({ storyGroupId: 'ai-story-1', aiStoryGroupStatus: 'matched' }),
          createItem({ id: 'article-2', sourceId: 'source-b', source: 'Source B', storyGroupId: 'ai-story-1', aiStoryGroupStatus: 'matched' })
        ]
      })
    });

    const aiGroupedSourceStack = screen.getByLabelText('aiGroupedStory');
    expect(aiGroupedSourceStack).toHaveClass('rounded-full');
    expect(aiGroupedSourceStack.firstElementChild).toHaveClass('rounded-full');
    expect(aiGroupedSourceStack.getAttribute('style')).toContain('conic-gradient');

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
    const onToggleReadLater = vi.fn();

    renderNewsCard({ onToggleReadLater });

    fireEvent.click(screen.getByRole('button', { name: 'saveReadLater' }));

    expect(onToggleReadLater).toHaveBeenCalledWith(expect.objectContaining({ id: 'group-1' }));
  });

  test('disables unsafe external links', () => {
    renderNewsCard({ cardGroup: createGroup({ url: 'javascript:alert(1)' }) });

    expect(screen.getByRole('button', { name: 'openOriginalSource' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'openOriginalSource' })).toHaveAttribute('title', 'openOriginalSourceUnavailable');
    expect(screen.queryByText('openOriginalSourceUnavailable')).not.toBeInTheDocument();
  });

  test('shows a share status bubble when clipboard fallback is used', async () => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: vi.fn().mockResolvedValue(undefined)
    } });

    renderNewsCard({ cardGroup: createGroup({ url: 'https://example.com/story' }) });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'shareArticle' }));
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://example.com/story');
    expect(screen.getByText('shareCopiedMessage')).toBeInTheDocument();
  });

  test('opens reader mode on a single title or image click without a separate reader button', () => {
    const onOpenReader = vi.fn();

    renderNewsCard({
      cardGroup: createGroup({ items: [createItem({ image: 'https://example.com/image.jpg' })] }),
      onOpenReader
    });

    fireEvent.click(screen.getByText('Headline'));

    expect(onOpenReader).toHaveBeenCalledWith(expect.objectContaining({ id: 'group-1' }), 'article-1');
    expect(screen.getByText('Headline').compareDocumentPosition(screen.getByRole('img', { name: 'Headline' })) & globalThis.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Headline' }).parentElement).toHaveClass('aspect-video', 'grow');

    onOpenReader.mockClear();
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000);
    fireEvent.click(screen.getByRole('img', { name: 'Headline' }));

    expect(onOpenReader).toHaveBeenCalledWith(expect.objectContaining({ id: 'group-1' }), 'article-1');
    expect(screen.getAllByTitle('readHereHelp')).toHaveLength(2);
  });

  test('opens reader mode after a stationary touch', () => {
    const onOpenReader = vi.fn();

    renderNewsCard({
      cardGroup: createGroup({ items: [createItem({ image: 'https://example.com/image.jpg' })] }),
      onOpenReader
    });

    const image = screen.getByRole('img', { name: 'Headline' });

    fireEvent.touchStart(image, { touches: [{ clientX: 20, clientY: 30 }] });
    fireEvent.touchEnd(image, { changedTouches: [{ clientX: 20, clientY: 30 }] });
    fireEvent.click(image);

    expect(onOpenReader).toHaveBeenCalledWith(expect.objectContaining({ id: 'group-1' }), 'article-1');
  });

  test('does not treat a swipe on the image as a reader click', () => {
    const onOpenReader = vi.fn();

    renderNewsCard({
      cardGroup: createGroup({ items: [createItem({ image: 'https://example.com/image.jpg' })] }),
      onOpenReader
    });

    const image = screen.getByRole('img', { name: 'Headline' });

    fireEvent.touchStart(image, { touches: [{ clientX: 20, clientY: 30 }] });
    fireEvent.touchMove(image, { touches: [{ clientX: 90, clientY: 35 }] });
    fireEvent.touchEnd(image, { changedTouches: [{ clientX: 90, clientY: 35 }] });
    fireEvent.click(image);

    expect(onOpenReader).not.toHaveBeenCalled();
  });

});
