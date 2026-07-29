const DEFAULT_SETTINGS = {
  defaultLanguage: 'en',
  themeMode: 'system',
  showNewsImages: true,
  readerPanelPosition: 'right',
  readerTextSize: 'medium',
  readerTextWidth: 'default',
  lastSeenReleaseNotesVersion: '',
  excludedSourceIds: [],
  excludedSubSourceIds: []
};

const DEFAULT_LIMITS = {
  apiTokenTtlDays: 30,
  customSourcesMaxCount: 8
};

const DEFAULT_FEATURES = {
  feedback: { enabled: true }
};

export function createTestCurrentUser({
  user = {},
  settings = {},
  limits = {},
  customSources = [],
  apiToken = null,
  features = DEFAULT_FEATURES,
  ...overrides
} = {}) {
  return {
    user: { username: 'alice', isAdmin: false, ...user },
    settings: { ...DEFAULT_SETTINGS, ...settings },
    limits: { ...DEFAULT_LIMITS, ...limits },
    customSources,
    apiToken,
    features,
    ...overrides
  };
}
