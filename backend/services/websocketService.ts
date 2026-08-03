const logger = require('../utils/logger');
const { getAllowedOrigins, isOriginAllowed } = require('../utils/networkConfig');
const { hasTrustedInternalService } = require('../utils/internalRequestGate');
const { parseIntegerEnv } = require('../utils/env');
const { buildDomainSourceGroups } = require('../utils/sourceCatalog');
const database = require('./database');
const { resolveAuthenticatedSession } = require('../utils/auth');
import type { Server as HttpServer } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import type { AppError, DynamicRecord, SourceGroup } from '../utils/types';

interface SocketFilterInput extends DynamicRecord {
  excludedSourceIds?: unknown;
  excludedSubSourceIds?: unknown;
  recentHours?: unknown;
  search?: unknown;
  sourceIds?: unknown;
  topics?: unknown;
}

interface SocketFilters {
  excludedSourceIds: string[];
  excludedSubSourceIds: string[];
  recentHours: number | null;
  search: string;
  sourceIds: string[];
  topics: string[];
}

interface SocketFilterSets {
  excludedSourceIds: Set<string>;
  excludedSubSourceIds: Set<string>;
  recentHours: number | null;
  search: string;
  sourceIds: Set<string>;
  topics: Set<string>;
}

interface MatchFilters {
  excludedSourceIds?: Set<string> | string[];
  excludedSubSourceIds?: Set<string> | string[];
  recentHours?: number | null;
  search?: string;
  sourceIds?: Set<string> | string[];
  topics?: Set<string> | string[];
}

interface SocketData extends DynamicRecord {
  filterSets?: SocketFilterSets;
  filters?: SocketFilters;
  filterSignature?: string;
  sessionExpiresAt?: string;
  sessionExpiryTimer?: NodeJS.Timeout | null;
  sessionTokenHash?: string;
  userId?: string;
  username?: string;
}

interface SocketLike {
  data: SocketData;
  disconnect: (close?: boolean) => void;
  emit: (event: string, payload: unknown) => void;
  handshake?: { headers?: IncomingHttpHeaders };
  id: string;
  on(event: 'disconnect', listener: () => void): void;
  on(event: 'subscribe:filters', listener: (filters?: SocketFilterInput) => void): void;
}

interface SocketServerLike {
  on: (event: 'connection', listener: (socket: SocketLike) => void) => void;
  use: (listener: (socket: SocketLike, next: (error?: Error) => void) => void) => void;
}

interface GroupItem extends DynamicRecord {
  content?: unknown;
  description?: unknown;
  pubDate?: string;
  rawSource?: string;
  rawSourceId?: string;
  source?: string;
  sourceId?: string;
  subSource?: unknown;
  title?: unknown;
}

interface NewsGroup extends DynamicRecord {
  description?: unknown;
  id?: string;
  items?: GroupItem[];
  ownerUserId?: string;
  pubDate?: string;
  pubDateMs?: number;
  rawSourceIdSet?: Set<string>;
  searchableText?: string;
  sourceIdSet?: Set<string>;
  sources?: string[];
  title?: unknown;
  topicSet?: Set<string>;
  topics?: string[];
}

interface SocketBucket {
  filters: MatchFilters;
  sockets: SocketLike[];
  userId: string;
}

interface FeedRefreshOptions extends DynamicRecord {
  reason?: string;
  userIds?: string[];
}

let io: SocketServerLike | null = null;
let websocketStartTime = Date.now();

const activeConnections = new Map<string, SocketLike>();
const statistics = {
  totalConnections: 0,
  activeConnectionsCount: 0,
  newsUpdatesSent: 0,
  failedBroadcasts: 0
};
const MAX_TIMEOUT_MS = 2_147_483_647;

function removeActiveSocket(socket: SocketLike) {
  if (socket?.data?.sessionExpiryTimer) {
    clearTimeout(socket.data.sessionExpiryTimer);
    socket.data.sessionExpiryTimer = null;
  }

  if (socket?.id && activeConnections.delete(socket.id)) {
    statistics.activeConnectionsCount = Math.max(0, statistics.activeConnectionsCount - 1);
  }
}

function disconnectSocket(socket: SocketLike) {
  removeActiveSocket(socket);
  socket?.disconnect?.(true);
}

function scheduleSessionExpiryCheck(socket: SocketLike) {
  const expiresAt = Date.parse(socket?.data?.sessionExpiresAt || '');
  if (!socket?.data?.sessionTokenHash || !Number.isFinite(expiresAt)) {
    return;
  }

  const delay = Math.min(Math.max(0, expiresAt - Date.now()), MAX_TIMEOUT_MS);
  socket.data.sessionExpiryTimer = setTimeout(() => {
    try {
      const session = database.findSessionByTokenHash(socket.data.sessionTokenHash);
      const nextExpiresAt = Date.parse(session?.expiresAt || '');
      if (!session || !Number.isFinite(nextExpiresAt) || nextExpiresAt <= Date.now()) {
        disconnectSocket(socket);
        return;
      }

      socket.data.sessionExpiresAt = session.expiresAt;
      scheduleSessionExpiryCheck(socket);
    } catch (error) {
      logger.warn(`WebSocket session expiry check failed: ${(error as AppError).message}`);
      disconnectSocket(socket);
    }
  }, delay);
  socket.data.sessionExpiryTimer?.unref?.();
}

function normalizeFilterValues(values: unknown = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value): value is string => typeof value === 'string' && Boolean(value)))].sort();
}

function normalizeSearchValue(value: unknown = '') {
  return String(value || '').trim().toLowerCase();
}

function normalizeRecentHours(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function buildSearchableText(group: NewsGroup = {}) {
  return [
    group.title,
    group.description,
    ...(Array.isArray(group.topics) ? group.topics : []),
    ...(Array.isArray(group.sources) ? group.sources : []),
    ...(Array.isArray(group.items)
      ? group.items.flatMap((item) => [item?.title, item?.description, item?.content, item?.source, item?.subSource])
      : [])
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function buildSocketFilters(filters: SocketFilterInput = {}) {
  const normalizedFilters = {
    search: normalizeSearchValue(filters.search),
    topics: normalizeFilterValues(filters.topics),
    sourceIds: normalizeFilterValues(filters.sourceIds),
    recentHours: normalizeRecentHours(filters.recentHours),
    excludedSourceIds: normalizeFilterValues(filters.excludedSourceIds),
    excludedSubSourceIds: normalizeFilterValues(filters.excludedSubSourceIds)
  };

  return {
    filters: normalizedFilters,
    filterSets: {
      search: normalizedFilters.search,
      topics: new Set(normalizedFilters.topics),
      sourceIds: new Set(normalizedFilters.sourceIds),
      recentHours: normalizedFilters.recentHours,
      excludedSourceIds: new Set(normalizedFilters.excludedSourceIds),
      excludedSubSourceIds: new Set(normalizedFilters.excludedSubSourceIds)
    },
    filterSignature: JSON.stringify(normalizedFilters)
  };
}

function initialize(server: HttpServer) {
  const socketIo = require('socket.io');
  const allowedOrigins = getAllowedOrigins();

  const socketServer: SocketServerLike = socketIo(server, {
    cors: {
      origin: (origin: string | undefined, callback: (error: Error | null, allowed?: boolean) => void) => {
        if (isOriginAllowed(origin, allowedOrigins)) {
          callback(null, true);
          return;
        }

        callback(new Error('Origin not allowed'));
      },
      methods: ['GET', 'POST'],
      credentials: true
    },
    pingTimeout: parseIntegerEnv('WS_PING_TIMEOUT', 60000, { min: 1000 }),
    pingInterval: parseIntegerEnv('WS_PING_INTERVAL', 25000, { min: 1000 }),
    transports: ['websocket', 'polling'],
    allowRequest: (req: { headers: IncomingHttpHeaders }, callback: (error: string | null, allowed: boolean) => void) => {
      if (!hasTrustedInternalService(req.headers)) {
        callback('Origin not allowed', false);
        return;
      }

      callback(null, true);
    }
  });
  io = socketServer;

  socketServer.use((socket, next) => {
    try {
      const { session, user } = resolveAuthenticatedSession({
        headers: socket.handshake?.headers || {},
        touchActivitySeconds: 60
      });

      socket.data.userId = user.id;
      socket.data.username = user.username;
      socket.data.sessionTokenHash = session.tokenHash;
      socket.data.sessionExpiresAt = session.expiresAt;
      next();
    } catch (error) {
      next(new Error(`WebSocket auth failed: ${(error as AppError).message}`));
    }
  });

  socketServer.on('connection', (socket) => {
    statistics.totalConnections += 1;
    statistics.activeConnectionsCount += 1;
    activeConnections.set(socket.id, socket);
    Object.assign(socket.data, buildSocketFilters());
    scheduleSessionExpiryCheck(socket);

    socket.on('subscribe:filters', (filters = {}) => {
      database.touchUserActivity(socket.data.userId, new Date().toISOString(), 60);
      Object.assign(socket.data, buildSocketFilters(filters));
    });

    socket.on('disconnect', () => {
      removeActiveSocket(socket);
    });
  });

  websocketStartTime = Date.now();
  logger.info('WebSocket service initialized');

  return socketServer;
}

function disconnectUserSockets(userId: string) {
  if (!userId) {
    return 0;
  }

  let disconnected = 0;

  activeConnections.forEach((socket) => {
    if (socket.data?.userId !== userId) {
      return;
    }

    disconnected += 1;

    try {
      disconnectSocket(socket);
    } catch (error) {
      logger.warn(`WebSocket disconnect failed for deleted user ${userId}: ${(error as AppError).message}`);
    }
  });

  if (disconnected > 0) {
    logger.info(`Disconnected ${disconnected} active WebSocket connection(s) for deleted user ${userId}`);
  }

  return disconnected;
}

function disconnectSessionSockets(sessionTokenHash: string) {
  if (!sessionTokenHash) {
    return 0;
  }

  let disconnected = 0;
  activeConnections.forEach((socket) => {
    if (socket.data?.sessionTokenHash !== sessionTokenHash) {
      return;
    }

    disconnected += 1;
    try {
      disconnectSocket(socket);
    } catch (error) {
      logger.warn(`WebSocket disconnect failed for revoked session: ${(error as AppError).message}`);
    }
  });
  return disconnected;
}

function groupMatchesFilters(group: NewsGroup, filters: MatchFilters = {}) {
  const searchFilter = typeof filters.search === 'string' ? filters.search : normalizeSearchValue(filters.search);
  const topicFilters = filters.topics instanceof Set
    ? filters.topics
    : new Set<string>(Array.isArray(filters.topics) ? filters.topics : []);
  const sourceFilters = filters.sourceIds instanceof Set
    ? filters.sourceIds
    : new Set<string>(Array.isArray(filters.sourceIds) ? filters.sourceIds : []);
  const recentHoursFilter = typeof filters.recentHours === 'number' && Number.isFinite(filters.recentHours) && filters.recentHours > 0
    ? filters.recentHours
    : normalizeRecentHours(filters.recentHours);
  const excludedSourceFilters = filters.excludedSourceIds instanceof Set
    ? filters.excludedSourceIds
    : new Set<string>(Array.isArray(filters.excludedSourceIds) ? filters.excludedSourceIds : []);
  const excludedSubSourceFilters = filters.excludedSubSourceIds instanceof Set
    ? filters.excludedSubSourceIds
    : new Set<string>(Array.isArray(filters.excludedSubSourceIds) ? filters.excludedSubSourceIds : []);

  if (searchFilter.length === 0
    && topicFilters.size === 0
    && sourceFilters.size === 0
    && !recentHoursFilter
    && excludedSourceFilters.size === 0
    && excludedSubSourceFilters.size === 0) {
    return true;
  }

  const groupTopics = group.topicSet || new Set(Array.isArray(group.topics) ? group.topics : []);
  const groupSourceIds = group.sourceIdSet || new Set(
    Array.isArray(group.items) ? group.items.map((item) => item.sourceId).filter((value): value is string => Boolean(value)) : []
  );
  const groupRawSourceIds = group.rawSourceIdSet || new Set(
    Array.isArray(group.items) ? group.items.map((item) => item.rawSourceId || item.sourceId).filter((value): value is string => Boolean(value)) : []
  );
  const groupSearchableText = typeof group.searchableText === 'string' ? group.searchableText : buildSearchableText(group);
  const groupPubDateMs = typeof group.pubDateMs === 'number' && Number.isFinite(group.pubDateMs)
    ? group.pubDateMs
    : Date.parse(group.pubDate || group.items?.[0]?.pubDate || '');

  const hasSearchMatch = searchFilter.length === 0 || groupSearchableText.includes(searchFilter);
  const hasTopicMatch = topicFilters.size === 0 || [...topicFilters].some((topic) => groupTopics.has(topic));

  const hasSourceMatch = sourceFilters.size === 0 || [...sourceFilters].some((sourceId) => groupSourceIds.has(sourceId));

  const hasRecentMatch = !recentHoursFilter || (
    Number.isFinite(groupPubDateMs)
    && groupPubDateMs >= (Date.now() - (recentHoursFilter * 60 * 60 * 1000))
  );

  const hasExcludedSource = excludedSourceFilters.size > 0 && [...excludedSourceFilters].some((sourceId) => groupSourceIds.has(sourceId));

  const hasExcludedSubSource = excludedSubSourceFilters.size > 0
    && [...excludedSubSourceFilters].some((sourceId) => groupRawSourceIds.has(sourceId));

  return hasSearchMatch && hasTopicMatch && hasSourceMatch && hasRecentMatch && !hasExcludedSource && !hasExcludedSubSource;
}

function emitToSocket(socket: SocketLike, event: string, payload: unknown) {
  try {
    socket.emit(event, payload);
    return true;
  } catch (error) {
    statistics.failedBroadcasts += 1;
    logger.warn(`WebSocket emit failed for ${event}: ${(error as AppError).message}`);
    return false;
  }
}

function dedupeGroupsById(groups: NewsGroup[] = []) {
  const uniqueGroups = new Map<string, NewsGroup>();

  groups.forEach((group) => {
    if (!group?.id) {
      return;
    }

    if (!uniqueGroups.has(group.id)) {
      uniqueGroups.set(group.id, group);
    }
  });

  return [...uniqueGroups.values()];
}

function getUserCustomSourceGroups(userId: string, cache: Map<string, Map<string, SourceGroup>>): Map<string, SourceGroup> {
  if (!userId) {
    return new Map();
  }

  if (!cache.has(userId)) {
    cache.set(userId, buildDomainSourceGroups(database.listUserSources(userId)));
  }

  return cache.get(userId)!;
}

function addSourceAliasIds(sourceIds: Set<string>, rawSourceIds: Set<string>, item: GroupItem = {}, customSourceGroups = new Map<string, SourceGroup>()) {
  const sourceId = item.sourceId || '';
  const rawSourceId = item.rawSourceId || sourceId;
  const sourceName = item.source || '';
  const rawSourceName = item.rawSource || sourceName;

  if (sourceId) {
    sourceIds.add(sourceId);
  }
  if (rawSourceId) {
    rawSourceIds.add(rawSourceId);
  }

  customSourceGroups.forEach((group: SourceGroup) => {
    const matchesGroup = group.id === sourceId
      || group.memberIds.has(sourceId)
      || group.memberIds.has(rawSourceId)
      || group.memberNames.has(sourceName)
      || group.memberNames.has(rawSourceName);

    if (!matchesGroup) {
      return;
    }

    sourceIds.add(group.id);
    group.memberIds.forEach((memberId: string) => sourceIds.add(memberId));
  });
}

function buildGroupSourceSets(group: NewsGroup = {}, customSourceGroupCache = new Map<string, Map<string, SourceGroup>>()) {
  const sourceIdSet = new Set<string>();
  const rawSourceIdSet = new Set<string>();
  const customSourceGroups = getUserCustomSourceGroups(group.ownerUserId || '', customSourceGroupCache);

  (Array.isArray(group.items) ? group.items : []).forEach((item) => {
    addSourceAliasIds(sourceIdSet, rawSourceIdSet, item, customSourceGroups);
  });

  return { sourceIdSet, rawSourceIdSet };
}

function getBucketCandidateGroups(bucketUserId: string, globalGroups: NewsGroup[], privateGroupsByUserId: Map<string, NewsGroup[]>, cache: Map<string, NewsGroup[]>) {
  if (cache.has(bucketUserId)) {
    return cache.get(bucketUserId)!;
  }

  const candidateGroups = dedupeGroupsById([
    ...globalGroups,
    ...(privateGroupsByUserId.get(bucketUserId) || [])
  ]);
  cache.set(bucketUserId, candidateGroups);
  return candidateGroups;
}

function broadcastNewsUpdate(newsGroups: NewsGroup[] = []) {
  if (!io || !Array.isArray(newsGroups) || newsGroups.length === 0) {
    return;
  }

  let recipients = 0;
  const customSourceGroupCache = new Map<string, Map<string, SourceGroup>>();
  const preparedGroups: NewsGroup[] = newsGroups.map((group) => ({
    ...group,
    searchableText: buildSearchableText(group),
    topicSet: new Set<string>(Array.isArray(group.topics) ? group.topics : []),
    pubDateMs: Date.parse(group.pubDate || group.items?.[0]?.pubDate || ''),
    ...buildGroupSourceSets(group, customSourceGroupCache)
  }));
  const globalGroups = preparedGroups.filter((group) => !group.ownerUserId);
  const privateGroupsByUserId = new Map<string, NewsGroup[]>();
  const socketBuckets = new Map<string, SocketBucket>();
  const candidateGroupCache = new Map<string, NewsGroup[]>();

  preparedGroups.forEach((group) => {
    if (!group.ownerUserId) {
      return;
    }

    const userGroups = privateGroupsByUserId.get(group.ownerUserId) || [];
    userGroups.push(group);
    privateGroupsByUserId.set(group.ownerUserId, userGroups);
  });

  activeConnections.forEach((socket) => {
    const bucketKey = `${socket.data?.userId || ''}:${socket.data?.filterSignature || ''}`;
    const bucket: SocketBucket = socketBuckets.get(bucketKey) || {
      sockets: [],
      userId: socket.data?.userId || '',
      filters: socket.data.filterSets || socket.data.filters || {}
    };
    bucket.sockets.push(socket);
    socketBuckets.set(bucketKey, bucket);
  });

  socketBuckets.forEach((bucket) => {
    const candidateGroups = getBucketCandidateGroups(bucket.userId, globalGroups, privateGroupsByUserId, candidateGroupCache);
    const matchingGroups = candidateGroups.filter((group) => {
      return groupMatchesFilters(group, bucket.filters);
    });

    if (matchingGroups.length === 0) {
      return;
    }

    const payload = {
      count: matchingGroups.length,
      groupIds: matchingGroups.map((group) => group.id),
      timestamp: new Date().toISOString()
    };

    bucket.sockets.forEach((socket) => {
      if (emitToSocket(socket, 'news:update', payload)) {
        recipients += 1;
      }
    });
  });

  statistics.newsUpdatesSent += 1;
  logger.info(`Broadcast news update to ${recipients} clients`);
}

function broadcastFeedRefresh(options: FeedRefreshOptions = {}) {
  if (!io) {
    return;
  }

  const userIds = [...new Set((Array.isArray(options.userIds) ? options.userIds : []).filter(Boolean))];
  const refreshAll = userIds.length === 0;
  const payload = {
    count: 1,
    groupIds: [],
    refresh: true,
    reason: options.reason || 'news',
    timestamp: new Date().toISOString()
  };
  let recipients = 0;

  activeConnections.forEach((socket) => {
    if (!refreshAll && !userIds.includes(socket.data?.userId || '')) {
      return;
    }

    if (emitToSocket(socket, 'news:update', payload)) {
      recipients += 1;
    }
  });

  statistics.newsUpdatesSent += 1;
  logger.info(`Broadcast feed refresh to ${recipients} clients: reason=${payload.reason}`);
}

function getStatistics() {
  return {
    ...statistics,
    uptime: Math.floor((Date.now() - websocketStartTime) / 1000),
    timestamp: new Date().toISOString()
  };
}

module.exports = {
  initialize,
  disconnectUserSockets,
  disconnectSessionSockets,
  broadcastNewsUpdate,
  broadcastFeedRefresh,
  getStatistics
};
