const DEFAULT_SETTINGS = {
  defaultLanguage: 'en',
  themeMode: 'system',
  articleRetentionHours: 24,
  recentHours: 3,
  showNewsImages: true,
  readerPanelPosition: 'right',
  readerTextSize: 'medium',
  lastSeenReleaseNotesVersion: '',
  excludedSourceIds: [],
  excludedSubSourceIds: []
};

const DEFAULT_LIMITS = {
  articleRetentionHoursMax: 24,
  recentHoursMax: 3,
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
