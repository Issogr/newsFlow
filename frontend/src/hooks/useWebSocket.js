import { useState, useEffect, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';

const MAX_NOTIFICATIONS = 10;
const PING_INTERVAL_MS = 30000;
const PONG_TIMEOUT_MS = 5000;

/**
 * Hook per gestire la connessione WebSocket e gli eventi correlati.
 * Gestisce ping/pong con cleanup esplicito per evitare leak di timer.
 */
const useWebSocket = (url = '') => {
  const wsUrl = url || window.location.origin;

  const [isConnected, setIsConnected] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [lastPing, setLastPing] = useState(null);
  const [reconnectionEvent, setReconnectionEvent] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [lastNewsUpdate, setLastNewsUpdate] = useState(null);
  const [lastTopicUpdate, setLastTopicUpdate] = useState(null);
  const [newArticlesCount, setNewArticlesCount] = useState(0);
  const [updatesReceived, setUpdatesReceived] = useState(0);

  const socketRef = useRef(null);
  const isConnectedRef = useRef(false);
  const pingPendingRef = useRef(false);
  const pingIntervalRef = useRef(null);
  const pongTimeoutRef = useRef(null);

  useEffect(() => {
    isConnectedRef.current = isConnected;
  }, [isConnected]);

  const pushNotification = useCallback((notification) => {
    setNotifications((prev) => [notification, ...prev].slice(0, MAX_NOTIFICATIONS));
  }, []);

  const reconnectSocket = useCallback(() => {
    if (!socketRef.current) return;
    socketRef.current.disconnect();
    socketRef.current.connect();
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

  const sendPing = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || !isConnectedRef.current) return;

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
    if (pingIntervalRef.current) return;

    pingIntervalRef.current = setInterval(() => {
      sendPing();
    }, PING_INTERVAL_MS);
  }, [sendPing]);

  useEffect(() => {
    const options = {
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      transports: ['websocket', 'polling'],
      autoConnect: true,
      path: '/socket.io'
    };

    const socket = io(wsUrl, options);
    socketRef.current = socket;

    const onConnect = () => {
      setIsConnected(true);
      setReconnectAttempts(0);
      startPingLoop();

      pushNotification({
        id: Date.now(),
        type: 'info',
        message: 'Connessione agli aggiornamenti in tempo reale stabilita',
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
          message: 'Connessione agli aggiornamenti in tempo reale persa, riconnessione in corso...',
          timestamp: new Date().toISOString()
        });
      }
    };

    const onReconnectAttempt = (attempt) => {
      setReconnectAttempts(attempt);
    };

    const onReconnect = () => {
      setReconnectionEvent((prev) => prev + 1);
      startPingLoop();
    };

    const onReconnectFailed = () => {
      pushNotification({
        id: Date.now(),
        type: 'error',
        message: 'Impossibile connettersi al server per gli aggiornamenti in tempo reale',
        timestamp: new Date().toISOString()
      });
    };

    const onPong = (data) => {
      pingPendingRef.current = false;
      clearPongTimeout();
      setLastPing(data?.timestamp || Date.now());
    };

    const onNewsUpdate = (data) => {
      if (!data || typeof data.count !== 'number') return;

      setLastNewsUpdate(data);
      setNewArticlesCount((prev) => prev + data.count);
      setUpdatesReceived((prev) => prev + 1);

      pushNotification({
        id: Date.now(),
        type: 'info',
        message: `Ricevuti ${data.count} nuovi articoli`,
        timestamp: data.timestamp || new Date().toISOString()
      });
    };

    const onTopicUpdate = (data) => {
      if (!data) return;

      setLastTopicUpdate(data);
      setUpdatesReceived((prev) => prev + 1);

      if (data.articleId && Array.isArray(data.topics) && data.topics.length > 0) {
        pushNotification({
          id: Date.now(),
          type: 'info',
          message: `Topic aggiornati: ${data.topics.join(', ')}`,
          timestamp: data.timestamp || new Date().toISOString()
        });
      }
    };

    const onSystemNotification = (data) => {
      if (!data || !data.message) return;

      pushNotification({
        id: Date.now(),
        type: data.notificationType || 'info',
        message: data.message,
        timestamp: data.timestamp || new Date().toISOString()
      });
    };

    const onWelcome = () => {
      startPingLoop();
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.io.on('reconnect_attempt', onReconnectAttempt);
    socket.io.on('reconnect', onReconnect);
    socket.io.on('reconnect_failed', onReconnectFailed);
    socket.on('welcome', onWelcome);
    socket.on('pong', onPong);
    socket.on('news:update', onNewsUpdate);
    socket.on('topic:update', onTopicUpdate);
    socket.on('system:notification', onSystemNotification);

    return () => {
      stopPingLoop();
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.io.off('reconnect_attempt', onReconnectAttempt);
      socket.io.off('reconnect', onReconnect);
      socket.io.off('reconnect_failed', onReconnectFailed);
      socket.off('welcome', onWelcome);
      socket.off('pong', onPong);
      socket.off('news:update', onNewsUpdate);
      socket.off('topic:update', onTopicUpdate);
      socket.off('system:notification', onSystemNotification);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [clearPongTimeout, pushNotification, startPingLoop, stopPingLoop, wsUrl]);

  const updateSubscriptionFilters = useCallback((filters) => {
    if (!socketRef.current || !isConnectedRef.current) return;
    socketRef.current.emit('subscribe:filters', filters);
  }, []);

  const sendMessage = useCallback((event, data) => {
    if (!socketRef.current || !isConnectedRef.current) return false;
    socketRef.current.emit(event, data);
    return true;
  }, []);

  const resetNewArticlesCount = useCallback(() => {
    setNewArticlesCount(0);
  }, []);

  const removeNotification = useCallback((id) => {
    setNotifications((prev) => prev.filter((notification) => notification.id !== id));
  }, []);

  const reconnect = useCallback(() => {
    if (!socketRef.current || isConnectedRef.current) return;
    socketRef.current.connect();
  }, []);

  return {
    isConnected,
    reconnectAttempts,
    lastPing,
    notifications,
    lastNewsUpdate,
    lastTopicUpdate,
    newArticlesCount,
    updatesReceived,
    reconnectionEvent,
    updateSubscriptionFilters,
    sendMessage,
    reconnect,
    resetNewArticlesCount,
    removeNotification
  };
};

export default useWebSocket;
