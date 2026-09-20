import { useRef, useState } from 'react';
import { RotateCcw, SkipForward } from 'lucide-react';
import type { Translator } from '../types';

const PodcastAudioPlayer = ({ src, t }: { src: string; t: Translator }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [failedSrc, setFailedSrc] = useState('');
  const error = Boolean(src && failedSrc === src);

  function skip(seconds: number) {
    const audio = audioRef.current;
    if (audio) {
      const end = Number.isFinite(audio.duration) ? audio.duration : Number.MAX_SAFE_INTEGER;
      audio.currentTime = Math.max(0, Math.min(audio.currentTime + seconds, end));
    }
  }

  return (
    <div className="overflow-hidden rounded-[1.5rem] border border-sky-100 bg-gradient-to-br from-slate-950 via-slate-900 to-sky-950 p-3 text-white shadow-[0_18px_48px_rgba(2,6,23,0.22)] sm:p-4">
      <audio
        key={src}
        ref={audioRef}
        src={src || undefined}
        controls
        preload="metadata"
        aria-label={t('podcastAudioReady')}
        className="w-full"
        onLoadStart={() => setFailedSrc('')}
        onError={() => setFailedSrc(src)}
      />
      {error && <p role="alert" className="mt-2 text-sm">{t('podcastAudioLoadFailed')}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-semibold text-sky-100/90 sm:mt-4">
        <button type="button" onClick={() => skip(-15)} disabled={error || !src} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50 sm:py-1.5">
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          {t('podcastAudioBack')}
        </button>
        <button type="button" onClick={() => skip(30)} disabled={error || !src} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50 sm:py-1.5">
          {t('podcastAudioForward')}
          <SkipForward className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};

export default PodcastAudioPlayer;
