import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { getAuthToken } from '../services/api';

const MAX_NOTIFICATIONS = 10;

const useWebSocket = (url = '', messages = {}) => {
  const wsUrl = url || window.location.origin;
  const socketRef = useRef(null);
  const messagesRef = useRef(messages);
  const isConnectedRef = useRef(false);
  const notificationIdRef = useRef(0);

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
    const socket = io(wsUrl, {
      auth: {
        token: getAuthToken()
      },
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      transports: ['websocket', 'polling'],
      path: '/socket.io'
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

      setLastNewsUpdate(payload);
      setNewArticlesCount((current) => current + payload.count);
      pushNotification({
        id: createNotificationId(),
        type: 'info',
        message: typeof messagesRef.current.newGroups === 'function'
          ? messagesRef.current.newGroups(payload.count)
          : `${payload.count} new news groups available`,
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
  }, [createNotificationId, pushNotification, wsUrl]);

  const updateSubscriptionFilters = useCallback((filters) => {
    if (!socketRef.current || !isConnectedRef.current) {
      return;
    }

    socketRef.current.emit('subscribe:filters', filters);
  }, []);

  const resetNewArticlesCount = useCallback(() => {
    setNewArticlesCount(0);
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
    removeNotification
  };
};

export default useWebSocket;
