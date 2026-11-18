import { act, fireEvent, render, screen, within } from '@testing-library/react';
import NewsCard from './NewsCard';
import { createTranslator } from '../i18n';
import type { ComponentProps } from 'react';
import type { NewsArticle, NewsGroup } from '../types';

const t = createTranslator('en');

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

function storyAction(label: string) {
  const toggle = screen.getByRole('button', { name: t('storyActions') });
  const popover = document.getElementById(toggle.getAttribute('popovertarget')!)!;
  // jsdom renders popovers but does not implement native light-dismiss or toggling.
  return within(popover).getByText(label, { selector: 'button' });
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

  test('puts the topic before the headline and publisher attribution after it', () => {
    renderNewsCard({ cardGroup: createGroup({ topics: ['Scienza'] }) });
    const headline = screen.getByRole('heading', { name: 'Headline' });
    expect(screen.getByText('Science').compareDocumentPosition(headline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(headline.compareDocumentPosition(screen.getByText('Source A')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Compare/ })).not.toBeInTheDocument();
  });

  test('opens a safe external url in a new tab', () => {
    window.open = vi.fn();

    renderNewsCard({ cardGroup: createGroup({ url: 'https://example.com/story' }) });

    fireEvent.click(storyAction(t('openOriginalSource')));

    expect(window.open).toHaveBeenCalledWith('https://example.com/story', '_blank', 'noopener,noreferrer');
  });

  test('prefers safe static photos, falls back to a bundled cover, and respects the image setting', () => {
    const fallbackCover = () => screen.getByRole('img', { name: t('genericNewsCoverAlt') });
    const bundledCover = expect.stringMatching(/generic-news-cover(?:-[234])?\.webp$/);
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

    expect(fallbackCover()).toHaveAttribute('src', bundledCover);

    rerender(
      createNewsCardElement({
        cardGroup: createGroup({
          id: 'unsafe-image',
          items: [createItem({ image: 'javascript:alert(1)' })]
        })
      })
    );

    expect(fallbackCover()).toHaveAttribute('src', bundledCover);

    rerender(
      createNewsCardElement({
        cardGroup: createGroup({
          id: 'broken-image',
          items: [createItem({ image: 'https://example.com/broken.jpg' })]
        })
      })
    );

    fireEvent.error(screen.getByRole('img', { name: 'Headline' }));

    expect(fallbackCover()).toHaveAttribute('src', bundledCover);
    fireEvent.error(fallbackCover());
    expect(screen.queryByRole('img')).not.toBeInTheDocument();

    rerender(
      createNewsCardElement({
        cardGroup: createGroup({
          id: 'disabled-image',
          items: [createItem({ image: 'https://example.com/image.jpg' })]
        }),
        showImages: false
      })
    );

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  test('names topics in the feed language and preserves AI topic rings without photos', () => {
    const topicGroup = createGroup({
      topicDetails: [
        { topic: 'Tecnologia', source: 'ai' },
        { topic: 'Economia', source: 'canonical' }
      ]
    });
    renderNewsCard({ cardGroup: topicGroup, showImages: false });
    expect(screen.getByText('Technology').closest('[style]')?.getAttribute('style')).toContain('conic-gradient');
    expect(screen.getByText('Economy').closest('[style]')).toBeNull();
  });

  test('renders the published date and time pill', () => {
    renderNewsCard();

    const publishedAt = screen.getByLabelText(/^Published:/);
    expect(publishedAt.tagName).toBe('TIME');
    expect(publishedAt).toHaveAttribute('dateTime', '2026-03-07T10:00:00.000Z');
    expect(publishedAt).toHaveTextContent(/\d/);
  });

  test('compares a headline per publisher and opens the chosen version after a tap, not a swipe', () => {
    const onOpenReader = vi.fn();
    const cardGroup = createGroup({
      items: [
        createItem({ title: 'First angle', sourceIconUrl: 'https://example.com/a.ico' }),
        createItem({ id: 'article-2', title: 'Later update' }),
        createItem({ id: 'article-3', sourceId: 'source-b', source: 'Source B', title: 'Another angle', sourceIconUrl: 'https://example.com/b.ico' }),
        createItem({ id: 'article-4', sourceId: 'source-c', source: 'Source C', title: 'Local angle' })
      ]
    });
    renderNewsCard({ cardGroup, onOpenReader });
    expect(screen.getByText('Source A · Source B')).toBeInTheDocument();
    expect(screen.getAllByAltText('').map(img => img.getAttribute('src'))).toEqual(['https://example.com/a.ico', 'https://example.com/b.ico']);
    const toggle = screen.getByRole('button', { name: 'Compare 3 sources' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    const strip = within(screen.getByRole('region', { name: t('sourceVersions') }));
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(strip.queryByText('Later update')).not.toBeInTheDocument();
    expect(strip.getByRole('button', { name: 'Source C Local angle' })).toBeInTheDocument();
    const other = strip.getByRole('button', { name: 'Source B Another angle' });
    fireEvent.touchStart(other, { touches: [{ clientX: 150, clientY: 50 }] });
    fireEvent.touchEnd(other, { changedTouches: [{ clientX: 40, clientY: 55 }] });
    fireEvent.click(other);
    expect(onOpenReader).not.toHaveBeenCalled();
    fireEvent.touchStart(other, { touches: [{ clientX: 45, clientY: 55 }] });
    fireEvent.touchEnd(other, { changedTouches: [{ clientX: 45, clientY: 55 }] });
    fireEvent.click(other);
    expect(onOpenReader).toHaveBeenCalledWith(cardGroup, 'article-3');
    fireEvent.click(toggle);
    expect(screen.queryByRole('region', { name: t('sourceVersions') })).not.toBeInTheDocument();
  });

  test('surfaces merged same-source versions in the source summary', () => {
    renderNewsCard({
      cardGroup: createGroup({
        items: [
          createItem({ image: 'https://example.com/image.jpg' }),
          createItem({ image: 'https://example.com/image.jpg' }),
          createItem({ id: 'article-2', image: 'https://example.com/image-b.jpg' })
        ]
      })
    });

    expect(screen.getByText('2 articles from Source A')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Compare/ })).not.toBeInTheDocument();
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

    const aiGroupedSourceStack = screen.getByLabelText(t('aiGroupedStory'));
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

    expect(screen.queryByLabelText(t('aiGroupedStory'))).not.toBeInTheDocument();

    rerender(
      createNewsCardElement()
    );

    expect(screen.queryByLabelText(t('aiGroupedStory'))).not.toBeInTheDocument();
  });

  test('toggles read later directly from the card', () => {
    const onToggleReadLater = vi.fn();

    renderNewsCard({ onToggleReadLater });

    fireEvent.click(screen.getByRole('button', { name: t('saveReadLater') }));

    expect(onToggleReadLater).toHaveBeenCalledWith(expect.objectContaining({ id: 'group-1' }));
  });

  test('disables unsafe external links', () => {
    renderNewsCard({ cardGroup: createGroup({ url: 'javascript:alert(1)' }) });

    expect(storyAction(t('openOriginalSource'))).toBeDisabled();
    expect(storyAction(t('shareArticle'))).toBeDisabled();
  });

  test('shows a share status bubble when clipboard fallback is used', async () => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: vi.fn().mockResolvedValue(undefined)
    } });

    renderNewsCard({ cardGroup: createGroup({ url: 'https://example.com/story' }) });

    await act(async () => {
      fireEvent.click(storyAction(t('shareArticle')));
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://example.com/story');
    expect(screen.getByText(t('shareCopiedMessage'))).toBeInTheDocument();
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
    onOpenReader.mockClear();
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000);
    fireEvent.click(screen.getByRole('img', { name: 'Headline' }));

    expect(onOpenReader).toHaveBeenCalledWith(expect.objectContaining({ id: 'group-1' }), 'article-1');
    expect(screen.getAllByTitle(t('readHereHelp'))).toHaveLength(2);
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
