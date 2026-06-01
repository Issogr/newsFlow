import React from 'react';
import { Search, X } from 'lucide-react';

export function FilterBubble({ children, open, className, closedClassName = 'translate-y-2', maxHeight }) {
  return (
    <div
      className={`${className} transition-all duration-200 ease-out ${
        open
          ? 'pointer-events-auto translate-y-0 opacity-100'
          : `pointer-events-none ${closedClassName} opacity-0`
      }`}
      aria-hidden={!open}
      inert={open ? undefined : ''}
    >
      <div className="max-h-[var(--filter-bubble-max-height)] overflow-y-auto overscroll-contain p-4" style={{ '--filter-bubble-max-height': maxHeight }}>
        {children}
      </div>
    </div>
  );
}

export function FilterSearchInput({
  cancelIconClassName = 'h-4 w-4',
  className,
  inputTabIndex,
  labelClassName = 'h-11',
  onCancel,
  onSearchChange,
  onSearchClear,
  search,
  searchInputRef,
  t,
}) {
  return (
    <div className={className}>
      <label className={`group flex flex-1 items-center gap-2 rounded-full border border-slate-200/80 bg-gradient-to-r from-slate-50 to-white px-3.5 shadow-inner shadow-slate-200/60 transition-colors focus-within:border-sky-300 focus-within:bg-white focus-within:ring-2 focus-within:ring-sky-100 ${labelClassName}`}>
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm transition-colors group-focus-within:text-sky-600">
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
          className="min-w-0 flex-1 bg-transparent text-sm font-medium text-slate-800 outline-none placeholder:font-normal placeholder:text-slate-400"
        />
        {search && (
          <button
            type="button"
            onClick={onSearchClear}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700"
            aria-label={t('clearSearch')}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </label>
      <button
        type="button"
        onClick={onCancel}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white shadow-sm transition-colors hover:bg-slate-700"
        aria-label={t('cancel')}
      >
        <X className={cancelIconClassName} aria-hidden="true" />
      </button>
    </div>
  );
}
