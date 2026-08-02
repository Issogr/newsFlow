import type { ReactNode } from 'react';

export type Locale = 'en' | 'it';
export type TranslationParam = string | number | boolean | null | undefined;
export type TranslationParams = Record<string, TranslationParam>;
export type Translator = (key: string, params?: TranslationParams) => string;
export type TranslationDictionary = Record<string, string | ((params: TranslationParams) => string)>;

export interface TopicEntry {
  topic: string;
  source?: string;
  confidence?: number;
  [key: string]: unknown;
}

export interface NewsArticle {
  id?: string;
  title?: string;
  description?: string;
  url?: string;
  canonicalUrl?: string;
  pubDate?: string;
  sourceId?: string;
  source?: string;
  rawSource?: string;
  subSource?: string;
  sourceIconUrl?: string;
  image?: string;
  ownerUserId?: string;
  storyGroupId?: string;
  aiStoryGroupStatus?: string;
  topics?: string[];
  topicDetails?: TopicEntry[];
  clickbaitLabel?: string;
  clickbaitScore?: number | null;
  clickbaitSource?: string;
  clickbaitConfidence?: number | null;
  clickbaitModel?: string;
  [key: string]: unknown;
}

export interface NewsGroup extends NewsArticle {
  items: NewsArticle[];
  cursorId?: string;
  sources?: string[];
  readLater?: boolean;
  readLaterArticleIds?: string[];
}

export interface SubSource {
  id: string;
  name?: string;
  label?: string;
  language?: string;
  iconUrl?: string;
  [key: string]: unknown;
}

export interface NewsSource {
  id: string;
  name: string;
  url?: string;
  language?: string;
  iconUrl?: string;
  count?: number;
  isActive?: boolean;
  subSources?: SubSource[];
  [key: string]: unknown;
}

export interface AvailableTopic {
  topic: string;
  count?: number;
}

export interface ActiveFilters {
  sourceIds: string[];
  topics: string[];
}

export interface UserSettings {
  defaultLanguage?: Locale;
  themeMode?: 'system' | 'light' | 'dark';
  showNewsImages?: boolean;
  readerPanelPosition?: 'left' | 'center' | 'right';
  readerTextSize?: 'small' | 'medium' | 'large';
  readerTextWidth?: 'default' | 'wide' | 'widest';
  lastSeenReleaseNotesVersion?: string;
  excludedSourceIds?: string[];
  excludedSubSourceIds?: string[];
  sourceSetupCompleted?: boolean;
  [key: string]: unknown;
}

export interface UserIdentity {
  id?: string;
  username: string;
  isAdmin: boolean;
  [key: string]: unknown;
}

export interface ApiTokenInfo {
  id?: string;
  tokenPrefix?: string;
  expiresAt?: string;
  createdAt?: string;
  lastUsedAt?: string | null;
  [key: string]: unknown;
}

export interface CurrentUser {
  id?: string;
  user: UserIdentity;
  settings: UserSettings;
  limits?: {
    apiTokenTtlDays?: number;
    customSourcesMaxCount?: number;
    feedbackAttachmentMaxBytes?: number;
    feedbackTitleMaxLength?: number;
    feedbackDescriptionMaxLength?: number;
    feedbackImageMaxBytes?: number;
    feedbackVideoMaxBytes?: number;
    [key: string]: unknown;
  };
  features?: {
    feedback?: { enabled?: boolean; [key: string]: unknown };
    ai?: { thematicSummariesEnabled?: boolean; podcastsEnabled?: boolean; [key: string]: unknown };
    publicApi?: { authenticatedEnabled?: boolean; [key: string]: unknown };
    [key: string]: unknown;
  };
  customSources?: NewsSource[];
  sourceCatalog?: NewsSource[];
  apiToken?: ApiTokenInfo | null;
  [key: string]: unknown;
}

export interface ThematicSummaryAudio {
  audioStatus?: string;
  audioUrl?: string;
  audioLocale?: string;
  [key: string]: unknown;
}

export interface ThematicSummary extends ThematicSummaryAudio {
  id: string;
  type?: string;
  topicKey?: string;
  topicLabel?: string;
  topics?: string[];
  periodStart?: string;
  periodEnd?: string;
  generatedAt?: string;
  articleCount?: number;
  titleByLocale?: Partial<Record<Locale, string>>;
  summaryTextByLocale?: Partial<Record<Locale, string>>;
  summaryText?: string;
  summarySlot?: string;
  podcastSlot?: string;
  status?: string;
  audioByLocale?: Record<string, ThematicSummaryAudio>;
  sources?: Array<{ index?: number; source?: string; title?: string; url?: string; [key: string]: unknown }>;
  previousSummary?: ThematicSummary | null;
  [key: string]: unknown;
}

export interface FeedCursor {
  beforePubDate?: string;
  beforeId?: string;
  excludeArticleIds?: string[];
}

export interface FeedMeta {
  page?: number;
  hasMore?: boolean;
  nextCursor?: FeedCursor | null;
  pendingUserRefresh?: boolean;
  [key: string]: unknown;
}

export interface FeedFilters {
  sources?: NewsSource[];
  topics?: AvailableTopic[];
  sourceCatalog?: NewsSource[];
  [key: string]: unknown;
}

export interface FeedResponse {
  items: NewsGroup[];
  meta?: FeedMeta;
  filters?: FeedFilters;
  [key: string]: unknown;
}

export interface ReaderBlock {
  type?: string;
  level?: number;
  text?: string;
  items?: string[] | null;
}

export interface ReaderResponse {
  minutesToRead?: number;
  fallback?: boolean;
  byline?: string;
  contentBlocks?: ReaderBlock[];
  [key: string]: unknown;
}

export interface AdminUser {
  id: string;
  username: string;
  isAdmin: boolean;
  isOnline?: boolean;
  isActive?: boolean;
  passwordConfigured?: boolean;
  createdAt?: string;
  lastLoginAt?: string | null;
  lastActivityAt?: string | null;
  publicApiRequestCount?: number;
  publicApiLastUsedAt?: string | null;
  [key: string]: unknown;
}

export interface AdminSummary {
  totalUsers: number;
  onlineUsers: number;
  activeUsers: number;
  onlineWindowMinutes: number;
  anonymousPublicApiRequests?: number;
}

export interface ApiErrorLike {
  code?: string;
  message?: string;
  name?: string;
  newsFlowClientCode?: string;
  config?: { url?: string };
  response?: {
    status?: number;
    statusText?: string;
    data?: { error?: { message?: string; [key: string]: unknown }; [key: string]: unknown };
  };
  [key: string]: unknown;
}

export interface ChangelogContent {
  eyebrow: string;
  title: string;
  intro: string;
  items: string[];
}

export type ReleaseNotes = ChangelogContent & { version: string };

export interface ChildrenProps {
  children: ReactNode;
}
