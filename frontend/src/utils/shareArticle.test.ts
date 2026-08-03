import { shareArticleUrl } from './shareArticle';

describe('shareArticleUrl', () => {
  const originalShare = navigator.share;
  const originalClipboard = navigator.clipboard;
  const originalOpen = window.open;

  afterEach(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: originalShare });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: originalClipboard });
    window.open = originalOpen;
  });

  test('uses native share when available', async () => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: vi.fn().mockResolvedValue(undefined) });

    await expect(shareArticleUrl({
      url: 'https://example.com/story',
      title: 'Headline'
    })).resolves.toBe('shared');

    expect(navigator.share).toHaveBeenCalledWith({
      title: 'Headline',
      url: 'https://example.com/story'
    });
  });

  test('falls back to clipboard and reports clipboard failures', async () => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    window.open = vi.fn();

    await expect(shareArticleUrl({ url: 'https://example.com/story' })).resolves.toBe('copied');
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://example.com/story');

    writeText.mockRejectedValueOnce(new Error('denied'));

    await expect(shareArticleUrl({ url: 'https://example.com/story' })).resolves.toBe('failed');
    expect(window.open).not.toHaveBeenCalled();
  });

  test('falls back to opening a new tab when clipboard is unavailable', async () => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    window.open = vi.fn();

    await expect(shareArticleUrl({ url: 'https://example.com/story' })).resolves.toBe('opened');

    expect(window.open).toHaveBeenCalledWith('https://example.com/story', '_blank', 'noopener,noreferrer');
  });
});
