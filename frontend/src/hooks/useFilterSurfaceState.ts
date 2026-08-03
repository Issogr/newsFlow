import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react';

type BubbleName = 'sources' | 'topics';

export default function useFilterSurfaceState({
  onSearchClear,
  onOpenSurface,
  closeSignal = null,
}: { onSearchClear?: () => void; onOpenSurface?: () => void; closeSignal?: number | null } = {}) {
  const [openBubble, setOpenBubble] = useState<BubbleName | null>(null);
  const [searchMode, setSearchMode] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const ignoreNextToggleClickRef = useRef(false);

  const closeAll = useCallback(({ closeSearch = false } = {}) => {
    setOpenBubble(null);
    if (closeSearch) {
      setSearchMode(false);
    }
  }, []);

  const handleToggleBubble = useCallback((name: BubbleName) => {
    setSearchMode(false);
    onOpenSurface?.();
    setOpenBubble((current) => (current === name ? null : name));
  }, [onOpenSurface]);

  const handleBubbleButtonPress = useCallback((event: SyntheticEvent, name: BubbleName) => {
    event.preventDefault();
    event.stopPropagation();
    ignoreNextToggleClickRef.current = true;
    handleToggleBubble(name);
  }, [handleToggleBubble]);

  const handleBubbleButtonClick = useCallback((event: SyntheticEvent, name: BubbleName) => {
    event.stopPropagation();
    if (ignoreNextToggleClickRef.current) {
      ignoreNextToggleClickRef.current = false;
      return;
    }

    handleToggleBubble(name);
  }, [handleToggleBubble]);

  const handleEnterSearch = useCallback(() => {
    setOpenBubble(null);
    onOpenSurface?.();
    setSearchMode(true);
  }, [onOpenSurface]);

  const handleExitSearch = useCallback(() => {
    setSearchMode(false);
    onSearchClear?.();
  }, [onSearchClear]);

  useEffect(() => {
    if (searchMode && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchMode]);

  useEffect(() => {
    if (closeSignal === null) {
      return;
    }

    closeAll({ closeSearch: true });
  }, [closeAll, closeSignal]);

  useEffect(() => {
    if (!openBubble) {
      return undefined;
    }

    const handleScroll = () => setOpenBubble(null);
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => window.removeEventListener('scroll', handleScroll);
  }, [openBubble]);

  return {
    closeAll,
    handleBubbleButtonClick,
    handleBubbleButtonPress,
    handleEnterSearch,
    handleExitSearch,
    openBubble,
    searchInputRef,
    searchMode,
    surfaceRef,
  };
}
