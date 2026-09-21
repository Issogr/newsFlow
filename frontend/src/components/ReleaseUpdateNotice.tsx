import { useEffect, useState, type MouseEvent } from 'react';
import { Sparkles, X } from 'lucide-react';
import type { ReleaseNotes, Translator } from '../types';

const DEFAULT_DURATION_MS = 30000;
const ENTRY_DELAY_MS = 16;

const ReleaseUpdateNotice = ({ t, releaseNotes, onOpen, onDismiss }: { t: Translator; releaseNotes: ReleaseNotes; onOpen: (event: MouseEvent<HTMLButtonElement>) => void; onDismiss: () => void }) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(false);
    const frameTimeoutId = window.setTimeout(() => {
      setIsVisible(true);
    }, ENTRY_DELAY_MS);
    const timeoutId = window.setTimeout(() => {
      onDismiss();
    }, DEFAULT_DURATION_MS);

    return () => {
      window.clearTimeout(frameTimeoutId);
      window.clearTimeout(timeoutId);
    };
  }, [onDismiss, releaseNotes.id]);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(1rem+env(safe-area-inset-top))] z-50 flex justify-center pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:top-[calc(1.25rem+env(safe-area-inset-top))]">
      <div
        role="status"
        className={`ui-popover pointer-events-auto relative w-full max-w-lg transition-all duration-200 ease-out ${isVisible ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0'}`}
      >
        <button type="button" onClick={onOpen} className="block w-full text-left transition-colors hover:bg-slate-50">
          <div className="relative flex items-center gap-3 px-4 py-3.5 pr-14 sm:px-5 sm:py-4">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
              <Sparkles className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold text-slate-900">{t('releaseNoticeTitle')}</p>
                <span className="inline-flex shrink-0 items-center rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                  <time dateTime={releaseNotes.date}>{releaseNotes.dateLabel}</time>
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-slate-500">{t('releaseNoticeSubtitle')}</p>
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDismiss();
          }}
          className="ui-icon-button absolute inset-y-0 right-2 my-auto"
          aria-label={t('releaseNoticeClose')}
        >
          <X className="h-4 w-4" />
        </button>

        <div className="pointer-events-none absolute inset-x-4 bottom-2 h-1 overflow-hidden rounded-full bg-slate-100 sm:inset-x-5">
          <div
            className="h-full rounded-full bg-sky-500 transition-transform ease-linear"
            style={{
              transform: isVisible ? 'scaleX(0)' : 'scaleX(1)',
              transformOrigin: 'right center',
              transitionDuration: `${DEFAULT_DURATION_MS}ms`,
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default ReleaseUpdateNotice;
