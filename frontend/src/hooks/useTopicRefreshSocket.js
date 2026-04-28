import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

const useTopicRefreshSocket = (onTopicRefresh, enabled = true) => {
  const callbackRef = useRef(onTopicRefresh);

  useEffect(() => {
    callbackRef.current = onTopicRefresh;
  }, [onTopicRefresh]);

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

    const handleNewsUpdate = (payload) => {
      if (payload?.refresh === true && payload.reason === 'topics') {
        callbackRef.current?.(payload);
      }
    };

    socket.on('news:update', handleNewsUpdate);

    return () => {
      socket.off('news:update', handleNewsUpdate);
      socket.disconnect();
    };
  }, [enabled]);
};

export default useTopicRefreshSocket;
