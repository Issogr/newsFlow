import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { NewsArticle, Translator } from '../types';

export default function SourceComparison({ items, t, onOpen }: {
  items: NewsArticle[];
  t: Translator;
  onOpen: (articleId: string) => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  function step(direction: number) {
    const strip = stripRef.current;
    const tile = strip?.firstElementChild;
    if (strip && tile) {
      strip.scrollBy({ left: direction * tile.clientWidth });
    }
  }

  return (
    <section aria-label={t('sourceVersions')} className="rounded-xl bg-canvas p-2">
      <div className="flex items-center gap-1 px-1 pb-1">
        <h3 className="mr-auto text-xs font-semibold text-ink-muted">{t('sourceVersions')}</h3>
        <button type="button" className="ui-icon-button" onClick={() => step(-1)} disabled={index === 0} aria-label={t('previousSource')}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button type="button" className="ui-icon-button" onClick={() => step(1)} disabled={index >= items.length - 1} aria-label={t('nextSource')}>
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div
        ref={stripRef}
        className="flex snap-x snap-mandatory scroll-px-1 gap-2 overflow-x-auto overscroll-x-contain scroll-smooth p-1"
        onScroll={({ currentTarget: strip }) => {
          const range = strip.scrollWidth - strip.clientWidth;
          if (range > 0) setIndex(Math.round(strip.scrollLeft / range * (items.length - 1)));
        }}
      >
        {items.map(({ id, source, sourceId, title }) => (
          <button
            key={sourceId || source}
            type="button"
            disabled={!id}
            onClick={() => id && onOpen(id)}
            className="flex min-w-0 basis-10/12 shrink-0 snap-start flex-col gap-1 rounded-xl border border-line bg-surface p-3 text-left wrap-anywhere enabled:hover:bg-hover-soft"
          >
            <span className="text-xs font-semibold text-ink-muted">{source || sourceId}</span>{' '}
            <span className="font-semibold leading-snug">{title || (id && t('readHereHelp'))}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
