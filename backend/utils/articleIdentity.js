const TRACKING_PARAM_PREFIXES = [
  'utm_',
  'ga_',
  'pk_',
  'wt.'
];

const TRACKING_PARAM_NAMES = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'mc_cid',
  'mc_eid',
  'mkt_tok',
  'ocid',
  'ref_src',
  's_cid',
  'smid',
  'xtor'
]);

function normalizeIdentityText(value, options = {}) {
  const normalized = String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return '';
  }

  return options.lowercase ? normalized.toLowerCase() : normalized;
}

function isTrackingQueryParam(paramName) {
  const normalizedName = normalizeIdentityText(paramName, { lowercase: true });
  if (!normalizedName) {
    return false;
  }

  if (TRACKING_PARAM_NAMES.has(normalizedName)) {
    return true;
  }

  return TRACKING_PARAM_PREFIXES.some((prefix) => normalizedName.startsWith(prefix));
}

function normalizeArticleUrl(rawUrl) {
  const trimmedUrl = normalizeIdentityText(rawUrl);
  if (!trimmedUrl) {
    return '';
  }

  try {
    const parsedUrl = new URL(trimmedUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return trimmedUrl;
    }

    parsedUrl.hash = '';
    parsedUrl.username = '';
    parsedUrl.password = '';

    if ((parsedUrl.protocol === 'https:' && parsedUrl.port === '443') || (parsedUrl.protocol === 'http:' && parsedUrl.port === '80')) {
      parsedUrl.port = '';
    }

    const retainedParams = [...parsedUrl.searchParams.entries()]
      .filter(([key]) => !isTrackingQueryParam(key))
      .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
        if (leftKey === rightKey) {
          return leftValue.localeCompare(rightValue);
        }

        return leftKey.localeCompare(rightKey);
      });

    parsedUrl.search = '';
    retainedParams.forEach(([key, value]) => {
      parsedUrl.searchParams.append(key, value);
    });

    if (parsedUrl.pathname.length > 1) {
      parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/u, '');
    }

    return parsedUrl.toString();
  } catch {
    return trimmedUrl;
  }
}

module.exports = {
  normalizeArticleUrl,
  normalizeIdentityText
};
