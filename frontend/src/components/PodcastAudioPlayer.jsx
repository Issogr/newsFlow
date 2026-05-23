import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Pause, Play, RotateCcw, SkipForward } from 'lucide-react';

function formatDuration(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function getSynchsafeSize(bytes) {
  return ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
}

function readAscii(bytes, start, end) {
  return String.fromCharCode(...bytes.subarray(start, end));
}

function parseWavDuration(bytes) {
  if (bytes.length < 44 || readAscii(bytes, 0, 4) !== 'RIFF') {
    return 0;
  }

  if (readAscii(bytes, 8, 12) !== 'WAVE') {
    return 0;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;

  while (offset + 8 <= bytes.length) {
    const chunkId = readAscii(bytes, offset, offset + 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;

    if (chunkId === 'fmt ' && chunkStart + 12 <= bytes.length) {
      byteRate = view.getUint32(chunkStart + 8, true);
    }
    if (chunkId === 'data') {
      dataSize = chunkSize;
      break;
    }

    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  return byteRate > 0 && dataSize > 0 ? dataSize / byteRate : 0;
}

function getMp3Bitrate(version, layer, bitrateIndex) {
  const mpeg1 = version === 3;
  const tables = {
    v1l1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
    v1l2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
    v1l3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    v2l1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
    v2l23: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
  };
  const table = mpeg1
    ? (layer === 3 ? tables.v1l1 : (layer === 2 ? tables.v1l2 : tables.v1l3))
    : (layer === 3 ? tables.v2l1 : tables.v2l23);

  return table[bitrateIndex] || 0;
}

function getMp3SampleRate(version, sampleRateIndex) {
  const tables = {
    0: [11025, 12000, 8000],
    2: [22050, 24000, 16000],
    3: [44100, 48000, 32000]
  };

  return tables[version]?.[sampleRateIndex] || 0;
}

function parseMp3Duration(bytes) {
  let offset = bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33 && bytes.length >= 10
    ? 10 + getSynchsafeSize(bytes)
    : 0;
  let duration = 0;
  let frames = 0;

  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) {
      offset += 1;
      continue;
    }

    const version = (bytes[offset + 1] >> 3) & 0x03;
    const layer = (bytes[offset + 1] >> 1) & 0x03;
    const bitrateIndex = (bytes[offset + 2] >> 4) & 0x0f;
    const sampleRateIndex = (bytes[offset + 2] >> 2) & 0x03;
    const padding = (bytes[offset + 2] >> 1) & 0x01;

    if (version === 1 || layer === 0 || bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) {
      offset += 1;
      continue;
    }

    const bitrate = getMp3Bitrate(version, layer, bitrateIndex);
    const sampleRate = getMp3SampleRate(version, sampleRateIndex);
    if (!bitrate || !sampleRate) {
      offset += 1;
      continue;
    }

    const samplesPerFrame = layer === 3 ? 384 : (layer === 1 && version !== 3 ? 576 : 1152);
    const frameLength = layer === 3
      ? Math.floor(((12 * bitrate * 1000) / sampleRate + padding) * 4)
      : Math.floor((((layer === 1 && version !== 3 ? 72 : 144) * bitrate * 1000) / sampleRate) + padding);

    if (frameLength <= 0) {
      offset += 1;
      continue;
    }

    duration += samplesPerFrame / sampleRate;
    frames += 1;
    offset += frameLength;
  }

  return frames > 0 ? duration : 0;
}

function parseContainerDuration(arrayBuffer, mimeType = '') {
  const bytes = new Uint8Array(arrayBuffer);
  const normalizedMimeType = String(mimeType || '').toLowerCase();

  if (normalizedMimeType.includes('wav') || normalizedMimeType.includes('wave')) {
    return parseWavDuration(bytes);
  }
  if (normalizedMimeType.includes('mpeg') || normalizedMimeType.includes('mp3')) {
    return parseMp3Duration(bytes);
  }

  return parseWavDuration(bytes) || parseMp3Duration(bytes);
}

const PodcastAudioPlayer = ({ src, t }) => {
  const audioRef = useRef(null);
  const audioContextRef = useRef(null);
  const decodedAudioBufferRef = useRef(null);
  const audioArrayBufferRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const sourceStartedAtRef = useRef(0);
  const sourceOffsetRef = useRef(0);
  const progressFrameRef = useRef(null);
  const [audioUrl, setAudioUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const progress = useMemo(() => duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0, [currentTime, duration]);

  useEffect(() => {
    if (!src) {
      return undefined;
    }

    const controller = new AbortController();
    let objectUrl = '';
    let cancelled = false;

    async function loadAudio() {
      setLoading(true);
      setError(false);
      setAudioUrl('');
      setCurrentTime(0);
      setDuration(0);
      decodedAudioBufferRef.current = null;
      audioArrayBufferRef.current = null;
      sourceOffsetRef.current = 0;
      stopWebAudioSource();

      try {
        const response = await fetch(src, {
          cache: 'no-store',
          credentials: 'include',
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(`Audio request failed with ${response.status}`);
        }

        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();
        const parsedDuration = parseContainerDuration(arrayBuffer, blob.type || response.headers.get('content-type') || '');
        objectUrl = URL.createObjectURL(blob);

        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }

        audioArrayBufferRef.current = arrayBuffer;
        setDuration(Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : 0);
        setAudioUrl(objectUrl);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(true);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadAudio();

    return () => {
      cancelled = true;
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
      stopWebAudioSource();
    };
  }, [src]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const audio = audioRef.current;
    if (audio && audioUrl) {
      audio.load();
    }
  }, [audioUrl]);

  useEffect(() => () => {
    stopWebAudioSource();
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close?.();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function stopProgressLoop() {
    if (progressFrameRef.current) {
      window.cancelAnimationFrame(progressFrameRef.current);
      progressFrameRef.current = null;
    }
  }

  function stopWebAudioSource() {
    stopProgressLoop();
    const sourceNode = sourceNodeRef.current;
    sourceNodeRef.current = null;
    if (sourceNode) {
      sourceNode.onended = null;
      try {
        sourceNode.stop(0);
      } catch {
        // Already stopped.
      }
      sourceNode.disconnect?.();
    }
  }

  function getAudioContext() {
    if (audioContextRef.current) {
      return audioContextRef.current;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return null;
    }

    audioContextRef.current = new AudioContextClass();
    return audioContextRef.current;
  }

  async function getDecodedAudioBuffer() {
    if (decodedAudioBufferRef.current) {
      return decodedAudioBufferRef.current;
    }

    const audioContext = getAudioContext();
    if (!audioContext || !audioArrayBufferRef.current) {
      return null;
    }

    const decoded = await audioContext.decodeAudioData(audioArrayBufferRef.current.slice(0));
    decodedAudioBufferRef.current = decoded;
    updateDuration(decoded.duration);
    return decoded;
  }

  function startProgressLoop() {
    const audioContext = audioContextRef.current;
    if (!audioContext || !sourceNodeRef.current) {
      return;
    }

    const nextTime = Math.min(duration || decodedAudioBufferRef.current?.duration || 0, sourceOffsetRef.current + (audioContext.currentTime - sourceStartedAtRef.current));
    setCurrentTime(nextTime);
    progressFrameRef.current = window.requestAnimationFrame(startProgressLoop);
  }

  async function startWebAudioPlayback() {
    const audioContext = getAudioContext();
    if (!audioContext) {
      return false;
    }

    await audioContext.resume?.();
    const decoded = await getDecodedAudioBuffer();
    if (!decoded) {
      return false;
    }

    stopWebAudioSource();
    if (sourceOffsetRef.current >= decoded.duration) {
      sourceOffsetRef.current = 0;
      setCurrentTime(0);
    }

    const sourceNode = audioContext.createBufferSource();
    sourceNode.buffer = decoded;
    sourceNode.connect(audioContext.destination);
    sourceNode.onended = () => {
      if (sourceNodeRef.current !== sourceNode) {
        return;
      }
      sourceNodeRef.current = null;
      sourceOffsetRef.current = 0;
      stopProgressLoop();
      setCurrentTime(decoded.duration);
      setPlaying(false);
    };
    sourceNodeRef.current = sourceNode;
    sourceStartedAtRef.current = audioContext.currentTime;
    sourceNode.start(0, sourceOffsetRef.current);
    setPlaying(true);
    startProgressLoop();
    return true;
  }

  function pauseWebAudioPlayback() {
    const audioContext = audioContextRef.current;
    if (audioContext && sourceNodeRef.current) {
      sourceOffsetRef.current = Math.min(duration || decodedAudioBufferRef.current?.duration || 0, sourceOffsetRef.current + (audioContext.currentTime - sourceStartedAtRef.current));
      setCurrentTime(sourceOffsetRef.current);
    }
    stopWebAudioSource();
    setPlaying(false);
  }

  function updateDuration(value) {
    if (Number.isFinite(value) && value > 0) {
      setDuration((current) => Math.max(current, value));
    }
  }

  function handleTimeUpdate() {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    setCurrentTime(audio.currentTime || 0);
    updateDuration(audio.currentTime || 0);
  }

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio || loading || error) {
      return;
    }

    if (playing || sourceNodeRef.current || !audio.paused) {
      pauseWebAudioPlayback();
      audio.pause();
      return;
    }

    setError(false);
    try {
      const webAudioStarted = await startWebAudioPlayback();
      if (webAudioStarted) {
        return;
      }

      await audio.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
      setError(true);
    }
  }

  function seekTo(nextTime) {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    const boundedTime = Math.max(0, Math.min(Number(nextTime) || 0, duration || Number.MAX_SAFE_INTEGER));
    const wasPlaying = playing || Boolean(sourceNodeRef.current);
    sourceOffsetRef.current = boundedTime;
    audio.currentTime = boundedTime;
    setCurrentTime(boundedTime);
    if (wasPlaying) {
      startWebAudioPlayback().catch(() => setError(true));
    }
  }

  return (
    <div className="overflow-hidden rounded-[2rem] border border-sky-100 bg-gradient-to-br from-slate-950 via-slate-900 to-sky-950 p-4 text-white shadow-[0_22px_60px_rgba(2,6,23,0.22)] md:p-5">
      <audio
        ref={audioRef}
        src={audioUrl || undefined}
        preload="metadata"
        onLoadedMetadata={(event) => updateDuration(event.currentTarget.duration)}
        onTimeUpdate={() => {
          if (!sourceNodeRef.current) {
            handleTimeUpdate();
          }
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => {
          if (!sourceNodeRef.current) {
            setPlaying(false);
          }
        }}
        onEnded={() => {
          if (sourceNodeRef.current) {
            return;
          }
          setPlaying(false);
          setCurrentTime(duration || 0);
        }}
      />

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={togglePlayback}
          disabled={loading || error || !audioUrl}
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
              disabled={loading || error || !audioUrl}
              className="absolute inset-0 h-3 w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
              aria-label={t('podcastAudioSeek')}
            />
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 text-xs font-semibold text-sky-100/90">
        <button type="button" onClick={() => seekTo(currentTime - 15)} disabled={loading || error || !audioUrl} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50">
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          {t('podcastAudioBack')}
        </button>
        <button type="button" onClick={() => seekTo(currentTime + 30)} disabled={loading || error || !audioUrl} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50">
          {t('podcastAudioForward')}
          <SkipForward className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};

export default PodcastAudioPlayer;
