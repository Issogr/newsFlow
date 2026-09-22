import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createTranslator } from '../i18n';
import ThematicSummaryStories from './ThematicSummaryStories';
import ThematicSummaryPanel from './ThematicSummaryPanel';
import type { ComponentProps } from 'react';
import type { ThematicSummary } from '../types';

const t = createTranslator('en');

function renderSummaryPanel(summary: ThematicSummary, propsOverrides: Partial<ComponentProps<typeof ThematicSummaryPanel>> = {}) {
  return render(
    <ThematicSummaryPanel
      summary={summary}
      locale="en"
      t={t}
      onClose={vi.fn()}
      {...propsOverrides}
    />
  );
}

function mockSummarySwipeViewport(matches: boolean) {
  vi.stubGlobal('matchMedia', vi.fn((query) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn()
  })));
}

function createTopicSummary(topicKey: string, overrides: Partial<ThematicSummary> = {}): ThematicSummary {
  const topicLabel = topicKey.charAt(0).toUpperCase() + topicKey.slice(1);

  return {
    id: `summary-${topicKey}`,
    topicKey,
    topicLabel,
    summaryTextByLocale: { en: `${topicLabel} summary` },
    ...overrides
  };
}

describe('thematic summary UI', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.removeItem('news-flow-reader-text-size');
    window.localStorage.removeItem('news-flow-reader-text-width');
  });

  test('shows topic stories in order and opens the selected item', () => {
    const onOpenSummary = vi.fn();
    const science = createTopicSummary('science');
    const technology = {
      id: 'summary-technology',
      topicKey: 'technology',
      topicLabel: 'Technology',
      topics: ['Tecnologia'],
      summaryTextByLocale: { en: 'Technology summary' }
    };

    render(
      <ThematicSummaryStories
        summaries={[technology, science]}
        locale="en"
        readSummaryIds={[]}
        t={t}
        onOpenSummary={onOpenSummary}
      />
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveAccessibleName('Open Technology summary');
    expect(buttons[1]).toHaveAccessibleName('Open Science summary');
    expect(buttons[0].getAttribute('style')).toContain('conic-gradient');
    expect(screen.getAllByTestId('thematic-summary-new-dot')).toHaveLength(2);

    fireEvent.click(buttons[0]);

    expect(onOpenSummary).toHaveBeenCalledWith(technology);
  });

  test('keeps the summary rainbow ring after summaries are read', () => {
    const science = createTopicSummary('science');
    const technology = createTopicSummary('technology');

    render(
      <ThematicSummaryStories
        summaries={[technology, science]}
        locale="en"
        readSummaryIds={[technology.id, science.id]}
        t={t}
        onOpenSummary={vi.fn()}
      />
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveClass('rounded-full');
    expect(buttons[0].firstElementChild).toHaveClass('rounded-full');
    expect(buttons[0].getAttribute('style')).toContain('conic-gradient');
    expect(buttons[1].getAttribute('style')).toContain('conic-gradient');
    expect(screen.queryAllByTestId('thematic-summary-new-dot')).toHaveLength(0);
  });

  test('uses single newlines as paragraph breaks for thematic summaries', () => {
    renderSummaryPanel({
      id: 'summary-technology',
      topicKey: 'technology',
      topicLabel: 'Technology',
      periodStart: '2026-05-21T05:00:00.000Z',
      periodEnd: '2026-05-21T11:00:00.000Z',
      articleCount: 2,
      summaryTextByLocale: {
        en: 'The first argument covers chip supply and infrastructure.\nThe second argument moves to software policy and regulation.'
      }
    });

    expect(screen.queryByText('Lunch time')).not.toBeInTheDocument();
    expect(screen.getByText('The first argument covers chip supply and infrastructure.')).toBeInTheDocument();
    expect(screen.getByText('The second argument moves to software policy and regulation.')).toBeInTheDocument();
  });

  test('ignores previous thematic summary payloads', () => {
    renderSummaryPanel({
      id: 'summary-technology-current',
      topicKey: 'technology',
      topicLabel: 'Technology',
      articleCount: 2,
      summaryTextByLocale: { en: 'Current technology briefing [1].' },
      sources: [{ index: 1, source: 'Current News', url: 'https://example.com/current' }],
      previousSummary: {
        id: 'summary-technology-previous',
        topicKey: 'technology',
        topicLabel: 'Technology',
        articleCount: 1,
        summaryTextByLocale: { en: 'Previous technology briefing [1].' },
        sources: [{ index: 1, source: 'Previous News', url: 'https://example.com/previous' }]
      }
    });

    expect(screen.getByText(/Current technology briefing/u)).toBeInTheDocument();
    expect(screen.queryByText('Lunch time')).not.toBeInTheDocument();
    expect(screen.queryByText(/Previous technology briefing/u)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Today' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Yesterday' })).not.toBeInTheDocument();
  });

  test.each(['en', 'it'] as const)('shows the localized generation timestamp even when the briefing is stale (%s)', (locale) => {
    const translated = createTranslator(locale);
    const summary = createTopicSummary('science', {
      isStale: true,
      articleCount: 2,
      periodStart: '2026-09-20T18:00:00.000Z',
      periodEnd: '2026-09-21T18:00:00.000Z',
      generatedAt: '2026-09-21T18:05:00.000Z',
      lastAttemptAt: '2026-09-21T19:00:00.000Z'
    });
    const { container } = renderSummaryPanel(summary, { locale, t: translated });
    const timestamps = container.querySelectorAll('time');
    expect(timestamps).toHaveLength(1);
    expect(timestamps[0]).toHaveAttribute('datetime', summary.generatedAt);
    expect(timestamps[0]).toHaveTextContent(new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium', timeStyle: 'short'
    }).format(new Date(summary.generatedAt!)));
    expect(screen.getByText(translated('summaryArticleCount', { count: 2 }))).toBeInTheDocument();
    expect(screen.queryByText(locale === 'en' ? 'Evening' : 'Sera')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  test('shows text-shaped loading feedback while a thematic summary opens', () => {
    vi.useFakeTimers();

    try {
      renderSummaryPanel(createTopicSummary('technology'), {
        showOpeningSkeleton: true
      });

      const loadingStatus = screen.getByRole('status', { name: 'Loading AI summary...' });
      expect(loadingStatus).toHaveClass('animate-pulse');
      expect(loadingStatus.querySelectorAll('.rounded-full')).toHaveLength(8);
      expect(screen.queryByText('Technology summary')).not.toBeInTheDocument();

      act(() => vi.advanceTimersByTime(500));

      expect(screen.queryByRole('status', { name: 'Loading AI summary...' })).not.toBeInTheDocument();
      expect(screen.getByText('Technology summary')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  test('uses reader sizing and direct circular source links', () => {
    window.localStorage.setItem('news-flow-reader-text-size', 'large');

    renderSummaryPanel({
      id: 'summary-technology',
      topicKey: 'technology',
      topicLabel: 'Technology',
      summaryTextByLocale: { en: 'Chip demand increased sharply [1]. Another claim followed [2].' },
      sources: [
        { index: 1, source: 'Example News', url: 'https://example.com/story' },
        { index: 2, source: 'Unsafe Source', url: 'javascript:alert(1)' }
      ]
    });

    const paragraph = screen.getByText(/Chip demand increased sharply/u);
    const sourceLink = screen.getByRole('link', { name: 'Open source article: Example News' });
    const decreaseTextSizeButton = screen.getByRole('button', { name: 'Decrease reader text size' });
    const increaseTextWidthButton = screen.getByRole('button', { name: 'Increase reader text width' });
    const summaryFrame = paragraph.closest('article')!.parentElement;

    expect(summaryFrame).toHaveClass('max-w-[64ch]');
    expect(paragraph.parentElement).toHaveClass('text-[1.18rem]', 'leading-[1.65]');
    const textWidthControls = screen.getByRole('group', { name: 'Text width' });
    const textSizeControls = screen.getByRole('group', { name: 'Text size' });
    expect(textWidthControls.parentElement).toHaveClass('ml-auto', 'gap-1.5');
    expect(textWidthControls).toHaveClass('hidden', 'sm:flex');
    expect(textWidthControls.nextElementSibling).toBe(textSizeControls);
    const summaryHeadings = screen.getAllByRole('heading', { name: 'Technology' });
    expect(summaryHeadings.some((heading) => !heading.classList.contains('sr-only'))).toBe(true);
    expect(sourceLink).toHaveAttribute('href', 'https://example.com/story');
    expect(sourceLink).toHaveAttribute('target', '_blank');
    expect(sourceLink).toHaveClass('h-5', 'w-5', 'rounded-full');
    expect(screen.getByRole('img', { name: 'Unsafe Source' })).toHaveClass('rounded-full');
    expect(screen.queryByRole('link', { name: 'Open source article: Unsafe Source' })).not.toBeInTheDocument();
    expect(screen.queryByText('[1]')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sources' })).not.toBeInTheDocument();

    fireEvent.click(decreaseTextSizeButton);

    expect(paragraph.parentElement).toHaveClass('text-[1.08rem]', 'leading-[1.65]');
    expect(window.localStorage.getItem('news-flow-reader-text-size')).toBe('medium');

    fireEvent.click(increaseTextWidthButton);
    fireEvent.click(increaseTextWidthButton);

    expect(summaryFrame).toHaveClass('max-w-[80ch]');
    expect(window.localStorage.getItem('news-flow-reader-text-width')).toBe('widest');
    expect(textWidthControls).toHaveTextContent('80ch');
  });

  test('switches to the next thematic summary with a mobile left swipe', () => {
    mockSummarySwipeViewport(true);
    const onSelectSummary = vi.fn();
    const technology = createTopicSummary('technology');
    const politics = createTopicSummary('politics');

    renderSummaryPanel(technology, {
      summaries: [technology, politics],
      onSelectSummary
    });

    const article = screen.getByRole('article');
    fireEvent.touchStart(article, { touches: [{ clientX: 240, clientY: 120 }] });
    fireEvent.touchEnd(article, { changedTouches: [{ clientX: 100, clientY: 128 }] });

    expect(onSelectSummary).toHaveBeenCalledWith(politics);
  });

  test('moves the summary card while a mobile swipe is in progress', async () => {
    mockSummarySwipeViewport(true);
    const technology = createTopicSummary('technology');
    const politics = createTopicSummary('politics');

    renderSummaryPanel(technology, {
      summaries: [technology, politics],
      onSelectSummary: vi.fn()
    });

    const article = screen.getByRole('article');
    const swipeFrame = screen.getByTestId('thematic-summary-swipe-frame');

    fireEvent.touchStart(article, { touches: [{ clientX: 240, clientY: 120 }] });
    fireEvent.touchMove(article, { touches: [{ clientX: 100, clientY: 128 }] });

    await waitFor(() => {
      expect(swipeFrame.style.transform).toBe('translate3d(-49px, 0, 0)');
    });

    fireEvent.touchEnd(article, { changedTouches: [{ clientX: 100, clientY: 128 }] });

    expect(swipeFrame.style.transform).toBe('translate3d(0px, 0, 0)');
  });

  test('does not switch summaries from a desktop viewport swipe', () => {
    mockSummarySwipeViewport(false);
    const onSelectSummary = vi.fn();
    const technology = createTopicSummary('technology');
    const politics = createTopicSummary('politics');

    renderSummaryPanel(technology, {
      summaries: [technology, politics],
      onSelectSummary
    });

    const article = screen.getByRole('article');
    fireEvent.touchStart(article, { touches: [{ clientX: 240, clientY: 120 }] });
    fireEvent.touchEnd(article, { changedTouches: [{ clientX: 100, clientY: 128 }] });

    expect(onSelectSummary).not.toHaveBeenCalled();
  });
});
