import { useEffect, useRef, useState } from 'react';

export default function useFeedSearch({
  onSearchClear,
  onOpenSurface,
  closeSignal = null,
}: { onSearchClear?: () => void; onOpenSurface?: () => void; closeSignal?: number | null } = {}) {
  const [searchMode, setSearchMode] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const handleEnterSearch = () => {
    onOpenSurface?.();
    setSearchMode(true);
  };

  const handleExitSearch = () => {
    setSearchMode(false);
    onSearchClear?.();
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
    searchMode,
  };
}
