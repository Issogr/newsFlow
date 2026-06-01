function parseBooleanEnv(name, fallback = false) {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return fallback;
  }

  const normalized = String(rawValue).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function isAnonymousPublicApiEnabled() {
  return parseBooleanEnv('PUBLIC_API_ANONYMOUS_ENABLED', false);
}

function isAuthenticatedPublicApiEnabled() {
  return parseBooleanEnv('PUBLIC_API_AUTHENTICATED_ENABLED', false);
}

function getPublicApiFeatures() {
  return {
    publicApi: {
      anonymousEnabled: isAnonymousPublicApiEnabled(),
      authenticatedEnabled: isAuthenticatedPublicApiEnabled()
    }
  };
}

module.exports = {
  getPublicApiFeatures,
  isAnonymousPublicApiEnabled,
  isAuthenticatedPublicApiEnabled,
  parseBooleanEnv
};
