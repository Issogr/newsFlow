import { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';

const DEFAULT_DURATION_MS = 30000;
const ENTRY_DELAY_MS = 16;

const ReleaseUpdateNotice = ({ t, releaseNotes, onOpen, onDismiss }) => {
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
  }, [onDismiss, releaseNotes.version]);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(1rem+env(safe-area-inset-top))] z-50 flex justify-center pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:top-[calc(1.25rem+env(safe-area-inset-top))]">
      <div
        role="status"
        className={`pointer-events-auto relative w-full max-w-lg overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-[0_18px_45px_rgba(15,23,42,0.14)] ring-1 ring-slate-200 transition-all duration-300 ease-out ${isVisible ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0'}`}
      >
        <button type="button" onClick={onOpen} className="block w-full text-left transition-colors hover:bg-slate-50">
          <div className="relative flex items-center gap-3 px-4 py-3.5 pr-14 sm:px-5 sm:py-4">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white bg-sky-100 text-sky-700 shadow-sm">
              <Sparkles className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold text-slate-900">{t('releaseNoticeTitle')}</p>
                <span className="inline-flex shrink-0 items-center rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                  v{releaseNotes.version}
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
          className="absolute inset-y-0 right-3 my-auto flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:bg-slate-100 hover:text-slate-900"
          aria-label={t('releaseNoticeClose')}
        >
          <X className="h-4 w-4" />
        </button>

        <div className="pointer-events-none absolute inset-x-4 bottom-2 h-1 overflow-hidden rounded-full bg-slate-100 sm:inset-x-5">
          <div
            className="h-full rounded-full bg-gradient-to-r from-sky-400 via-sky-500 to-sky-600 transition-transform ease-linear"
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
