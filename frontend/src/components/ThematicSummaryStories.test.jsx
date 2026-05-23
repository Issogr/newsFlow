import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ThematicSummaryStories from './ThematicSummaryStories';
import ThematicSummaryPanel from './ThematicSummaryPanel';

const translations = {
  thematicSummariesTitle: 'Topic stories',
  openPodcastSummary: 'Open podcast briefing',
  openThematicSummary: ({ topic }) => `Open ${topic} summary`,
  closeThematicSummary: 'Close summary',
  closePodcastSummary: 'Close podcast briefing',
  podcastBriefing: 'Podcast briefing',
  thematicSummary: 'Thematic summary',
  summaryArticleCount: ({ count }) => `${count} articles evaluated`,
  podcastAudioTitle: 'Italian audio briefing',
  podcastAudioReady: 'Ready to play',
  podcastAudioLoadFailed: 'Unable to load audio',
  podcastAudioSeek: 'Seek podcast audio',
  playPodcastAudio: 'Play podcast audio',
  pausePodcastAudio: 'Pause podcast audio',
  podcastAudioBack: '15 sec back',
  podcastAudioForward: '30 sec ahead',
  podcastAudioGenerating: 'Audio generation is in progress. This panel will update when it is ready.',
  podcastAudioUnavailable: 'Audio is not available yet. You can read the podcast script below.',
  podcastAudioFailed: 'Audio generation failed for this briefing. You can read the podcast script below.'
};

function t(key, params = {}) {
  const entry = translations[key] || key;
  return typeof entry === 'function' ? entry(params) : entry;
}

describe('thematic summary podcast UI', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    HTMLMediaElement.prototype.load = vi.fn();
    HTMLMediaElement.prototype.pause = vi.fn();
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('places the podcast story first and opens the selected item', () => {
    const onOpenSummary = vi.fn();
    const podcast = {
      id: 'podcast-1',
      type: 'podcast',
      topicKey: 'podcast',
      topicLabel: 'Podcast',
      titleByLocale: { en: 'News podcast' },
      summaryTextByLocale: { en: 'Podcast script' }
    };
    const technology = {
      id: 'summary-technology',
      topicKey: 'technology',
      topicLabel: 'Technology',
      topics: ['Tecnologia'],
      titleByLocale: { en: 'Technology' },
      summaryTextByLocale: { en: 'Technology summary' }
    };

    render(
      <ThematicSummaryStories
        summaries={[technology, podcast]}
        locale="en"
        readSummaryIds={[]}
        t={t}
        onOpenSummary={onOpenSummary}
      />
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).toHaveAccessibleName('Open podcast briefing');

    fireEvent.click(buttons[0]);

    expect(onOpenSummary).toHaveBeenCalledWith(podcast);
  });

  test('renders custom podcast audio controls, localized script text, and starts playback', async () => {
    render(
      <ThematicSummaryPanel
        summary={{
          id: 'podcast-1',
          type: 'podcast',
          topicKey: 'podcast',
          topicLabel: 'Podcast',
          periodStart: '2026-05-21T05:00:00.000Z',
          periodEnd: '2026-05-21T11:00:00.000Z',
          articleCount: 2,
          titleByLocale: { en: 'Morning podcast', it: 'Podcast del mattino' },
          summaryTextByLocale: { en: 'English script', it: 'Testo podcast italiano' },
          audioStatus: 'completed',
          audioUrl: '/api/podcast-summary/podcast-1/audio'
        }}
        locale="it"
        t={t}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Podcast briefing')).toBeInTheDocument();
    expect(screen.queryByText('Podcast del mattino')).not.toBeInTheDocument();
    const audio = document.querySelector('audio');
    Object.defineProperty(audio, 'duration', { configurable: true, value: 2 });
    fireEvent.loadedMetadata(audio);

    expect(screen.getByText('Testo podcast italiano')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('0:00 / 0:02')).toBeInTheDocument());
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Play podcast audio' })).toBeInTheDocument();
    expect(screen.getByLabelText('Seek podcast audio')).toBeInTheDocument();
    expect(audio?.getAttribute('src')).toBe('/api/podcast-summary/podcast-1/audio');
    expect(audio?.getAttribute('preload')).toBe('metadata');

    fireEvent.click(screen.getByRole('button', { name: 'Play podcast audio' }));

    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled());
  });

  test('shows podcast audio generation feedback while audio is pending', () => {
    render(
      <ThematicSummaryPanel
        summary={{
          id: 'podcast-1',
          type: 'podcast',
          topicKey: 'podcast',
          topicLabel: 'Podcast',
          periodStart: '2026-05-21T05:00:00.000Z',
          periodEnd: '2026-05-21T11:00:00.000Z',
          articleCount: 2,
          titleByLocale: { en: 'Morning podcast', it: 'Podcast del mattino' },
          summaryTextByLocale: { en: 'English script', it: 'Testo podcast italiano' },
          audioStatus: 'generating'
        }}
        locale="en"
        t={t}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Audio generation is in progress. This panel will update when it is ready.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Play podcast audio' })).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('splits dense podcast scripts into readable paragraphs', () => {
    render(
      <ThematicSummaryPanel
        summary={{
          id: 'podcast-1',
          type: 'podcast',
          topicKey: 'podcast',
          topicLabel: 'Podcast',
          periodStart: '2026-05-21T05:00:00.000Z',
          periodEnd: '2026-05-21T11:00:00.000Z',
          articleCount: 3,
          titleByLocale: { en: 'News podcast' },
          summaryTextByLocale: {
            en: 'First, the technology story opens with enough context to make this sentence intentionally long and representative of a dense generated podcast script. Next, the politics story shifts to a different subject with additional context and a second long sentence that should not be glued to every other item. Finally, the science story closes the briefing with one more detailed sentence so the renderer creates another paragraph.'
          },
          audioStatus: 'not_available'
        }}
        locale="en"
        t={t}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText(/^First, the technology story opens/)).toHaveTextContent('Next, the politics story shifts');
    expect(screen.getByText(/^Finally, the science story closes/)).toBeInTheDocument();
  });

  test('uses single newlines as paragraph breaks for thematic summaries', () => {
    render(
      <ThematicSummaryPanel
        summary={{
          id: 'summary-technology',
          topicKey: 'technology',
          topicLabel: 'Technology',
          periodStart: '2026-05-21T05:00:00.000Z',
          periodEnd: '2026-05-21T11:00:00.000Z',
          articleCount: 2,
          titleByLocale: { en: 'Technology briefing' },
          summaryTextByLocale: {
            en: 'The first argument covers chip supply and infrastructure.\nThe second argument moves to software policy and regulation.'
          }
        }}
        locale="en"
        t={t}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('The first argument covers chip supply and infrastructure.')).toBeInTheDocument();
    expect(screen.getByText('The second argument moves to software policy and regulation.')).toBeInTheDocument();
  });
});
