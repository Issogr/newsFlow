import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Newspaper, Sparkles } from 'lucide-react';
import { getSafeExternalUrl } from '../utils/urlSafety';
import { getTopicPresentation } from '../topicPresentation';
import { getLocalizedThematicSummary, getThematicSummaryPresentationKey, isPodcastSummary } from '../utils/thematicSummaryLocale';
import { FullscreenPanelFrame } from './FullscreenModalFrame';
import PodcastAudioPlayer from './PodcastAudioPlayer';

const SUMMARY_SLOTS = new Set(['morning', 'lunch', 'evening']);
const MOBILE_SUMMARY_SWIPE_QUERY = '(max-width: 767px)';
const SUMMARY_SWIPE_MIN_DISTANCE = 60;
const SUMMARY_SWIPE_AXIS_RATIO = 1.35;
const SUMMARY_SWIPE_FEEDBACK_MAX_OFFSET = 72;
const PODCAST_LANGUAGE_LABELS = {
  en: { en: 'English', it: 'inglese' },
  it: { en: 'Italian', it: 'italiano' }
};

function getFallbackSummarySlot(summary = {}) {
  const date = new Date(summary.periodEnd || '');
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const hourPart = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Rome',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date).find((part) => part.type === 'hour');
  const hour = Number(hourPart?.value);
  if (!Number.isFinite(hour)) {
    return '';
  }

  if (hour < 10) {
    return 'morning';
  }
  if (hour < 16) {
    return 'lunch';
  }

  return 'evening';
}

function getSummarySlot(summary = {}) {
  const slot = String(summary.summarySlot || '').toLowerCase();
  if (SUMMARY_SLOTS.has(slot)) {
    return slot;
  }

  return getFallbackSummarySlot(summary);
}

function getSummarySlotLabel(summary = {}, t) {
  const slot = getSummarySlot(summary);
  if (slot === 'morning') {
    return t('summarySlotMorning');
  }
  if (slot === 'lunch') {
    return t('summarySlotLunch');
  }
  if (slot === 'evening') {
    return t('summarySlotEvening');
  }

  return t('summarySlotRecent');
}

function splitLongParagraph(paragraph = '', maxParagraphChars = 520) {
  const normalizedParagraph = String(paragraph || '').replace(/\s+/g, ' ').trim();
  if (!normalizedParagraph || normalizedParagraph.length <= maxParagraphChars) {
    return normalizedParagraph ? [normalizedParagraph] : [];
  }

  const sentences = normalizedParagraph
    .split(/(?<=[.!?])\s+(?=(?:["'“”‘’])?[A-ZÀ-ÖØ-Þ0-9])/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length <= 1) {
    return [normalizedParagraph];
  }

  const paragraphs = [];
  let currentParagraph = '';

  sentences.forEach((sentence) => {
    const nextParagraph = currentParagraph ? `${currentParagraph} ${sentence}` : sentence;
    if (currentParagraph && nextParagraph.length > maxParagraphChars) {
      paragraphs.push(currentParagraph);
      currentParagraph = sentence;
      return;
    }

    currentParagraph = nextParagraph;
  });

  if (currentParagraph) {
    paragraphs.push(currentParagraph);
  }

  return paragraphs;
}

function splitSummaryParagraphs(summaryText = '', options = {}) {
  const maxParagraphChars = Number(options.maxParagraphChars) || 520;
  return String(summaryText || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n+/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .flatMap((paragraph) => splitLongParagraph(paragraph, maxParagraphChars));
}

function getPodcastSlot(summary = {}) {
  if (summary.podcastSlot === 'morning' || summary.podcastSlot === 'evening') {
    return summary.podcastSlot;
  }

  const periodEnd = new Date(summary.periodEnd || '');
  if (Number.isNaN(periodEnd.getTime())) {
    return 'podcast';
  }

  return periodEnd.getUTCHours() < 12 ? 'morning' : 'evening';
}

function getPodcastSlotLabel(summary = {}, t) {
  const slot = getPodcastSlot(summary);
  if (slot === 'morning') {
    return t('morningPodcast');
  }
  if (slot === 'evening') {
    return t('eveningPodcast');
  }

  return t('podcastBriefing');
}

function formatPodcastGeneratedAt(value, locale = 'en') {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat(locale === 'it' ? 'it-IT' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

function getPodcastSummariesForPanel(summary = {}, summaries = []) {
  const byId = new Map();
  [summary, ...summaries].filter(isPodcastSummary).forEach((podcastSummary) => {
    if (podcastSummary?.id && !byId.has(podcastSummary.id)) {
      byId.set(podcastSummary.id, podcastSummary);
    }
  });

  const slotOrder = { morning: 0, evening: 1, podcast: 2 };
  return [...byId.values()].sort((left, right) => {
    const slotComparison = slotOrder[getPodcastSlot(left)] - slotOrder[getPodcastSlot(right)];
    if (slotComparison !== 0) {
      return slotComparison;
    }

    return String(right.periodEnd || '').localeCompare(String(left.periodEnd || ''));
  });
}

function getSwipeSummariesForPanel(summary = {}, summaries = []) {
  const summaryById = new Map();

  (Array.isArray(summaries) ? summaries : []).forEach((availableSummary) => {
    if (availableSummary?.id && !summaryById.has(availableSummary.id)) {
      summaryById.set(availableSummary.id, availableSummary);
    }
  });

  if (summary?.id && !summaryById.has(summary.id)) {
    summaryById.set(summary.id, summary);
  }

  const orderedSummaries = [...summaryById.values()];
  const podcastSummary = orderedSummaries.find(isPodcastSummary);
  const topicSummaries = orderedSummaries.filter((availableSummary) => !isPodcastSummary(availableSummary));

  return podcastSummary ? [podcastSummary, ...topicSummaries] : topicSummaries;
}

function getSwipeSummaryIndex(summary = {}, swipeSummaries = []) {
  if (isPodcastSummary(summary)) {
    return swipeSummaries.findIndex(isPodcastSummary);
  }

  return swipeSummaries.findIndex((availableSummary) => availableSummary?.id === summary?.id);
}

function isMobileSummarySwipeViewport() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(MOBILE_SUMMARY_SWIPE_QUERY).matches;
}

function getSwipeFeedbackOffset(deltaX, hasAdjacentSummary) {
  const resistance = hasAdjacentSummary ? 0.35 : 0.14;
  const offset = deltaX * resistance;

  return Math.max(-SUMMARY_SWIPE_FEEDBACK_MAX_OFFSET, Math.min(SUMMARY_SWIPE_FEEDBACK_MAX_OFFSET, offset));
}

function getPodcastAudioStatusText(summary = {}, t) {
  if (summary.status === 'failed') {
    return t('podcastAudioFailed');
  }
  if (summary.audioStatus === 'generating') {
    return t('podcastAudioGenerating');
  }
  if (summary.audioStatus === 'failed') {
    return t('podcastAudioFailed');
  }

  return t('podcastAudioUnavailable');
}

function getPodcastLanguageLabel(audioLocale = '', locale = 'en') {
  const normalizedLocale = String(audioLocale || '').trim().toLowerCase();
  return PODCAST_LANGUAGE_LABELS[normalizedLocale]?.[locale === 'it' ? 'it' : 'en'] || normalizedLocale.toUpperCase();
}

function formatLanguageList(locales = [], locale = 'en') {
  const labels = locales.map((audioLocale) => getPodcastLanguageLabel(audioLocale, locale)).filter(Boolean);
  if (labels.length <= 1) {
    return labels[0] || '';
  }

  const formatter = typeof Intl !== 'undefined' && Intl.ListFormat
    ? new Intl.ListFormat(locale === 'it' ? 'it' : 'en', { style: 'long', type: 'conjunction' })
    : null;
  return formatter ? formatter.format(labels) : labels.join(', ');
}

function getPodcastAudioChoice(summary = {}, locale = 'en') {
  const audioByLocale = summary.audioByLocale && typeof summary.audioByLocale === 'object' ? summary.audioByLocale : {};
  const completedLocales = Object.entries(audioByLocale)
    .filter(([, audio]) => audio?.audioStatus === 'completed' && audio?.audioUrl)
    .map(([audioLocale]) => audioLocale);
  const preferredLocale = completedLocales.includes(locale)
    ? locale
    : (completedLocales.includes('en') ? 'en' : completedLocales[0]);

  if (preferredLocale) {
    return {
      locale: preferredLocale,
      audio: audioByLocale[preferredLocale],
      completedLocales
    };
  }

  const statusLocale = audioByLocale[locale]
    ? locale
    : (audioByLocale.en ? 'en' : Object.keys(audioByLocale)[0]);
  return {
    locale: statusLocale || summary.audioLocale || '',
    audio: statusLocale ? audioByLocale[statusLocale] : summary,
    completedLocales
  };
}

function renderSourceChip(source, key) {
  const safeUrl = getSafeExternalUrl(source?.url);
  const safeIconUrl = getSafeExternalUrl(source?.sourceIconUrl);
  const sourceName = source?.source || source?.title || '';
  const chip = (
    <span className="mx-1 inline-flex max-w-[12rem] translate-y-1 items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold leading-none text-sky-900 shadow-sm align-baseline md:max-w-[16rem]">
      {safeIconUrl ? (
        <img src={safeIconUrl} alt="" loading="lazy" className="h-4 w-4 rounded-full object-contain" />
      ) : (
        <Newspaper className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      )}
      <span className="truncate">{sourceName}</span>
      {safeUrl && <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />}
    </span>
  );

  if (!safeUrl) {
    return <span key={key}>{chip}</span>;
  }

  return (
    <a key={key} href={safeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex no-underline">
      {chip}
    </a>
  );
}

function renderParagraphWithSources(paragraph, paragraphIndex, sourceByIndex) {
  const parts = [];
  const citationPattern = /\[(\d+)\]/gu;
  let lastIndex = 0;
  let match;

  while ((match = citationPattern.exec(paragraph)) !== null) {
    if (match.index > lastIndex) {
      parts.push(paragraph.slice(lastIndex, match.index));
    }

    const source = sourceByIndex.get(Number(match[1]));
    parts.push(source ? renderSourceChip(source, `source-chip-${paragraphIndex}-${match.index}`) : match[0]);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < paragraph.length) {
    parts.push(paragraph.slice(lastIndex));
  }

  return parts;
}

const ThematicSummaryPanel = ({ summary, summaries = [], locale, t, onClose, onSelectSummary }) => {
  const touchStartRef = useRef(null);
  const swipeFeedbackFrameRef = useRef(0);
  const swipeFeedbackOffsetRef = useRef(0);
  const [swipeFeedbackOffset, setSwipeFeedbackOffset] = useState(0);
  const localizedSummary = useMemo(() => getLocalizedThematicSummary(summary, locale), [locale, summary]);
  const sourceByIndex = useMemo(() => new Map((summary?.sources || []).map((source) => [Number(source.index), source])), [summary?.sources]);
  const isPodcast = isPodcastSummary(summary);
  const podcastSummaries = useMemo(() => getPodcastSummariesForPanel(summary, summaries), [summaries, summary]);
  const swipeSummaries = useMemo(() => getSwipeSummariesForPanel(summary, summaries), [summaries, summary]);
  const swipeSummaryIndex = useMemo(() => getSwipeSummaryIndex(summary, swipeSummaries), [summary, swipeSummaries]);
  const paragraphs = useMemo(() => {
    return isPodcast ? [] : splitSummaryParagraphs(localizedSummary.displaySummaryText, { maxParagraphChars: 520 });
  }, [isPodcast, localizedSummary.displaySummaryText]);
  const primaryPresentation = getTopicPresentation(getThematicSummaryPresentationKey(summary));
  const PrimaryIcon = primaryPresentation.Icon;
  const closeLabel = isPodcast ? t('closePodcastSummary') : t('closeThematicSummary');
  const canSwipeSummaries = swipeSummaries.length > 1 && swipeSummaryIndex >= 0 && typeof onSelectSummary === 'function';
  const swipeFeedbackStrength = Math.min(Math.abs(swipeFeedbackOffset) / SUMMARY_SWIPE_FEEDBACK_MAX_OFFSET, 1);
  const swipeFeedbackActive = swipeFeedbackOffset !== 0;
  const swipeFeedbackStyle = {
    opacity: 1 - (swipeFeedbackStrength * 0.08),
    transform: `translate3d(${swipeFeedbackOffset}px, 0, 0)`
  };
  const selectAdjacentSummary = (direction) => {
    if (!canSwipeSummaries) {
      return;
    }

    const nextSummary = swipeSummaries[swipeSummaryIndex + direction];
    if (nextSummary?.id) {
      onSelectSummary(nextSummary);
    }
  };
  const resetSwipeFeedbackOffset = () => {
    swipeFeedbackOffsetRef.current = 0;
    if (swipeFeedbackFrameRef.current && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(swipeFeedbackFrameRef.current);
      swipeFeedbackFrameRef.current = 0;
    }
    setSwipeFeedbackOffset(0);
  };
  const scheduleSwipeFeedbackOffset = (nextOffset) => {
    if (swipeFeedbackOffsetRef.current === nextOffset) {
      return;
    }

    swipeFeedbackOffsetRef.current = nextOffset;
    if (swipeFeedbackFrameRef.current) {
      return;
    }

    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      setSwipeFeedbackOffset(nextOffset);
      return;
    }

    swipeFeedbackFrameRef.current = window.requestAnimationFrame(() => {
      swipeFeedbackFrameRef.current = 0;
      setSwipeFeedbackOffset(swipeFeedbackOffsetRef.current);
    });
  };
  useEffect(() => {
    return () => {
      if (swipeFeedbackFrameRef.current && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(swipeFeedbackFrameRef.current);
      }
    };
  }, []);
  const handleTouchStart = (event) => {
    touchStartRef.current = null;
    resetSwipeFeedbackOffset();

    if (!canSwipeSummaries || !isMobileSummarySwipeViewport() || event.touches.length !== 1) {
      return;
    }

    if (typeof event.target?.closest === 'function' && event.target.closest('a, button, input, textarea, select, audio, [role="button"], [role="slider"]')) {
      return;
    }

    const touch = event.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  };
  const handleTouchMove = (event) => {
    const touchStart = touchStartRef.current;
    if (!touchStart || event.touches.length !== 1) {
      return;
    }

    const touch = event.touches[0];
    const deltaX = touch.clientX - touchStart.x;
    const deltaY = touch.clientY - touchStart.y;

    if (Math.abs(deltaX) < 8) {
      scheduleSwipeFeedbackOffset(0);
      return;
    }
    if (Math.abs(deltaX) < Math.abs(deltaY) * SUMMARY_SWIPE_AXIS_RATIO) {
      scheduleSwipeFeedbackOffset(0);
      return;
    }

    const direction = deltaX < 0 ? 1 : -1;
    const hasAdjacentSummary = Boolean(swipeSummaries[swipeSummaryIndex + direction]?.id);
    scheduleSwipeFeedbackOffset(getSwipeFeedbackOffset(deltaX, hasAdjacentSummary));
  };
  const handleTouchEnd = (event) => {
    const touchStart = touchStartRef.current;
    touchStartRef.current = null;
    resetSwipeFeedbackOffset();

    if (!touchStart || event.changedTouches.length !== 1) {
      return;
    }

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - touchStart.x;
    const deltaY = touch.clientY - touchStart.y;

    if (Math.abs(deltaX) < SUMMARY_SWIPE_MIN_DISTANCE || Math.abs(deltaX) < Math.abs(deltaY) * SUMMARY_SWIPE_AXIS_RATIO) {
      return;
    }

    selectAdjacentSummary(deltaX < 0 ? 1 : -1);
  };
  const handleTouchCancel = () => {
    touchStartRef.current = null;
    resetSwipeFeedbackOffset();
  };
  const headerStart = (
    <div className="flex min-w-0 items-center gap-3">
      <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${primaryPresentation.iconBadgeClassName}`}>
        <PrimaryIcon className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">{isPodcast ? t('podcastBriefing') : t('thematicSummary')}</p>
        <h2 className="truncate text-base font-semibold text-stone-900">{localizedSummary.displayTopicLabel}</h2>
      </div>
    </div>
  );

  if (!summary) {
    return null;
  }

  return (
    <FullscreenPanelFrame
      closeLabel={closeLabel}
      containerClassName="relative flex h-[100dvh] w-full justify-center overflow-hidden overscroll-none"
      headerStart={headerStart}
      onClose={onClose}
      overlayClassName="fixed inset-0 z-50 overflow-hidden overscroll-none bg-slate-950/35 backdrop-blur-sm"
      panelClassName="flex h-full w-full flex-col overflow-hidden bg-slate-50 shadow-2xl lg:m-4 lg:h-[calc(100dvh-2rem)] lg:w-[min(64rem,calc(100vw-2rem))] lg:rounded-[2rem] lg:border lg:border-slate-200/80"
    >
          <div
            className="flex-1 touch-pan-y overflow-y-auto overscroll-contain bg-slate-50 px-4 py-6 md:px-5 md:py-8 lg:px-6"
            onTouchCancel={handleTouchCancel}
            onTouchEnd={handleTouchEnd}
            onTouchMove={handleTouchMove}
            onTouchStart={handleTouchStart}
          >
            <div
              className={`mx-auto max-w-[54rem] space-y-5 transition-[opacity,transform] ease-out will-change-transform ${swipeFeedbackActive ? 'duration-75' : 'duration-200'}`}
              data-testid="thematic-summary-swipe-frame"
              style={swipeFeedbackStyle}
            >
              {!isPodcast && (
                <div className="text-center text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">
                  <span className="inline-flex items-center justify-center gap-2">
                    <Sparkles className="h-3.5 w-3.5" />
                    {getSummarySlotLabel(summary, t)}
                    {Number(summary.articleCount) > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{t('summaryArticleCount', { count: Number(summary.articleCount) })}</span>
                      </>
                    )}
                  </span>
                </div>
              )}

              <article className="rounded-[2rem] border border-stone-200/80 bg-white/95 px-6 py-8 shadow-[0_24px_70px_rgba(15,23,42,0.08)] md:px-10 md:py-10">
                {isPodcast ? (
                  <div className="space-y-5">
                    {podcastSummaries.map((podcastSummary) => {
                      const audioChoice = getPodcastAudioChoice(podcastSummary, locale);
                      const selectedAudio = audioChoice.audio || {};
                      const selectedLocale = audioChoice.locale;
                      const selectedLanguageLabel = getPodcastLanguageLabel(selectedLocale, locale);
                      const availableLanguageList = formatLanguageList(audioChoice.completedLocales, locale);
                      const showAvailabilityNotice = audioChoice.completedLocales.length > 0 && selectedLocale !== locale;
                      const generatedAtLabel = formatPodcastGeneratedAt(podcastSummary.generatedAt, locale);

                      return (
                        <section key={podcastSummary.id} className="space-y-4 border-b border-slate-200/80 pb-5 last:border-b-0 last:pb-0">
                          {showAvailabilityNotice && (
                            <div className="rounded-3xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-medium text-sky-900" aria-live="polite">
                              {t('podcastAudioAvailableNotice', { languages: availableLanguageList })}
                            </div>
                          )}

                          <div className="flex flex-col gap-1 text-left sm:flex-row sm:items-end sm:justify-between">
                            <div>
                              <h3 className="text-lg font-semibold tracking-tight text-slate-950 md:text-xl">{getPodcastSlotLabel(podcastSummary, t)}</h3>
                              {(selectedLanguageLabel || generatedAtLabel) && (
                                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                                  {selectedLanguageLabel && <span>{t('podcastAudioLanguageLabel', { language: selectedLanguageLabel })}</span>}
                                  {generatedAtLabel && (
                                    <time dateTime={podcastSummary.generatedAt} aria-label={t('podcastGeneratedAt', { date: generatedAtLabel })}>
                                      {t('podcastGeneratedAt', { date: generatedAtLabel })}
                                    </time>
                                  )}
                                </div>
                              )}
                            </div>
                            {Number(podcastSummary.articleCount) > 0 && (
                              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                                {t('summaryArticleCount', { count: Number(podcastSummary.articleCount) })}
                              </p>
                            )}
                          </div>

                          {selectedAudio.audioStatus === 'completed' && selectedAudio.audioUrl ? (
                            <PodcastAudioPlayer src={selectedAudio.audioUrl} t={t} />
                          ) : (
                            <div className="rounded-3xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900" aria-live="polite">
                              {getPodcastAudioStatusText(selectedAudio, t)}
                            </div>
                          )}
                        </section>
                      );
                    })}
                  </div>
                ) : (
                  <div className="space-y-6 text-[1.05rem] leading-8 tracking-[0.01em] text-stone-800 md:text-lg md:leading-9">
                    {paragraphs.map((paragraph, index) => (
                      <p key={`${summary.id}-paragraph-${index}`}>{renderParagraphWithSources(paragraph, index, sourceByIndex)}</p>
                    ))}
                  </div>
                )}

              </article>
            </div>
          </div>
    </FullscreenPanelFrame>
  );
};

export default ThematicSummaryPanel;
