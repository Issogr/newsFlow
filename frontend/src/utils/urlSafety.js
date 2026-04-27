export function getSafeExternalUrl(rawUrl) {
  if (!rawUrl) {
    return '';
  }

  try {
    const normalizedUrl = String(rawUrl).trim();
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      return '';
    }

    const parsedUrl = new URL(normalizedUrl);
    return ['http:', 'https:'].includes(parsedUrl.protocol) ? parsedUrl.toString() : '';
  } catch {
    return '';
  }
}
