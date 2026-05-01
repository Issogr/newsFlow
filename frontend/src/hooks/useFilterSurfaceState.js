import { useCallback, useEffect, useRef, useState } from 'react';

export default function useFilterSurfaceState({
  onSearchClear,
  onOpenSurface,
  closeSignal = null,
} = {}) {
  const [openBubble, setOpenBubble] = useState(null);
  const [searchMode, setSearchMode] = useState(false);
  const searchInputRef = useRef(null);
  const surfaceRef = useRef(null);
  const ignoreNextToggleClickRef = useRef(false);

  const closeBubbles = useCallback(() => setOpenBubble(null), []);

  const closeAll = useCallback(({ closeSearch = false } = {}) => {
    setOpenBubble(null);
    if (closeSearch) {
      setSearchMode(false);
    }
  }, []);

  const handleToggleBubble = useCallback((name) => {
    setSearchMode(false);
    onOpenSurface?.();
    setOpenBubble((current) => (current === name ? null : name));
  }, [onOpenSurface]);

  const handleBubbleButtonPress = useCallback((event, name) => {
    event.preventDefault();
    event.stopPropagation();
    ignoreNextToggleClickRef.current = true;
    handleToggleBubble(name);
  }, [handleToggleBubble]);

  const handleBubbleButtonClick = useCallback((event, name) => {
    event.stopPropagation();
    if (ignoreNextToggleClickRef.current) {
      ignoreNextToggleClickRef.current = false;
      return;
    }

    handleToggleBubble(name);
  }, [handleToggleBubble]);

  const handleEnterSearch = useCallback(() => {
    closeBubbles();
    onOpenSurface?.();
    setSearchMode(true);
  }, [closeBubbles, onOpenSurface]);

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
