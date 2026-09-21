import { Search, X } from 'lucide-react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import type { Translator } from '../types';

export function FilterBubble({ children, open, className, closedClassName = 'translate-y-2', maxHeight }: { children: ReactNode; open: boolean; className: string; closedClassName?: string; maxHeight: string }) {
  return (
    <div
      className={`${className} transition-all duration-200 ease-out ${
        open
          ? 'pointer-events-auto translate-y-0 opacity-100'
          : `pointer-events-none ${closedClassName} opacity-0`
      }`}
      aria-hidden={!open}
      inert={open ? undefined : true}
    >
      <div className="max-h-[var(--filter-bubble-max-height)] overflow-y-auto overscroll-contain p-4" style={{ '--filter-bubble-max-height': maxHeight } as CSSProperties}>
        {children}
      </div>
    </div>
  );
}

export function FilterSearchInput({
  cancelIconClassName = 'h-4 w-4',
  className,
  inputTabIndex,
  onCancel,
  onSearchChange,
  onSearchClear,
  search,
  searchInputRef,
  t,
}: {
  cancelIconClassName?: string;
  className: string;
  inputTabIndex?: number;
  onCancel: () => void;
  onSearchChange: (value: string) => void;
  onSearchClear: () => void;
  search: string;
  searchInputRef: RefObject<HTMLInputElement | null>;
  t: Translator;
}) {
  return (
    <div className={className}>
      <label className="group flex h-full min-w-0 flex-1 items-center gap-2 rounded-xl border border-line bg-surface px-3 transition-colors focus-within:border-sky-500">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-slate-500 transition-colors group-focus-within:text-sky-600">
          <Search className="h-4 w-4" aria-hidden="true" />
        </span>
        <input
          ref={searchInputRef}
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchLabel')}
          tabIndex={inputTabIndex}
          className="min-w-0 flex-1 bg-transparent text-base font-medium text-slate-800 outline-none placeholder:font-normal placeholder:text-slate-400 md:text-sm"
        />
        {search && (
          <button
            type="button"
            onClick={onSearchClear}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
            aria-label={t('clearSearch')}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </label>
      <button
        type="button"
        onClick={onCancel}
        className="ui-icon-button h-full w-auto aspect-square"
        aria-label={t('cancel')}
      >
        <X className={cancelIconClassName} aria-hidden="true" />
      </button>
    </div>
  );
}
