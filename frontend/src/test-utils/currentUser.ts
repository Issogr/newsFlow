import type { ApiTokenInfo, CurrentUser, NewsSource, UserIdentity, UserSettings } from '../types';

const DEFAULT_SETTINGS: UserSettings = {
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

type CurrentUserOverrides = {
  user?: Partial<UserIdentity>;
  settings?: Partial<UserSettings>;
  limits?: NonNullable<CurrentUser['limits']>;
  features?: CurrentUser['features'];
  customSources?: NewsSource[];
  sourceCatalog?: NewsSource[];
  apiToken?: ApiTokenInfo | null;
  [key: string]: unknown;
};

export function createTestCurrentUser({
  user = {},
  settings = {},
  limits = {},
  customSources = [],
  apiToken = null,
  features = DEFAULT_FEATURES,
  ...overrides
}: CurrentUserOverrides = {}): CurrentUser {
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
