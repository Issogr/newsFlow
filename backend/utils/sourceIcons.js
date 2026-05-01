function getProviderIconUrl(value = '') {
  const rawValue = String(value || '').trim();
  if (!rawValue) {
    return '';
  }

  try {
    const parsedUrl = rawValue.includes('://')
      ? new URL(rawValue)
      : new URL(`https://${rawValue}`);

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return '';
    }

    return `${parsedUrl.origin}/favicon.ico`;
  } catch {
    return '';
  }
}

module.exports = {
  getProviderIconUrl
};
