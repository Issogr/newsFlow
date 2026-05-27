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
  morningPodcast: 'Morning podcast',
  eveningPodcast: 'Evening podcast',
  podcastItalianOnlyNotice: 'English podcast audio is not generated yet. The available podcast audio is in Italian.',
  podcastItalianAudioLabel: 'Audio in Italian',
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
  podcastAudioUnavailable: 'Audio is not available for this briefing yet.',
  podcastAudioFailed: 'Audio generation failed for this briefing.'
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
    const olderPodcast = {
      ...podcast,
      id: 'podcast-older'
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

    fireEvent.click(buttons[0]);

    expect(onOpenSummary).toHaveBeenCalledWith(podcast);
  });

  test('renders custom podcast audio controls without script text and starts playback', async () => {
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
        locale="en"
        t={t}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Podcast briefing')).toBeInTheDocument();
    expect(screen.getByText('Morning podcast')).toBeInTheDocument();
    expect(screen.getByText('English podcast audio is not generated yet. The available podcast audio is in Italian.')).toBeInTheDocument();
    expect(screen.getByText('Audio in Italian')).toBeInTheDocument();
    expect(screen.queryByText('Podcast del mattino')).not.toBeInTheDocument();
    const audio = document.querySelector('audio');
    Object.defineProperty(audio, 'duration', { configurable: true, value: 2 });
    fireEvent.loadedMetadata(audio);

    expect(screen.queryByText('Testo podcast italiano')).not.toBeInTheDocument();
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

  test('shows morning and evening podcast players together', () => {
    const morningPodcast = {
      id: 'podcast-morning',
      type: 'podcast',
      topicKey: 'podcast',
      topicLabel: 'Podcast',
      periodStart: '2026-05-20T17:00:00.000Z',
      periodEnd: '2026-05-21T05:00:00.000Z',
      articleCount: 2,
      titleByLocale: { en: 'Morning podcast' },
      summaryTextByLocale: { en: 'Morning script' },
      audioStatus: 'completed',
      audioUrl: '/api/podcast-summary/podcast-morning/audio'
    };
    const eveningPodcast = {
      id: 'podcast-evening',
      type: 'podcast',
      topicKey: 'podcast',
      topicLabel: 'Podcast',
      periodStart: '2026-05-21T05:00:00.000Z',
      periodEnd: '2026-05-21T17:00:00.000Z',
      articleCount: 3,
      titleByLocale: { en: 'Evening podcast' },
      summaryTextByLocale: { en: 'Evening script' },
      audioStatus: 'completed',
      audioUrl: '/api/podcast-summary/podcast-evening/audio'
    };

    render(
      <ThematicSummaryPanel
        summary={eveningPodcast}
        summaries={[eveningPodcast, morningPodcast]}
        locale="en"
        t={t}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Morning podcast')).toBeInTheDocument();
    expect(screen.getByText('Evening podcast')).toBeInTheDocument();
    expect(screen.queryByText('Morning script')).not.toBeInTheDocument();
    expect(screen.queryByText('Evening script')).not.toBeInTheDocument();
    expect(document.querySelectorAll('audio')).toHaveLength(2);
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
