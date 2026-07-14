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
  apiTokenTtlDays: 30
};

export function createTestCurrentUser({
  user = {},
  settings = {},
  limits = {},
  customSources = [],
  apiToken = null,
  ...overrides
} = {}) {
  return {
    user: { username: 'alice', isAdmin: false, ...user },
    settings: { ...DEFAULT_SETTINGS, ...settings },
    limits: { ...DEFAULT_LIMITS, ...limits },
    customSources,
    apiToken,
    ...overrides
  };
}
