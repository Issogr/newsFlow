import { shareArticleUrl } from './shareArticle';

describe('shareArticleUrl', () => {
  const originalShare = navigator.share;
  const originalClipboard = navigator.clipboard;
  const originalOpen = window.open;

  afterEach(() => {
    navigator.share = originalShare;
    navigator.clipboard = originalClipboard;
    window.open = originalOpen;
  });

  test('uses native share when available', async () => {
    navigator.share = vi.fn().mockResolvedValue(undefined);

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
    navigator.share = undefined;
    navigator.clipboard = {
      writeText: vi.fn().mockResolvedValue(undefined)
    };

    await expect(shareArticleUrl({ url: 'https://example.com/story' })).resolves.toBe('copied');
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://example.com/story');

    navigator.clipboard.writeText.mockRejectedValueOnce(new Error('denied'));

    await expect(shareArticleUrl({ url: 'https://example.com/story' })).resolves.toBe('failed');
  });

  test('falls back to opening a new tab when clipboard is unavailable', async () => {
    navigator.share = undefined;
    navigator.clipboard = undefined;
    window.open = vi.fn();

    await expect(shareArticleUrl({ url: 'https://example.com/story' })).resolves.toBe('opened');

    expect(window.open).toHaveBeenCalledWith('https://example.com/story', '_blank', 'noopener,noreferrer');
  });
});
