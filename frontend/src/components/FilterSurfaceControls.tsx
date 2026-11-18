import { Search, X } from 'lucide-react';
import type { RefObject } from 'react';
import type { Translator } from '../types';

export function FilterSearchInput({
  cancelClassName = '',
  className,
  inputTabIndex,
  onCancel,
  onSearchChange,
  onSearchClear,
  search,
  searchInputRef,
  t,
}: {
  cancelClassName?: string;
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
      <div className="group flex h-full min-w-0 flex-1 items-center gap-2 rounded-xl border border-line bg-surface px-3 transition-colors focus-within:border-sky-500">
        <Search className="h-4 w-4 shrink-0 text-ink-subtle group-focus-within:text-sky-600" aria-hidden="true" />
        <input
          ref={searchInputRef}
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t('searchStories')}
          title={t('searchPlaceholder')}
          aria-label={t('searchLabel')}
          tabIndex={inputTabIndex}
          className="min-w-0 flex-1 bg-transparent text-base font-medium text-ink-emphasis outline-none placeholder:font-normal placeholder:text-ink-placeholder md:text-sm"
        />
        {search && (
          <button
            type="button"
            onClick={() => {
              onSearchClear();
              searchInputRef.current?.focus();
            }}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-subtle transition-colors hover:bg-hover-raised hover:text-ink-emphasis"
            aria-label={t('clearSearch')}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onCancel}
        className={`ui-icon-button h-full w-auto aspect-square ${cancelClassName}`}
        aria-label={t('cancel')}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
