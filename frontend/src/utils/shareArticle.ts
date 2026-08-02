export type ShareResult = 'shared' | 'copied' | 'failed' | 'opened' | null;

export async function shareArticleUrl({ url, title = '' }: { url: string; title?: string }): Promise<ShareResult> {
  if (!url) {
    return null;
  }

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, url });
      return 'shared';
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return null;
      }
    }
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(url);
      return 'copied';
    } catch {
      // Some browsers expose clipboard but reject writes outside secure or granted contexts.
      return 'failed';
    }
  }

  if (typeof window !== 'undefined' && typeof window.open === 'function') {
    window.open(url, '_blank', 'noopener,noreferrer');
    return 'opened';
  }

  return null;
}
