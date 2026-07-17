import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createTranslator } from '../i18n';
import { createPodcastSummary } from '../test-utils/thematicSummaries';
import ThematicSummaryStories from './ThematicSummaryStories';
import ThematicSummaryPanel from './ThematicSummaryPanel';

const t = createTranslator('en');

function renderSummaryPanel(summary, propsOverrides = {}) {
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

function renderPodcastPanel(summaryOverrides = {}, propsOverrides = {}) {
  return renderSummaryPanel(createPodcastSummary(summaryOverrides), propsOverrides);
}

function mockSummarySwipeViewport(matches) {
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

function createTopicSummary(topicKey, overrides = {}) {
  const topicLabel = topicKey.charAt(0).toUpperCase() + topicKey.slice(1);

  return {
    id: `summary-${topicKey}`,
    topicKey,
    topicLabel,
    summaryTextByLocale: { en: `${topicLabel} summary` },
    ...overrides
  };
}

describe('thematic summary podcast UI', () => {
  beforeEach(() => {
    HTMLMediaElement.prototype.load = vi.fn();
    HTMLMediaElement.prototype.pause = vi.fn();
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.removeItem('news-flow-reader-text-size');
    window.localStorage.removeItem('news-flow-reader-text-width');
  });

  test('places the podcast story first and opens the selected item', () => {
    const onOpenSummary = vi.fn();
    const podcast = {
      ...createPodcastSummary(),
      topicKey: 'podcast',
      topicLabel: 'Podcast',
      titleByLocale: { en: 'News podcast' },
      summaryTextByLocale: { en: 'Podcast script' }
    };
    const olderPodcast = {
      ...podcast,
      id: 'podcast-older'
    };
    const technology = {
      id: 'summary-technology',
      topicKey: 'technology',
      topicLabel: 'Technology',
      topics: ['Tecnologia'],
      summaryTextByLocale: { en: 'Technology summary' }
    };

    render(
      <ThematicSummaryStories
        summaries={[technology, podcast, olderPodcast]}
        locale="en"
        readSummaryIds={[]}
        t={t}
        onOpenSummary={onOpenSummary}
      />
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveAccessibleName('Open podcast briefing');
    expect(buttons[0].getAttribute('style')).toContain('conic-gradient');
    expect(screen.getAllByTestId('thematic-summary-new-dot')).toHaveLength(2);

    fireEvent.click(buttons[0]);

    expect(onOpenSummary).toHaveBeenCalledWith(podcast);
  });

  test('keeps the summary rainbow ring after summaries are read', () => {
    const podcast = createPodcastSummary({ id: 'podcast-current' });
    const olderPodcast = createPodcastSummary({ id: 'podcast-older' });
    const technology = createTopicSummary('technology');

    render(
      <ThematicSummaryStories
        summaries={[technology, podcast, olderPodcast]}
        locale="en"
        readSummaryIds={[technology.id, podcast.id, olderPodcast.id]}
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

  test('renders custom podcast audio controls without script text and starts playback', async () => {
    renderPodcastPanel({
      generatedAt: '2026-05-21T06:15:00.000Z',
      audioByLocale: {
        en: {
          audioStatus: 'completed',
          audioUrl: '/api/podcast-summary/podcast-1/audio?locale=en'
        }
      },
      audioStatus: 'completed',
      audioUrl: '/api/podcast-summary/podcast-1/audio?locale=en'
    });

    expect(screen.getByText('Podcast briefing')).toBeInTheDocument();
    expect(screen.getByText('Morning podcast')).toBeInTheDocument();
    expect(screen.queryByText('Podcast audio is available in Italian.')).not.toBeInTheDocument();
    expect(screen.getByText('Audio in English')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Generated /u)).toHaveAttribute('dateTime', '2026-05-21T06:15:00.000Z');
    expect(screen.queryByText('Audio briefing')).not.toBeInTheDocument();
    expect(screen.queryByText('Podcast del mattino')).not.toBeInTheDocument();
    const audio = document.querySelector('audio');
    Object.defineProperty(audio, 'duration', { configurable: true, value: 2 });
    fireEvent.loadedMetadata(audio);

    expect(screen.queryByText('Testo podcast italiano')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('0:00 / 0:02')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Play podcast audio' })).toBeInTheDocument();
    expect(screen.getByLabelText('Seek podcast audio')).toBeInTheDocument();
    expect(audio?.getAttribute('src')).toBe('/api/podcast-summary/podcast-1/audio?locale=en');
    expect(audio?.getAttribute('preload')).toBe('metadata');

    fireEvent.click(screen.getByRole('button', { name: 'Play podcast audio' }));

    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
  });

  test('shows available podcast audio language when current locale audio is missing', () => {
    renderPodcastPanel({
      audioByLocale: {
        en: {
          audioStatus: 'completed',
          audioUrl: '/api/podcast-summary/podcast-1/audio?locale=en'
        }
      }
    }, { locale: 'it' });

    expect(screen.getByText('Podcast audio is available in inglese.')).toBeInTheDocument();
    expect(screen.getByText('Audio in inglese')).toBeInTheDocument();
    expect(screen.queryByText('Testo podcast italiano')).not.toBeInTheDocument();
    expect(document.querySelector('audio')?.getAttribute('src')).toBe('/api/podcast-summary/podcast-1/audio?locale=en');
  });

  test('shows podcast audio generation feedback while audio is pending', () => {
    renderPodcastPanel({
      generatedAt: '2026-05-21T06:15:00.000Z',
      audioStatus: 'generating'
    });

    expect(screen.getByText('Audio generation is in progress. This panel will update when it is ready.')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Generated /u)).toHaveAttribute('dateTime', '2026-05-21T06:15:00.000Z');
    expect(screen.queryByRole('button', { name: 'Play podcast audio' })).not.toBeInTheDocument();
  });

  test('shows the podcast generation date when audio generation failed', () => {
    renderPodcastPanel({
      generatedAt: '2026-05-21T06:15:00.000Z',
      status: 'failed'
    });

    expect(screen.getByText('Audio generation failed for this briefing.')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Generated /u)).toHaveAttribute('dateTime', '2026-05-21T06:15:00.000Z');
    expect(screen.queryByRole('button', { name: 'Play podcast audio' })).not.toBeInTheDocument();
  });

  test('shows morning and evening podcast players together', () => {
    const morningPodcast = createPodcastSummary({
      id: 'podcast-morning',
      periodStart: '2026-05-20T17:00:00.000Z',
      periodEnd: '2026-05-21T05:00:00.000Z',
      titleByLocale: { en: 'Morning podcast' },
      summaryTextByLocale: { en: 'Morning script' },
      audioStatus: 'completed',
      audioUrl: '/api/podcast-summary/podcast-morning/audio'
    });
    const eveningPodcast = createPodcastSummary({
      id: 'podcast-evening',
      periodStart: '2026-05-21T05:00:00.000Z',
      periodEnd: '2026-05-21T17:00:00.000Z',
      articleCount: 3,
      titleByLocale: { en: 'Evening podcast' },
      summaryTextByLocale: { en: 'Evening script' },
      audioStatus: 'completed',
      audioUrl: '/api/podcast-summary/podcast-evening/audio'
    });

    renderSummaryPanel(eveningPodcast, {
      summaries: [eveningPodcast, morningPodcast]
    });

    expect(screen.getByText('Morning podcast')).toBeInTheDocument();
    expect(screen.getByText('Evening podcast')).toBeInTheDocument();
    expect(screen.queryByText('Morning script')).not.toBeInTheDocument();
    expect(screen.queryByText('Evening script')).not.toBeInTheDocument();
    expect(document.querySelectorAll('audio')).toHaveLength(2);
  });

  test('uses single newlines as paragraph breaks for thematic summaries', () => {
    renderSummaryPanel({
      id: 'summary-technology',
      topicKey: 'technology',
      topicLabel: 'Technology',
      periodStart: '2026-05-21T05:00:00.000Z',
      periodEnd: '2026-05-21T11:00:00.000Z',
      summarySlot: 'lunch',
      articleCount: 2,
      summaryTextByLocale: {
        en: 'The first argument covers chip supply and infrastructure.\nThe second argument moves to software policy and regulation.'
      }
    });

    expect(screen.getByText('Lunch time')).toBeInTheDocument();
    expect(screen.queryByText(/2026/u)).not.toBeInTheDocument();
    expect(screen.getByText('The first argument covers chip supply and infrastructure.')).toBeInTheDocument();
    expect(screen.getByText('The second argument moves to software policy and regulation.')).toBeInTheDocument();
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
    const summaryFrame = paragraph.closest('article').parentElement;

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
