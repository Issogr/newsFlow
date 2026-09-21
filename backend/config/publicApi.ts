import { parseBooleanEnv } from '../utils/env';

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

export default {
  getPublicApiFeatures,
  isAnonymousPublicApiEnabled,
  isAuthenticatedPublicApiEnabled
};
