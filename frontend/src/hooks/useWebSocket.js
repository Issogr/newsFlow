import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const MAX_NOTIFICATIONS = 10;
const MAX_TRACKED_GROUP_IDS = 1000;
const TRACKED_GROUP_TTL_MS = 6 * 60 * 60 * 1000;

function pruneTrackedGroupIds(trackedGroupIds, now = Date.now()) {
  if (!(trackedGroupIds instanceof Map) || trackedGroupIds.size === 0) {
    return trackedGroupIds;
  }

  trackedGroupIds.forEach((timestamp, groupId) => {
    if (!Number.isFinite(timestamp) || (now - timestamp) > TRACKED_GROUP_TTL_MS) {
      trackedGroupIds.delete(groupId);
    }
  });

  while (trackedGroupIds.size > MAX_TRACKED_GROUP_IDS) {
    const oldestGroupId = trackedGroupIds.keys().next().value;
    if (!oldestGroupId) {
      break;
    }

    trackedGroupIds.delete(oldestGroupId);
  }

  return trackedGroupIds;
}

const useWebSocket = (url = '', messages = {}, enabled = true) => {
  const wsUrl = url || window.location.origin;
  const socketRef = useRef(null);
  const messagesRef = useRef(messages);
  const isConnectedRef = useRef(false);
  const notificationIdRef = useRef(0);
  const announcedGroupIdsRef = useRef(new Map());
  const pendingGroupIdsRef = useRef(new Set());

  const [isConnected, setIsConnected] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [lastNewsUpdate, setLastNewsUpdate] = useState(null);
  const [newArticlesCount, setNewArticlesCount] = useState(0);

  useEffect(() => {
    isConnectedRef.current = isConnected;
  }, [isConnected]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const pushNotification = useCallback((notification) => {
    setNotifications((current) => [notification, ...current].slice(0, MAX_NOTIFICATIONS));
  }, []);

  const createNotificationId = useCallback(() => {
    notificationIdRef.current += 1;
    return notificationIdRef.current;
  }, []);

  useEffect(() => {
    if (!enabled) {
      setIsConnected(false);
      setLastNewsUpdate(null);
      setNewArticlesCount(0);
      announcedGroupIdsRef.current = new Map();
      pendingGroupIdsRef.current = new Set();
      return undefined;
    }

    const socket = io(wsUrl, {
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      transports: ['websocket', 'polling'],
      path: '/socket.io',
      withCredentials: true,
    });

    socketRef.current = socket;

    const onConnect = () => {
      setIsConnected(true);
      pushNotification({
        id: createNotificationId(),
        type: 'info',
        message: messagesRef.current.connected || 'Real-time connection active',
        timestamp: new Date().toISOString()
      });
    };

    const onDisconnect = (reason) => {
      setIsConnected(false);

      if (reason !== 'io client disconnect') {
        pushNotification({
          id: createNotificationId(),
          type: 'warning',
          message: messagesRef.current.disconnected || 'Real-time connection lost, reconnecting...',
          timestamp: new Date().toISOString()
        });
      }
    };

    const onReconnectFailed = () => {
      pushNotification({
        id: createNotificationId(),
        type: 'error',
        message: messagesRef.current.reconnectFailed || 'Unable to restore the real-time connection',
        timestamp: new Date().toISOString()
      });
    };

    const onNewsUpdate = (payload) => {
      if (!payload || typeof payload.count !== 'number') {
        return;
      }

      const incomingGroupIds = Array.isArray(payload.groupIds) && payload.groupIds.length > 0
        ? payload.groupIds.filter(Boolean)
        : (Array.isArray(payload.data) ? payload.data.map((group) => group?.id).filter(Boolean) : []);
      const now = Date.now();

      pruneTrackedGroupIds(announcedGroupIdsRef.current, now);

      const unseenGroupIds = incomingGroupIds.filter((groupId) => {
        return !announcedGroupIdsRef.current.has(groupId) && !pendingGroupIdsRef.current.has(groupId);
      });
      const nextCount = incomingGroupIds.length > 0 ? unseenGroupIds.length : payload.count;

      if (nextCount <= 0) {
        return;
      }

      unseenGroupIds.forEach((groupId) => {
        announcedGroupIdsRef.current.delete(groupId);
        announcedGroupIdsRef.current.set(groupId, now);
      });
      pruneTrackedGroupIds(announcedGroupIdsRef.current, now);

      if (incomingGroupIds.length > 0) {
        unseenGroupIds.forEach((groupId) => {
          pendingGroupIdsRef.current.add(groupId);
        });
      }

      setLastNewsUpdate({
        ...payload,
        count: nextCount
      });
      if (incomingGroupIds.length > 0) {
        setNewArticlesCount(pendingGroupIdsRef.current.size);
      } else {
        setNewArticlesCount((current) => current + nextCount);
      }
      pushNotification({
        id: createNotificationId(),
        type: 'info',
        message: typeof messagesRef.current.newGroups === 'function'
          ? messagesRef.current.newGroups(nextCount)
          : `${nextCount} new news groups available`,
        timestamp: payload.timestamp || new Date().toISOString()
      });
    };

    const onSystemNotification = (payload) => {
      if (!payload?.message) {
        return;
      }

      pushNotification({
        id: createNotificationId(),
        type: payload.notificationType || 'info',
        message: payload.message,
        timestamp: payload.timestamp || new Date().toISOString()
      });
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('news:update', onNewsUpdate);
    socket.on('system:notification', onSystemNotification);
    socket.io.on('reconnect_failed', onReconnectFailed);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('news:update', onNewsUpdate);
      socket.off('system:notification', onSystemNotification);
      socket.io.off('reconnect_failed', onReconnectFailed);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [createNotificationId, enabled, pushNotification, wsUrl]);

  const updateSubscriptionFilters = useCallback((filters) => {
    if (!socketRef.current || !isConnectedRef.current) {
      return;
    }

    socketRef.current.emit('subscribe:filters', filters);
  }, []);

  const resetNewArticlesCount = useCallback(() => {
    pendingGroupIdsRef.current = new Set();
    setNewArticlesCount(0);
  }, []);

  const markGroupsSeen = useCallback((groupIds = []) => {
    if (!Array.isArray(groupIds) || groupIds.length === 0 || pendingGroupIdsRef.current.size === 0) {
      return;
    }

    let removedAny = false;

    groupIds.filter(Boolean).forEach((groupId) => {
      if (pendingGroupIdsRef.current.delete(groupId)) {
        removedAny = true;
      }
    });

    if (removedAny) {
      setNewArticlesCount(pendingGroupIdsRef.current.size);
    }
  }, []);

  const removeNotification = useCallback((id) => {
    setNotifications((current) => current.filter((notification) => notification.id !== id));
  }, []);

  return {
    isConnected,
    notifications,
    lastNewsUpdate,
    newArticlesCount,
    updateSubscriptionFilters,
    resetNewArticlesCount,
    markGroupsSeen,
    removeNotification
  };
};

export default useWebSocket;
