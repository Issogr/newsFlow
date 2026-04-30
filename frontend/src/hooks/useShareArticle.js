import { useCallback, useEffect, useState } from 'react';
import { shareArticleUrl } from '../utils/shareArticle';

const SHARE_STATUS_TIMEOUT_MS = 1600;

export default function useShareArticle() {
  const [shareState, setShareState] = useState('idle');

  useEffect(() => {
    if (shareState === 'idle') {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setShareState('idle');
    }, SHARE_STATUS_TIMEOUT_MS);

    return () => window.clearTimeout(timeoutId);
  }, [shareState]);

  const shareArticle = useCallback(async ({ url, title }) => {
    const result = await shareArticleUrl({ url, title });
    setShareState(result || 'idle');
    return result;
  }, []);

  const resetShareState = useCallback(() => {
    setShareState('idle');
  }, []);

  return {
    shareState,
    shareArticle,
    resetShareState,
  };
}
