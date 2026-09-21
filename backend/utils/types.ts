export type DynamicRecord = Record<string, unknown>;
export type UnknownRecord = DynamicRecord;
export type DateInput = Date | string | number;

export interface AppError extends Error {
  code?: string;
  status?: number;
  statusCode?: number;
  headers?: Record<string, string | string[] | undefined>;
  requestCount?: number;
  retryCount?: number;
}

export interface AuthUser {
  id: string;
  username: string;
  isAdmin: boolean;
  sessionToken?: string;
}

export interface UserRecord extends DynamicRecord {
  id: string;
  username: string;
  passwordHash?: string | null;
  lastActivityAt?: string | null;
}

export interface PasswordSetupTokenRecord extends DynamicRecord {
  expiresAt: string;
  purpose: string;
  usedAt?: string | null;
  userId: string;
  username: string;
}

export interface SummarySource extends DynamicRecord {
  articleId?: string;
  contentHash?: string;
}

export interface SummaryRecord extends DynamicRecord {
  articleCount?: number;
  errorMessage?: string;
  failureCategory?: string;
  generatedAt?: string;
  lastAttemptAt?: string;
  id?: string;
  model?: string;
  periodEnd?: string;
  periodStart?: string;
  retryCount?: number;
  sources?: SummarySource[];
  status?: string;
  summaryText?: string;
  summaryTextByLocale?: Record<string, string>;
  topicKey?: string;
}

export interface ApiTokenRecord {
  id: string;
  userId: string;
  username: string;
  expiresAt: string;
  [key: string]: unknown;
}

export interface SessionRecord {
  tokenHash: string;
  userId: string;
  username: string;
  expiresAt: string;
  [key: string]: unknown;
}

export interface SourceDefinition {
  id: string;
  name: string;
  url: string;
  iconUrl?: string;
  type?: string;
  language?: string;
  groupId?: string;
  subSource?: string;
  userId?: string;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string | null;
  validatedAt?: string | null;
  [key: string]: unknown;
}

export interface SourceGroup {
  id: string;
  name: string;
  language: string | null;
  domain: string;
  iconUrl: string;
  subSources: Array<{
    id: string;
    name: string;
    label: string;
    language: string | null;
    iconUrl: string;
  }>;
  memberIds: Set<string>;
  memberNames: Set<string>;
  legacyIds: Set<string>;
}

export interface NewsArticle {
  id: string;
  title: string;
  description: string;
  content: string;
  url: string;
  canonicalUrl?: string;
  image?: string | null;
  author?: string | null;
  language?: string;
  pubDate: string;
  source: string;
  sourceId?: string;
  rawSource?: string;
  rawSourceId?: string;
  sourceIconUrl?: string;
  subSource?: string | null;
  ownerUserId?: string | null;
  topics: string[];
  storyGroupId?: string | null;
  items?: NewsArticle[];
  sources?: string[];
  [key: string]: unknown;
}

export interface NewsQuery extends DynamicRecord {
  search: string;
  sourceIds: string[];
  topics: string[];
  recentHours: number | null;
  beforePubDate: string;
  beforeId: string;
  excludeArticleIds: string[];
  page: number;
  pageSize: number;
  refresh: boolean;
  includeFilters: boolean;
}

export interface UserSettings {
  defaultLanguage?: string;
  excludedSourceIds?: string[];
  excludedSubSourceIds?: string[];
  lastSeenReleaseNotesVersion?: string;
  readerPanelPosition?: string;
  readerTextSize?: string;
  readerTextWidth?: string;
  showNewsImages?: boolean;
  sourceSetupCompleted?: boolean;
  themeMode?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

declare global {
  namespace Express {
    interface Request {
      user: AuthUser;
      externalApi?: {
        authenticated: boolean;
        token: string | null;
        tokenInfo: ApiTokenRecord | null;
        user: AuthUser | null;
      };
      externalApiAuthError?: AppError;
    }
  }
}
