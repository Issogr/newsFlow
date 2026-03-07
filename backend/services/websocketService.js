const logger = require('../utils/logger');
const { getAllowedOrigins, isOriginAllowed } = require('../utils/networkConfig');
const database = require('./database');
const { extractBearerToken, hashSessionToken } = require('../utils/auth');

let io;
let websocketStartTime = Date.now();

const activeConnections = new Map();
const statistics = {
  totalConnections: 0,
  activeConnectionsCount: 0,
  topicUpdatesSent: 0,
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
      database.purgeExpiredSessions();

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

    socket.emit('welcome', {
      message: 'Connesso agli aggiornamenti in tempo reale',
      timestamp: new Date().toISOString(),
      userId: socket.data.userId
    });

    socket.on('subscribe:filters', (filters = {}) => {
      socket.data.filters = {
        topics: Array.isArray(filters.topics) ? filters.topics.filter(Boolean) : [],
        sourceIds: Array.isArray(filters.sourceIds) ? filters.sourceIds.filter(Boolean) : []
      };
    });

    socket.on('ping', () => {
      socket.emit('pong', { timestamp: Date.now() });
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
  const topicFilters = Array.isArray(filters.topics) ? filters.topics : [];
  const sourceFilters = Array.isArray(filters.sourceIds) ? filters.sourceIds : [];

  if (topicFilters.length === 0 && sourceFilters.length === 0) {
    return true;
  }

  const hasTopicMatch = topicFilters.length === 0 || topicFilters.some((topic) => {
    return Array.isArray(group.topics) && group.topics.includes(topic);
  });

  const hasSourceMatch = sourceFilters.length === 0 || sourceFilters.some((sourceId) => {
    return Array.isArray(group.items) && group.items.some((item) => item.sourceId === sourceId);
  });

  return hasTopicMatch && hasSourceMatch;
}

function socketCanReceiveGroup(socket, group) {
  const socketUserId = socket.data?.userId || null;
  const groupOwnerUserId = group?.ownerUserId || null;

  if (!groupOwnerUserId) {
    return true;
  }

  return socketUserId === groupOwnerUserId;
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

  activeConnections.forEach((socket) => {
    const matchingGroups = newsGroups.filter((group) => {
      return socketCanReceiveGroup(socket, group) && groupMatchesFilters(group, socket.data.filters);
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

function shouldReceiveTopicUpdate(filters, topics = [], sourceId) {
  const topicFilters = Array.isArray(filters?.topics) ? filters.topics : [];
  const sourceFilters = Array.isArray(filters?.sourceIds) ? filters.sourceIds : [];

  if (topicFilters.length === 0 && sourceFilters.length === 0) {
    return true;
  }

  const topicMatch = topicFilters.length === 0 || topics.some((topic) => topicFilters.includes(topic));
  const sourceMatch = sourceFilters.length === 0 || (sourceId && sourceFilters.includes(sourceId));

  return topicMatch && sourceMatch;
}

function socketCanReceiveTopicUpdate(socket, context = {}) {
  const socketUserId = socket.data?.userId || null;
  const ownerUserId = context.ownerUserId || null;

  if (!ownerUserId) {
    return true;
  }

  return socketUserId === ownerUserId;
}

function broadcastTopicUpdate(articleId, topics = [], context = {}) {
  if (!io || !articleId || !Array.isArray(topics) || topics.length === 0) {
    return;
  }

  const payload = {
    articleId,
    topics,
    timestamp: new Date().toISOString()
  };

  let recipients = 0;

  activeConnections.forEach((socket) => {
    if (!socketCanReceiveTopicUpdate(socket, context)) {
      return;
    }

    if (!shouldReceiveTopicUpdate(socket.data.filters, topics, context.sourceId)) {
      return;
    }

    if (emitToSocket(socket, 'topic:update', payload)) {
      recipients += 1;
    }
  });

  statistics.topicUpdatesSent += 1;
  logger.info(`Broadcast topic update to ${recipients} clients for article ${articleId}`);
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
  broadcastTopicUpdate,
  broadcastSystemNotification,
  getStatistics
};
