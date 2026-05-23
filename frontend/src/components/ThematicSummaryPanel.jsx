import React, { useEffect, useMemo } from 'react';
import { ExternalLink, Newspaper, Sparkles, X } from 'lucide-react';
import useLockBodyScroll from '../hooks/useLockBodyScroll';
import { getSafeExternalUrl } from '../utils/urlSafety';
import { getTopicPresentation } from '../topicPresentation';
import { getLocalizedThematicSummary } from '../utils/thematicSummaryLocale';
import PodcastAudioPlayer from './PodcastAudioPlayer';

function formatSummaryDate(value, locale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

function splitSummaryParagraphs(summaryText = '') {
  return String(summaryText || '')
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function isPodcastSummary(summary = {}) {
  return summary?.type === 'podcast' || summary?.topicKey === 'podcast';
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

const ThematicSummaryPanel = ({ summary, locale, t, onClose }) => {
  const localizedSummary = useMemo(() => getLocalizedThematicSummary(summary, locale), [locale, summary]);
  const paragraphs = useMemo(() => splitSummaryParagraphs(localizedSummary.displaySummaryText), [localizedSummary.displaySummaryText]);
  const sourceByIndex = useMemo(() => new Map((summary?.sources || []).map((source) => [Number(source.index), source])), [summary?.sources]);
  const isPodcast = isPodcastSummary(summary);
  const primaryPresentation = getTopicPresentation(summary?.topicKey || summary?.topics?.[0] || summary?.topicLabel);
  const PrimaryIcon = primaryPresentation.Icon;
  const closeLabel = isPodcast ? t('closePodcastSummary') : t('closeThematicSummary');

  useLockBodyScroll();

  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  if (!summary) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 overflow-hidden overscroll-none bg-slate-950/35 backdrop-blur-sm">
      <button
        type="button"
        className="absolute inset-0 hidden cursor-default lg:block"
        aria-label={closeLabel}
        onClick={onClose}
      />

      <div className="relative flex h-[100dvh] w-full justify-center overflow-hidden overscroll-none">
        <section className="flex h-full w-full flex-col overflow-hidden bg-slate-50 shadow-2xl lg:m-4 lg:h-[calc(100dvh-2rem)] lg:w-[min(64rem,calc(100vw-2rem))] lg:rounded-[2rem] lg:border lg:border-slate-200/80">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-200/80 bg-white/85 px-5 py-4 backdrop-blur-md md:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${primaryPresentation.iconBadgeClassName}`}>
                <PrimaryIcon className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">{isPodcast ? t('podcastBriefing') : t('thematicSummary')}</p>
                <h2 className="truncate text-base font-semibold text-stone-900">{localizedSummary.displayTopicLabel}</h2>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-stone-300 bg-white text-stone-500 shadow-sm transition-colors hover:bg-stone-100 hover:text-stone-800"
              aria-label={closeLabel}
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain bg-slate-50 px-4 py-6 md:px-5 md:py-8 lg:px-6">
            <div className="mx-auto max-w-[54rem] space-y-5">
              <div className="text-center text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">
                <span className="inline-flex items-center justify-center gap-2">
                  <Sparkles className="h-3.5 w-3.5" />
                  {formatSummaryDate(summary.periodStart, locale)} - {formatSummaryDate(summary.periodEnd, locale)}
                  {Number(summary.articleCount) > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{t('summaryArticleCount', { count: Number(summary.articleCount) })}</span>
                    </>
                  )}
                </span>
              </div>

              <article className="rounded-[2rem] border border-stone-200/80 bg-white/95 px-6 py-8 shadow-[0_24px_70px_rgba(15,23,42,0.08)] md:px-10 md:py-10">
                {isPodcast && summary.audioStatus === 'completed' && summary.audioUrl && (
                  <div className="mb-7">
                    <PodcastAudioPlayer src={summary.audioUrl} t={t} />
                  </div>
                )}

                {isPodcast && summary.audioStatus !== 'completed' && (
                  <div className="mb-7 rounded-3xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900" aria-live="polite">
                    {summary.audioStatus === 'generating'
                      ? t('podcastAudioGenerating')
                      : (summary.audioStatus === 'failed' ? t('podcastAudioFailed') : t('podcastAudioUnavailable'))}
                  </div>
                )}

                {!isPodcast && localizedSummary.displayTitle && (
                  <h3 className="mb-6 text-2xl font-semibold tracking-tight text-stone-950 md:text-3xl">{localizedSummary.displayTitle}</h3>
                )}

                <div className="space-y-6 text-[1.05rem] leading-8 tracking-[0.01em] text-stone-800 md:text-lg md:leading-9">
                  {paragraphs.map((paragraph, index) => (
                    <p key={`${summary.id}-paragraph-${index}`}>{renderParagraphWithSources(paragraph, index, sourceByIndex)}</p>
                  ))}
                </div>

              </article>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default ThematicSummaryPanel;
