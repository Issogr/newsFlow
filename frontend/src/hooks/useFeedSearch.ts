import { useEffect, useRef, useState } from 'react';

export default function useFeedSearch({
  onSearchClear,
  onOpenSurface,
  closeSignal = null,
}: { onSearchClear?: () => void; onOpenSurface?: () => void; closeSignal?: number | null } = {}) {
  const [searchMode, setSearchMode] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const handleEnterSearch = () => {
    onOpenSurface?.();
    setSearchMode(true);
  };

  const handleExitSearch = () => {
    setSearchMode(false);
    onSearchClear?.();
    requestAnimationFrame(() => searchButtonRef.current?.focus({ preventScroll: true }));
  };

  useEffect(() => {
    if (searchMode && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchMode]);

  useEffect(() => {
    if (closeSignal === null) {
      return;
    }

    setSearchMode(false);
  }, [closeSignal]);

  return {
    closeSearch: () => setSearchMode(false),
    handleEnterSearch,
    handleExitSearch,
    searchInputRef,
    searchButtonRef,
    searchMode,
  };
}
