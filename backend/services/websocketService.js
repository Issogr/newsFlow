const logger = require('../utils/logger');
const { getAllowedOrigins, isOriginAllowed } = require('../utils/networkConfig');
const { hasTrustedInternalService } = require('../utils/internalRequestGate');
const database = require('./database');
const { resolveAuthenticatedSession } = require('../utils/auth');

let io;
let websocketStartTime = Date.now();

const activeConnections = new Map();
const statistics = {
  totalConnections: 0,
  activeConnectionsCount: 0,
  newsUpdatesSent: 0,
  failedBroadcasts: 0
};

function normalizeFilterValues(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))].sort();
}

function normalizeSearchValue(value = '') {
  return String(value || '').trim().toLowerCase();
}

function normalizeRecentHours(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function buildSearchableText(group = {}) {
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

function buildSocketFilters(filters = {}) {
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

function initialize(server) {
  const socketIo = require('socket.io');
  const allowedOrigins = getAllowedOrigins();

  io = socketIo(server, {
    cors: {
      origin: (origin, callback) => {
        if (isOriginAllowed(origin, allowedOrigins)) {
          callback(null, true);
          return;
        }

        callback(new Error('Origin not allowed'));
      },
      methods: ['GET', 'POST'],
      credentials: true
    },
    pingTimeout: parseInt(process.env.WS_PING_TIMEOUT || '60000', 10),
    pingInterval: parseInt(process.env.WS_PING_INTERVAL || '25000', 10),
    transports: ['websocket', 'polling'],
    allowRequest: (req, callback) => {
      if (!hasTrustedInternalService(req.headers)) {
        callback('Origin not allowed', false);
        return;
      }

      callback(null, true);
    }
  });

  io.use((socket, next) => {
    try {
      const auth = socket.handshake?.auth || {};
      const { user } = resolveAuthenticatedSession({
        headers: socket.handshake?.headers || {},
        authToken: auth.token,
        touchActivitySeconds: 60
      });

      socket.data.userId = user.id;
      socket.data.username = user.username;
      next();
    } catch (error) {
      next(new Error(`WebSocket auth failed: ${error.message}`));
    }
  });

  io.on('connection', (socket) => {
    statistics.totalConnections += 1;
    statistics.activeConnectionsCount += 1;
    activeConnections.set(socket.id, socket);
    Object.assign(socket.data, buildSocketFilters());

    socket.on('subscribe:filters', (filters = {}) => {
      database.touchUserActivity(socket.data.userId, new Date().toISOString(), 60);
      Object.assign(socket.data, buildSocketFilters(filters));
    });

    socket.on('disconnect', () => {
      if (activeConnections.delete(socket.id)) {
        statistics.activeConnectionsCount = Math.max(0, statistics.activeConnectionsCount - 1);
      }
    });
  });

  websocketStartTime = Date.now();
  logger.info('WebSocket service initialized');

  return io;
}

function disconnectUserSockets(userId) {
  if (!userId) {
    return 0;
  }

  let disconnected = 0;

  activeConnections.forEach((socket) => {
    if (socket.data?.userId !== userId) {
      return;
    }

    if (activeConnections.delete(socket.id)) {
      statistics.activeConnectionsCount = Math.max(0, statistics.activeConnectionsCount - 1);
    }

    disconnected += 1;

    try {
      socket.disconnect?.(true);
    } catch (error) {
      logger.warn(`WebSocket disconnect failed for deleted user ${userId}: ${error.message}`);
    }
  });

  if (disconnected > 0) {
    logger.info(`Disconnected ${disconnected} active WebSocket connection(s) for deleted user ${userId}`);
  }

  return disconnected;
}

function groupMatchesFilters(group, filters = {}) {
  const searchFilter = typeof filters.search === 'string' ? filters.search : normalizeSearchValue(filters.search);
  const topicFilters = filters.topics instanceof Set
    ? filters.topics
    : new Set(Array.isArray(filters.topics) ? filters.topics : []);
  const sourceFilters = filters.sourceIds instanceof Set
    ? filters.sourceIds
    : new Set(Array.isArray(filters.sourceIds) ? filters.sourceIds : []);
  const recentHoursFilter = Number.isFinite(filters.recentHours) && filters.recentHours > 0
    ? filters.recentHours
    : normalizeRecentHours(filters.recentHours);
  const excludedSourceFilters = filters.excludedSourceIds instanceof Set
    ? filters.excludedSourceIds
    : new Set(Array.isArray(filters.excludedSourceIds) ? filters.excludedSourceIds : []);
  const excludedSubSourceFilters = filters.excludedSubSourceIds instanceof Set
    ? filters.excludedSubSourceIds
    : new Set(Array.isArray(filters.excludedSubSourceIds) ? filters.excludedSubSourceIds : []);

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
    Array.isArray(group.items) ? group.items.map((item) => item.sourceId).filter(Boolean) : []
  );
  const groupRawSourceIds = group.rawSourceIdSet || new Set(
    Array.isArray(group.items) ? group.items.map((item) => item.rawSourceId || item.sourceId).filter(Boolean) : []
  );
  const groupSearchableText = typeof group.searchableText === 'string' ? group.searchableText : buildSearchableText(group);
  const groupPubDateMs = Number.isFinite(group.pubDateMs)
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

function emitToSocket(socket, event, payload) {
  try {
    socket.emit(event, payload);
    return true;
  } catch (error) {
    statistics.failedBroadcasts += 1;
    logger.warn(`WebSocket emit failed for ${event}: ${error.message}`);
    return false;
  }
}

function dedupeGroupsById(groups = []) {
  const uniqueGroups = new Map();

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

function getBucketCandidateGroups(bucketUserId, globalGroups, privateGroupsByUserId, cache) {
  if (cache.has(bucketUserId)) {
    return cache.get(bucketUserId);
  }

  const candidateGroups = dedupeGroupsById([
    ...globalGroups,
    ...(privateGroupsByUserId.get(bucketUserId) || [])
  ]);
  cache.set(bucketUserId, candidateGroups);
  return candidateGroups;
}

function broadcastNewsUpdate(newsGroups = []) {
  if (!io || !Array.isArray(newsGroups) || newsGroups.length === 0) {
    return;
  }

  let recipients = 0;
  const preparedGroups = newsGroups.map((group) => ({
    ...group,
    searchableText: buildSearchableText(group),
    topicSet: new Set(Array.isArray(group.topics) ? group.topics : []),
    pubDateMs: Date.parse(group.pubDate || group.items?.[0]?.pubDate || ''),
    sourceIdSet: new Set(Array.isArray(group.items) ? group.items.map((item) => item.sourceId).filter(Boolean) : []),
    rawSourceIdSet: new Set(Array.isArray(group.items) ? group.items.map((item) => item.rawSourceId || item.sourceId).filter(Boolean) : [])
  }));
  const globalGroups = preparedGroups.filter((group) => !group.ownerUserId);
  const privateGroupsByUserId = new Map();
  const socketBuckets = new Map();
  const candidateGroupCache = new Map();

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
    const bucket = socketBuckets.get(bucketKey) || {
      sockets: [],
      userId: socket.data?.userId || '',
      filters: socket.data.filterSets || socket.data.filters
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
      data: matchingGroups.slice(0, 10),
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

function broadcastFeedRefresh(options = {}) {
  if (!io) {
    return;
  }

  const userIds = [...new Set((Array.isArray(options.userIds) ? options.userIds : []).filter(Boolean))];
  const refreshAll = userIds.length === 0;
  const payload = {
    count: 1,
    groupIds: [],
    data: [],
    refresh: true,
    reason: options.reason || 'news',
    timestamp: new Date().toISOString()
  };
  let recipients = 0;

  activeConnections.forEach((socket) => {
    if (!refreshAll && !userIds.includes(socket.data?.userId)) {
      return;
    }

    if (emitToSocket(socket, 'news:update', payload)) {
      recipients += 1;
    }
  });

  statistics.newsUpdatesSent += 1;
  logger.info(`Broadcast feed refresh to ${recipients} clients: reason=${payload.reason}`);
}

function broadcastSystemNotification(message, type = 'info') {
  if (!io || !message) {
    return;
  }

  const payload = {
    notificationType: type,
    message,
    timestamp: new Date().toISOString()
  };

  activeConnections.forEach((socket) => {
    emitToSocket(socket, 'system:notification', payload);
  });
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
  broadcastNewsUpdate,
  broadcastFeedRefresh,
  broadcastSystemNotification,
  getStatistics
};
