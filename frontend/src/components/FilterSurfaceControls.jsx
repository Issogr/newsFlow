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
      inert={open ? undefined : true}
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
  onCancel,
  onSearchChange,
  onSearchClear,
  search,
  searchInputRef,
  t,
}) {
  return (
    <div className={className}>
      <label className="group flex h-full min-w-0 flex-1 items-center gap-2 rounded-[1.25rem] border border-slate-200/80 bg-slate-50/80 px-3 shadow-sm transition-[border-color,background-color,box-shadow] focus-within:border-sky-300 focus-within:bg-white focus-within:shadow-[0_10px_25px_-18px_rgba(14,165,233,0.7)]">
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
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-200/70 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
            aria-label={t('clearSearch')}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </label>
      <button
        type="button"
        onClick={onCancel}
        className="inline-flex h-full aspect-square shrink-0 items-center justify-center rounded-[1.25rem] border border-slate-200/80 bg-slate-50/80 text-slate-500 shadow-sm transition-colors hover:bg-white hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
        aria-label={t('cancel')}
      >
        <X className={cancelIconClassName} aria-hidden="true" />
      </button>
    </div>
  );
}
