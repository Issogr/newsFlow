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

function createWavBytes(durationSeconds = 2) {
  const sampleRate = 8000;
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const dataSize = byteRate * durationSeconds;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeText(offset, text) {
    [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  }

  writeText(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, channels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  writeText(36, 'data');
  view.setUint32(40, dataSize, true);

  return buffer;
}

describe('thematic summary podcast UI', () => {
  let mockAudioSource;

  beforeEach(() => {
    mockAudioSource = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null,
      buffer: null
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'audio/wav' },
      blob: async () => new Blob([createWavBytes(2)], { type: 'audio/wav' })
    })));
    vi.stubGlobal('AudioContext', function MockAudioContext() {
      return {
        currentTime: 0,
        destination: {},
        resume: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        decodeAudioData: vi.fn().mockResolvedValue({ duration: 2 }),
        createBufferSource: vi.fn(() => mockAudioSource)
      };
    });
    URL.createObjectURL = vi.fn(() => 'blob:podcast-audio');
    URL.revokeObjectURL = vi.fn();
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

  test('renders custom podcast audio controls and localized script text', async () => {
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
    expect(screen.getByText('Testo podcast italiano')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('0:00 / 0:02')).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith('/api/podcast-summary/podcast-1/audio', expect.objectContaining({ cache: 'no-store', credentials: 'include' }));
    expect(screen.getByRole('button', { name: 'Play podcast audio' })).toBeInTheDocument();
    expect(screen.getByLabelText('Seek podcast audio')).toBeInTheDocument();
    expect(document.querySelector('audio')?.getAttribute('src')).toBe('blob:podcast-audio');
    expect(document.querySelector('audio')?.getAttribute('preload')).toBe('metadata');
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

  test('starts decoded podcast audio when pressing play', async () => {
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

    const playButton = await screen.findByRole('button', { name: 'Play podcast audio' });
    fireEvent.click(playButton);

    await waitFor(() => expect(mockAudioSource.start).toHaveBeenCalledWith(0, 0));
    expect(mockAudioSource.connect).toHaveBeenCalled();
  });
});
