import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

const useTopicRefreshSocket = ({
  onTopicRefresh,
  onNewsUpdate,
  subscription = {},
  enabled = true
}) => {
  const topicRefreshCallbackRef = useRef(onTopicRefresh);
  const newsUpdateCallbackRef = useRef(onNewsUpdate);
  const subscriptionRef = useRef(subscription);
  const socketRef = useRef(null);

  useEffect(() => {
    topicRefreshCallbackRef.current = onTopicRefresh;
  }, [onTopicRefresh]);

  useEffect(() => {
    newsUpdateCallbackRef.current = onNewsUpdate;
  }, [onNewsUpdate]);

  useEffect(() => {
    subscriptionRef.current = subscription;
  }, [subscription]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const socket = io(window.location.origin, {
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      transports: ['websocket', 'polling'],
      path: '/socket.io',
      withCredentials: true,
    });

    socketRef.current = socket;

    const handleNewsUpdate = (payload) => {
      if (payload?.refresh === true) {
        topicRefreshCallbackRef.current?.(payload);
        return;
      }

      if (payload?.refresh !== true && payload?.count > 0) {
        newsUpdateCallbackRef.current?.(payload);
      }
    };
    const handleConnect = () => {
      socket.emit('subscribe:filters', subscriptionRef.current || {});
    };

    socket.on('connect', handleConnect);
    socket.on('news:update', handleNewsUpdate);

    return () => {
      socketRef.current = null;
      socket.off('connect', handleConnect);
      socket.off('news:update', handleNewsUpdate);
      socket.disconnect();
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !socketRef.current) {
      return;
    }

    socketRef.current.emit('subscribe:filters', subscriptionRef.current || {});
  }, [enabled, subscription]);
};

export default useTopicRefreshSocket;
