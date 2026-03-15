export function getSafeExternalUrl(rawUrl) {
  if (!rawUrl) {
    return '';
  }

  try {
    const parsedUrl = new URL(String(rawUrl), window.location.origin);
    return ['http:', 'https:'].includes(parsedUrl.protocol) ? parsedUrl.toString() : '';
  } catch {
    return '';
  }
}
