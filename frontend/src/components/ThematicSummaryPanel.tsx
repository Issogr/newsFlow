import { useEffect, useMemo, useRef, useState, type ReactNode, type TouchEvent } from 'react';
import { ExternalLink, Newspaper, Sparkles } from 'lucide-react';
import { getSafeExternalUrl } from '../utils/urlSafety';
import { getTopicPresentation } from '../topicPresentation';
import { getLocalizedThematicSummary, getThematicSummaryPresentationKey } from '../utils/thematicSummaryLocale';
import { DEFAULT_READER_TEXT_SIZE, READER_TEXT_SIZE_STYLES } from '../config/readerTextSize';
import { DEFAULT_READER_TEXT_WIDTH, READER_TEXT_WIDTH_CLASS_NAMES } from '../config/readerTextWidth';
import { getStoredReaderTextSizePreference, getStoredReaderTextWidthPreference } from '../utils/readerPreferences';
import { FullscreenPanelFrame } from './FullscreenModalFrame';
import ReaderTextSizeControls from './ReaderTextSizeControls';
import ReaderTextWidthControls from './ReaderTextWidthControls';
import TextContentSkeleton from './TextContentSkeleton';
import type { CurrentUser, Locale, ThematicSummary, Translator } from '../types';

type SummarySource = NonNullable<ThematicSummary['sources']>[number];

const SUMMARY_SLOTS = new Set(['morning', 'lunch', 'evening']);
const SUMMARY_SLOT_LABEL_KEYS: Record<string, string> = {
  morning: 'summarySlotMorning',
  lunch: 'summarySlotLunch',
  evening: 'summarySlotEvening'
};
const MOBILE_SUMMARY_SWIPE_QUERY = '(max-width: 767px)';
const SUMMARY_SWIPE_MIN_DISTANCE = 60;
const SUMMARY_SWIPE_AXIS_RATIO = 1.35;
const SUMMARY_SWIPE_FEEDBACK_MAX_OFFSET = 72;
const SUMMARY_OPENING_SKELETON_MS = 500;

function getFallbackSummarySlot(summary: Partial<ThematicSummary> = {}) {
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

function getSummarySlot(summary: Partial<ThematicSummary> = {}) {
  const slot = String(summary.summarySlot || '').toLowerCase();
  if (SUMMARY_SLOTS.has(slot)) {
    return slot;
  }

  return getFallbackSummarySlot(summary);
}

function getSummarySlotLabel(summary: Partial<ThematicSummary> = {}, t: Translator) {
  return t(SUMMARY_SLOT_LABEL_KEYS[getSummarySlot(summary)] || 'summarySlotRecent');
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

function splitSummaryParagraphs(summaryText = '') {
  return String(summaryText || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n+/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .flatMap((paragraph) => splitLongParagraph(paragraph));
}

function formatSummaryDate(value: unknown, locale: Locale = 'en') {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat(locale === 'it' ? 'it-IT' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

function getSwipeSummariesForPanel(summary: ThematicSummary, summaries: ThematicSummary[] = []) {
  const summaryById = new Map<string, ThematicSummary>();

  (Array.isArray(summaries) ? summaries : []).forEach((availableSummary) => {
    if (availableSummary?.id && !summaryById.has(availableSummary.id)) {
      summaryById.set(availableSummary.id, availableSummary);
    }
  });

  if (summary?.id && !summaryById.has(summary.id)) {
    summaryById.set(summary.id, summary);
  }

  return [...summaryById.values()];
}

function isMobileSummarySwipeViewport() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(MOBILE_SUMMARY_SWIPE_QUERY).matches;
}

function getSwipeFeedbackOffset(deltaX: number, hasAdjacentSummary: boolean) {
  const resistance = hasAdjacentSummary ? 0.35 : 0.14;
  const offset = deltaX * resistance;

  return Math.max(-SUMMARY_SWIPE_FEEDBACK_MAX_OFFSET, Math.min(SUMMARY_SWIPE_FEEDBACK_MAX_OFFSET, offset));
}

function renderSourceReference(source: SummarySource, key: string, t: Translator) {
  const safeUrl = getSafeExternalUrl(source?.url);
  const sourceName = source?.source || source?.title || t('sources');
  const className = 'inline-flex h-5 w-5 items-center justify-center rounded-full border border-sky-200 bg-sky-50 text-sky-700 shadow-sm';

  if (!safeUrl) {
    return (
      <span key={key} className="ml-1 inline-flex align-middle leading-none">
        <span className={className} role="img" aria-label={sourceName} title={sourceName}>
          <Newspaper className="h-3 w-3" aria-hidden="true" />
        </span>
      </span>
    );
  }

  return (
    <span key={key} className="ml-1 inline-flex align-middle leading-none">
      <a
        href={safeUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`${className} no-underline transition-colors hover:border-sky-300 hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-1`}
        aria-label={t('openSummarySource', { source: sourceName })}
        title={sourceName}
      >
        <ExternalLink className="h-3 w-3" aria-hidden="true" />
      </a>
    </span>
  );
}

function renderParagraphWithSources(paragraph: string, paragraphIndex: number, sourceByIndex: Map<number, SummarySource>, t: Translator) {
  const parts: ReactNode[] = [];
  const citationPattern = /\[(\d+)\]/gu;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = citationPattern.exec(paragraph)) !== null) {
    if (match.index > lastIndex) {
      parts.push(paragraph.slice(lastIndex, match.index));
    }

    const source = sourceByIndex.get(Number(match[1]));
    parts.push(source ? renderSourceReference(source, `source-reference-${paragraphIndex}-${match.index}`, t) : match[0]);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < paragraph.length) {
    parts.push(paragraph.slice(lastIndex));
  }

  return parts;
}

const ThematicSummaryPanel = ({ summary, summaries = [], locale, t, onClose, onSelectSummary, showOpeningSkeleton = false, currentUser }: {
  summary: ThematicSummary;
  summaries?: ThematicSummary[];
  locale: Locale;
  t: Translator;
  onClose: () => void;
  onSelectSummary?: (summary: ThematicSummary) => void;
  showOpeningSkeleton?: boolean;
  currentUser?: CurrentUser;
}) => {
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const swipeFeedbackFrameRef = useRef(0);
  const swipeFeedbackOffsetRef = useRef(0);
  const [swipeFeedbackOffset, setSwipeFeedbackOffset] = useState(0);
  const [readerTextSize, setReaderTextSize] = useState(() => getStoredReaderTextSizePreference(currentUser?.settings?.readerTextSize));
  const [readerTextWidth, setReaderTextWidth] = useState(() => getStoredReaderTextWidthPreference(currentUser?.settings?.readerTextWidth));
  const [readySummaryId, setReadySummaryId] = useState('');
  const localizedSummary = useMemo(() => getLocalizedThematicSummary(summary, locale), [summary, locale]);
  const coverageStart = formatSummaryDate(summary.periodStart, locale);
  const coverageEnd = formatSummaryDate(summary.periodEnd, locale);
  const sourceByIndex = useMemo(() => new Map<number, SummarySource>((summary?.sources || []).map((source: SummarySource) => [Number(source.index), source])), [summary?.sources]);
  const showSummaryOpeningSkeleton = showOpeningSkeleton && readySummaryId !== summary?.id;
  const swipeSummaries = useMemo(() => getSwipeSummariesForPanel(summary, summaries), [summaries, summary]);
  const swipeSummaryIndex = swipeSummaries.findIndex((availableSummary) => availableSummary.id === summary.id);
  const paragraphs = useMemo(() => {
    return splitSummaryParagraphs(localizedSummary.displaySummaryText);
  }, [localizedSummary.displaySummaryText]);
  const primaryPresentation = getTopicPresentation(getThematicSummaryPresentationKey(summary));
  const PrimaryIcon = primaryPresentation.Icon;
  const readerTextStyles = READER_TEXT_SIZE_STYLES[readerTextSize] || READER_TEXT_SIZE_STYLES[DEFAULT_READER_TEXT_SIZE];
  const readerTextWidthClassName = READER_TEXT_WIDTH_CLASS_NAMES[readerTextWidth] || READER_TEXT_WIDTH_CLASS_NAMES[DEFAULT_READER_TEXT_WIDTH];
  const canSwipeSummaries = swipeSummaries.length > 1 && swipeSummaryIndex >= 0 && typeof onSelectSummary === 'function';
  const swipeFeedbackStrength = Math.min(Math.abs(swipeFeedbackOffset) / SUMMARY_SWIPE_FEEDBACK_MAX_OFFSET, 1);
  const swipeFeedbackActive = swipeFeedbackOffset !== 0;
  const swipeFeedbackStyle = {
    opacity: 1 - (swipeFeedbackStrength * 0.08),
    transform: `translate3d(${swipeFeedbackOffset}px, 0, 0)`
  };
  const selectAdjacentSummary = (direction: number) => {
    if (!canSwipeSummaries) {
      return;
    }

    const nextSummary = swipeSummaries[swipeSummaryIndex + direction];
    if (nextSummary?.id) {
      onSelectSummary?.(nextSummary);
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
  const scheduleSwipeFeedbackOffset = (nextOffset: number) => {
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
  useEffect(() => {
    if (!showOpeningSkeleton || !summary?.id) {
      return undefined;
    }

    const timeoutId = setTimeout(() => setReadySummaryId(summary.id), SUMMARY_OPENING_SKELETON_MS);
    return () => clearTimeout(timeoutId);
  }, [showOpeningSkeleton, summary?.id]);
  useEffect(() => {
    setReaderTextSize(getStoredReaderTextSizePreference(currentUser?.settings?.readerTextSize));
  }, [currentUser?.settings?.readerTextSize]);
  useEffect(() => {
    setReaderTextWidth(getStoredReaderTextWidthPreference(currentUser?.settings?.readerTextWidth));
  }, [currentUser?.settings?.readerTextWidth]);
  const handleTouchStart = (event: TouchEvent<HTMLElement>) => {
    touchStartRef.current = null;
    resetSwipeFeedbackOffset();

    if (!canSwipeSummaries || !isMobileSummarySwipeViewport() || event.touches.length !== 1) {
      return;
    }

    if ((event.target as Element | null)?.closest?.('a, button, input, textarea, select, [role="button"], [role="slider"]')) {
      return;
    }

    const touch = event.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  };
  const handleTouchMove = (event: TouchEvent<HTMLElement>) => {
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
  const handleTouchEnd = (event: TouchEvent<HTMLElement>) => {
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
    <h2 id="thematic-summary-panel-title" className="sr-only focus:outline-none" data-modal-title tabIndex={-1}>
      {t('thematicSummary')}: {localizedSummary.displayTopicLabel}
    </h2>
  );

  return (
    <FullscreenPanelFrame
      closeLabel={t('closeThematicSummary')}
      containerClassName="relative flex h-[100dvh] w-full justify-center overflow-hidden overscroll-none"
      headerActions={(
        <>
          <ReaderTextWidthControls currentUser={currentUser} onChange={setReaderTextWidth} t={t} value={readerTextWidth} />
          <ReaderTextSizeControls currentUser={currentUser} onChange={setReaderTextSize} t={t} value={readerTextSize} />
        </>
      )}
      headerStart={headerStart}
      labelledBy="thematic-summary-panel-title"
      onClose={onClose}
      overlayClassName="fixed inset-0 z-50 h-[100dvh] w-full overflow-hidden overscroll-none bg-slate-950/35 backdrop-blur-sm"
      panelClassName="flex h-full w-full flex-col overflow-hidden bg-white shadow-xl lg:m-4 lg:h-[calc(100dvh-2rem)] lg:w-[min(64rem,calc(100vw-2rem))] lg:rounded-2xl lg:border lg:border-slate-200"
    >
          <div
            className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain bg-white pb-[calc(1.5rem+env(safe-area-inset-bottom))] pl-[calc(1rem+env(safe-area-inset-left))] pr-[calc(1rem+env(safe-area-inset-right))] pt-6 sm:pl-[calc(1.25rem+env(safe-area-inset-left))] sm:pr-[calc(1.25rem+env(safe-area-inset-right))] md:pb-[calc(2rem+env(safe-area-inset-bottom))] md:pt-8 lg:pl-[calc(1.5rem+env(safe-area-inset-left))] lg:pr-[calc(1.5rem+env(safe-area-inset-right))]"
            onTouchCancel={handleTouchCancel}
            onTouchEnd={handleTouchEnd}
            onTouchMove={handleTouchMove}
            onTouchStart={handleTouchStart}
          >
            <div
              className={`mx-auto space-y-5 transition-[opacity,transform] ease-out will-change-transform ${readerTextWidthClassName} ${swipeFeedbackActive ? 'duration-75' : 'duration-200'}`}
              data-testid="thematic-summary-swipe-frame"
              style={swipeFeedbackStyle}
            >
              <div className="border-b border-slate-200 pb-6 md:pb-7">
                <div className="flex items-start gap-3">
                  <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${primaryPresentation.iconBadgeClassName}`}>
                    <PrimaryIcon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-stone-500">{t('thematicSummary')}</p>
                    <h2 className="mt-1 text-pretty text-2xl font-semibold leading-tight tracking-tight text-stone-900 md:text-[2rem] md:leading-[1.15]">
                      {localizedSummary.displayTopicLabel}
                    </h2>
                  </div>
                </div>
                <div className="mt-4 text-xs font-medium text-slate-500">
                  <span className="inline-flex items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5" />
                    {getSummarySlotLabel(summary, t)}
                    {Number(summary.articleCount) > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{t('summaryArticleCount', { count: Number(summary.articleCount) })}</span>
                      </>
                    )}
                  </span>
                  {coverageStart && coverageEnd && (
                    <p className="mt-2 font-normal normal-case tracking-normal text-slate-500">
                      {t('summaryCoverage')}{' '}
                      <time dateTime={summary.periodStart}>{coverageStart}</time>
                      {' – '}
                      <time dateTime={summary.periodEnd}>{coverageEnd}</time>
                    </p>
                  )}
                </div>
                {summary.isStale && (
                  <p role="status" className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    {t('summaryStaleNotice')}
                  </p>
                )}
              </div>

              <article className="pb-8">
                {showSummaryOpeningSkeleton ? (
                  <TextContentSkeleton label={t('loadingThematicSummary')} />
                ) : (
                  <div className={`space-y-5 ${readerTextStyles.paragraph}`}>
                    {paragraphs.map((paragraph, index) => (
                      <p key={`${summary.id}-paragraph-${index}`}>{renderParagraphWithSources(paragraph, index, sourceByIndex, t)}</p>
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
