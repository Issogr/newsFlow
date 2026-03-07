import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const MAX_NOTIFICATIONS = 10;
const PING_INTERVAL_MS = 30000;
const PONG_TIMEOUT_MS = 5000;

const useWebSocket = (url = '', messages = {}) => {
  const wsUrl = url || window.location.origin;
  const socketRef = useRef(null);
  const messagesRef = useRef(messages);
  const pingIntervalRef = useRef(null);
  const pongTimeoutRef = useRef(null);
  const isConnectedRef = useRef(false);
  const pingPendingRef = useRef(false);

  const [isConnected, setIsConnected] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [lastNewsUpdate, setLastNewsUpdate] = useState(null);
  const [lastTopicUpdate, setLastTopicUpdate] = useState(null);
  const [newArticlesCount, setNewArticlesCount] = useState(0);
  const [reconnectionEvent, setReconnectionEvent] = useState(0);

  useEffect(() => {
    isConnectedRef.current = isConnected;
  }, [isConnected]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const pushNotification = useCallback((notification) => {
    setNotifications((current) => [notification, ...current].slice(0, MAX_NOTIFICATIONS));
  }, []);

  const clearPongTimeout = useCallback(() => {
    if (pongTimeoutRef.current) {
      clearTimeout(pongTimeoutRef.current);
      pongTimeoutRef.current = null;
    }
  }, []);

  const stopPingLoop = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    clearPongTimeout();
    pingPendingRef.current = false;
  }, [clearPongTimeout]);

  const reconnectSocket = useCallback(() => {
    if (!socketRef.current) {
      return;
    }

    socketRef.current.disconnect();
    socketRef.current.connect();
  }, []);

  const sendPing = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || !isConnectedRef.current) {
      return;
    }

    if (pingPendingRef.current) {
      reconnectSocket();
      return;
    }

    pingPendingRef.current = true;
    clearPongTimeout();
    pongTimeoutRef.current = setTimeout(() => {
      if (pingPendingRef.current) {
        pingPendingRef.current = false;
        reconnectSocket();
      }
    }, PONG_TIMEOUT_MS);

    socket.emit('ping');
  }, [clearPongTimeout, reconnectSocket]);

  const startPingLoop = useCallback(() => {
    if (pingIntervalRef.current) {
      return;
    }

    pingIntervalRef.current = setInterval(sendPing, PING_INTERVAL_MS);
  }, [sendPing]);

  useEffect(() => {
    const socket = io(wsUrl, {
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
      startPingLoop();
      pushNotification({
        id: Date.now(),
        type: 'info',
        message: messagesRef.current.connected || 'Real-time connection active',
        timestamp: new Date().toISOString()
      });
    };

    const onDisconnect = (reason) => {
      setIsConnected(false);
      stopPingLoop();

      if (reason !== 'io client disconnect') {
        pushNotification({
          id: Date.now(),
          type: 'warning',
          message: messagesRef.current.disconnected || 'Real-time connection lost, reconnecting...',
          timestamp: new Date().toISOString()
        });
      }
    };

    const onReconnect = () => {
      setReconnectionEvent((value) => value + 1);
      startPingLoop();
    };

    const onReconnectFailed = () => {
      pushNotification({
        id: Date.now(),
        type: 'error',
        message: messagesRef.current.reconnectFailed || 'Unable to restore the real-time connection',
        timestamp: new Date().toISOString()
      });
    };

    const onPong = () => {
      pingPendingRef.current = false;
      clearPongTimeout();
    };

    const onNewsUpdate = (payload) => {
      if (!payload || typeof payload.count !== 'number') {
        return;
      }

      setLastNewsUpdate(payload);
      setNewArticlesCount((current) => current + payload.count);
      pushNotification({
        id: Date.now(),
        type: 'info',
        message: typeof messagesRef.current.newGroups === 'function'
          ? messagesRef.current.newGroups(payload.count)
          : `${payload.count} new news groups available`,
        timestamp: payload.timestamp || new Date().toISOString()
      });
    };

    const onTopicUpdate = (payload) => {
      if (!payload?.articleId) {
        return;
      }

      setLastTopicUpdate(payload);
    };

    const onSystemNotification = (payload) => {
      if (!payload?.message) {
        return;
      }

      pushNotification({
        id: Date.now(),
        type: payload.notificationType || 'info',
        message: payload.message,
        timestamp: payload.timestamp || new Date().toISOString()
      });
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('pong', onPong);
    socket.on('news:update', onNewsUpdate);
    socket.on('topic:update', onTopicUpdate);
    socket.on('system:notification', onSystemNotification);
    socket.io.on('reconnect', onReconnect);
    socket.io.on('reconnect_failed', onReconnectFailed);

    return () => {
      stopPingLoop();
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('pong', onPong);
      socket.off('news:update', onNewsUpdate);
      socket.off('topic:update', onTopicUpdate);
      socket.off('system:notification', onSystemNotification);
      socket.io.off('reconnect', onReconnect);
      socket.io.off('reconnect_failed', onReconnectFailed);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [clearPongTimeout, pushNotification, startPingLoop, stopPingLoop, wsUrl]);

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
    lastTopicUpdate,
    newArticlesCount,
    reconnectionEvent,
    updateSubscriptionFilters,
    resetNewArticlesCount,
    removeNotification
  };
};

export default useWebSocket;
