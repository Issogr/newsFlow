const logger = require('../utils/logger');
const { getAllowedOrigins, isOriginAllowed } = require('../utils/networkConfig');
const database = require('./database');
const { extractBearerToken, hashSessionToken, purgeExpiredSessionsIfNeeded } = require('../utils/auth');

let io;
let websocketStartTime = Date.now();

const activeConnections = new Map();
const statistics = {
  totalConnections: 0,
  activeConnectionsCount: 0,
  newsUpdatesSent: 0,
  failedBroadcasts: 0
};

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
    transports: ['websocket', 'polling']
  });

  io.use((socket, next) => {
    try {
      purgeExpiredSessionsIfNeeded();

      const auth = socket.handshake?.auth || {};
      const headers = socket.handshake?.headers || {};
      const tokenFromAuth = typeof auth.token === 'string' ? auth.token.trim() : '';
      const tokenFromBearer = extractBearerToken(headers.authorization);
      const tokenFromHeader = typeof headers['x-session-token'] === 'string' ? headers['x-session-token'].trim() : '';
      const sessionToken = tokenFromAuth || tokenFromBearer || tokenFromHeader;

      if (!sessionToken) {
        next(new Error('Authentication required'));
        return;
      }

      const session = database.findSessionByTokenHash(hashSessionToken(sessionToken));
      if (!session || new Date(session.expiresAt) < new Date()) {
        next(new Error('Invalid session'));
        return;
      }

      socket.data.userId = session.userId;
      socket.data.username = session.username;
      next();
    } catch (error) {
      next(new Error(`WebSocket auth failed: ${error.message}`));
    }
  });

  io.on('connection', (socket) => {
    statistics.totalConnections += 1;
    statistics.activeConnectionsCount += 1;
    activeConnections.set(socket.id, socket);
    socket.data.filters = { topics: [], sourceIds: [] };
    socket.data.filterSets = { topics: new Set(), sourceIds: new Set() };

    socket.on('subscribe:filters', (filters = {}) => {
      socket.data.filters = {
        topics: Array.isArray(filters.topics) ? filters.topics.filter(Boolean) : [],
        sourceIds: Array.isArray(filters.sourceIds) ? filters.sourceIds.filter(Boolean) : []
      };
      socket.data.filterSets = {
        topics: new Set(socket.data.filters.topics),
        sourceIds: new Set(socket.data.filters.sourceIds)
      };
    });

    socket.on('disconnect', () => {
      activeConnections.delete(socket.id);
      statistics.activeConnectionsCount = Math.max(0, statistics.activeConnectionsCount - 1);
    });
  });

  websocketStartTime = Date.now();
  logger.info('WebSocket service initialized');

  return io;
}

function groupMatchesFilters(group, filters = {}) {
  const topicFilters = filters.topics instanceof Set
    ? filters.topics
    : new Set(Array.isArray(filters.topics) ? filters.topics : []);
  const sourceFilters = filters.sourceIds instanceof Set
    ? filters.sourceIds
    : new Set(Array.isArray(filters.sourceIds) ? filters.sourceIds : []);

  if (topicFilters.size === 0 && sourceFilters.size === 0) {
    return true;
  }

  const groupTopics = group.topicSet || new Set(Array.isArray(group.topics) ? group.topics : []);
  const groupSourceIds = group.sourceIdSet || new Set(
    Array.isArray(group.items) ? group.items.map((item) => item.sourceId).filter(Boolean) : []
  );

  const hasTopicMatch = topicFilters.size === 0 || [...topicFilters].some((topic) => groupTopics.has(topic));

  const hasSourceMatch = sourceFilters.size === 0 || [...sourceFilters].some((sourceId) => groupSourceIds.has(sourceId));

  return hasTopicMatch && hasSourceMatch;
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

function broadcastNewsUpdate(newsGroups = []) {
  if (!io || !Array.isArray(newsGroups) || newsGroups.length === 0) {
    return;
  }

  let recipients = 0;
  const preparedGroups = newsGroups.map((group) => ({
    ...group,
    topicSet: new Set(Array.isArray(group.topics) ? group.topics : []),
    sourceIdSet: new Set(Array.isArray(group.items) ? group.items.map((item) => item.sourceId).filter(Boolean) : [])
  }));
  const globalGroups = preparedGroups.filter((group) => !group.ownerUserId);
  const privateGroupsByUserId = new Map();

  preparedGroups.forEach((group) => {
    if (!group.ownerUserId) {
      return;
    }

    const userGroups = privateGroupsByUserId.get(group.ownerUserId) || [];
    userGroups.push(group);
    privateGroupsByUserId.set(group.ownerUserId, userGroups);
  });

  activeConnections.forEach((socket) => {
    const candidateGroups = [
      ...globalGroups,
      ...(privateGroupsByUserId.get(socket.data?.userId) || [])
    ];
    const matchingGroups = candidateGroups.filter((group) => {
      return groupMatchesFilters(group, socket.data.filterSets || socket.data.filters);
    });

    if (matchingGroups.length === 0) {
      return;
    }

    const payload = {
      count: matchingGroups.length,
      data: matchingGroups.slice(0, 10),
      timestamp: new Date().toISOString()
    };

    if (emitToSocket(socket, 'news:update', payload)) {
      recipients += 1;
    }
  });

  statistics.newsUpdatesSent += 1;
  logger.info(`Broadcast news update to ${recipients} clients`);
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
  broadcastNewsUpdate,
  broadcastSystemNotification,
  getStatistics
};
