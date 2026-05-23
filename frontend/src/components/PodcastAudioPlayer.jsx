import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Pause, Play, RotateCcw, SkipForward } from 'lucide-react';

function formatDuration(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function getFiniteMediaTime(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

const PodcastAudioPlayer = ({ src, t }) => {
  const audioRef = useRef(null);
  const audioUrl = src || '';
  const [loading, setLoading] = useState(Boolean(src));
  const [error, setError] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const progress = useMemo(() => duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0, [currentTime, duration]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.load();
    }

    setLoading(Boolean(src));
    setError(false);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  }, [src]);

  function updateDuration(value) {
    const nextDuration = getFiniteMediaTime(value);
    if (nextDuration > 0) {
      setDuration((current) => Math.max(current, nextDuration));
    }
  }

  function handleTimeUpdate() {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    setCurrentTime(getFiniteMediaTime(audio.currentTime));
    updateDuration(audio.duration);
  }

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio || error || !audioUrl) {
      return;
    }

    if (playing || !audio.paused) {
      audio.pause();
      setPlaying(false);
      return;
    }

    setError(false);
    try {
      await audio.play();
      setPlaying(true);
      setLoading(false);
    } catch {
      setPlaying(false);
      setError(true);
      setLoading(false);
    }
  }

  function seekTo(nextTime) {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const boundedTime = Math.max(0, Math.min(Number(nextTime) || 0, duration || Number.MAX_SAFE_INTEGER));
    audio.currentTime = boundedTime;
    setCurrentTime(boundedTime);
  }

  return (
    <div className="overflow-hidden rounded-[2rem] border border-sky-100 bg-gradient-to-br from-slate-950 via-slate-900 to-sky-950 p-4 text-white shadow-[0_22px_60px_rgba(2,6,23,0.22)] md:p-5">
      <audio
        ref={audioRef}
        src={audioUrl || undefined}
        preload="metadata"
        onLoadStart={() => {
          setLoading(Boolean(audioUrl));
          setError(false);
        }}
        onLoadedMetadata={(event) => {
          updateDuration(event.currentTarget.duration);
          setLoading(false);
        }}
        onDurationChange={(event) => updateDuration(event.currentTarget.duration)}
        onCanPlay={() => setLoading(false)}
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => {
          setPlaying(true);
          setLoading(false);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(duration || 0);
        }}
        onError={() => {
          setLoading(false);
          setPlaying(false);
          setError(true);
        }}
      />

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={togglePlayback}
          disabled={error || !audioUrl}
          className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white text-slate-950 shadow-lg transition hover:scale-[1.03] disabled:cursor-not-allowed disabled:opacity-60"
          aria-label={playing ? t('pausePodcastAudio') : t('playPodcastAudio')}
        >
          {loading ? (
            <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
          ) : playing ? (
            <Pause className="h-6 w-6" aria-hidden="true" />
          ) : (
            <Play className="ml-0.5 h-6 w-6" aria-hidden="true" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-200">{t('podcastAudioTitle')}</p>
              <p className="truncate text-sm font-medium text-white/80">{error ? t('podcastAudioLoadFailed') : t('podcastAudioReady')}</p>
            </div>
            <p className="shrink-0 font-mono text-xs tabular-nums text-sky-100">
              {formatDuration(currentTime)} / {duration > 0 ? formatDuration(duration) : '--:--'}
            </p>
          </div>

          <div className="relative h-3 rounded-full bg-white/15">
            <div className="absolute inset-y-0 left-0 rounded-full bg-sky-300" style={{ width: `${progress}%` }} aria-hidden="true" />
            <input
              type="range"
              min="0"
              max={Math.max(duration || currentTime || 1, 1)}
              step="0.1"
              value={Math.min(currentTime, Math.max(duration || currentTime || 1, 1))}
              onChange={(event) => seekTo(event.target.value)}
              disabled={error || !audioUrl}
              className="absolute inset-0 h-3 w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
              aria-label={t('podcastAudioSeek')}
            />
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 text-xs font-semibold text-sky-100/90">
        <button type="button" onClick={() => seekTo(currentTime - 15)} disabled={error || !audioUrl} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50">
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          {t('podcastAudioBack')}
        </button>
        <button type="button" onClick={() => seekTo(currentTime + 30)} disabled={error || !audioUrl} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50">
          {t('podcastAudioForward')}
          <SkipForward className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};

export default PodcastAudioPlayer;
