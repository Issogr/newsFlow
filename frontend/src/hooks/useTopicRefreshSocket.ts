import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';

export interface NewsUpdatePayload {
  refresh?: boolean;
  reason?: string;
  count?: number;
  groupIds?: string[];
  [key: string]: unknown;
}

export interface TopicRefreshSocketOptions {
  onTopicRefresh?: (payload: NewsUpdatePayload) => void | Promise<void>;
  onSummariesRefresh?: (payload?: NewsUpdatePayload) => void | Promise<void>;
  onNewsUpdate?: (payload: NewsUpdatePayload) => void | Promise<void>;
  subscription?: Record<string, unknown>;
  enabled?: boolean;
}

const useTopicRefreshSocket = ({
  onTopicRefresh,
  onSummariesRefresh,
  onNewsUpdate,
  subscription = {},
  enabled = true
}: TopicRefreshSocketOptions) => {
  const topicRefreshCallbackRef = useRef(onTopicRefresh);
  const summariesRefreshCallbackRef = useRef(onSummariesRefresh);
  const newsUpdateCallbackRef = useRef(onNewsUpdate);
  const subscriptionRef = useRef(subscription);
  const socketRef = useRef<Socket | null>(null);

  topicRefreshCallbackRef.current = onTopicRefresh;
  summariesRefreshCallbackRef.current = onSummariesRefresh;
  newsUpdateCallbackRef.current = onNewsUpdate;
  subscriptionRef.current = subscription;

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const socket = io(window.location.origin, {
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      transports: ['websocket', 'polling'],
      path: '/socket.io',
      withCredentials: true,
    });

    socketRef.current = socket;

    const handleNewsUpdate = (payload: NewsUpdatePayload) => {
      if (payload?.refresh === true) {
        if (payload.reason === 'summaries') {
          summariesRefreshCallbackRef.current?.(payload);
          return;
        }

        topicRefreshCallbackRef.current?.(payload);
        return;
      }

      if (payload.count && payload.count > 0) {
        newsUpdateCallbackRef.current?.(payload);
      }
    };
    let hasConnected = false;
    const handleConnect = () => {
      socket.emit('subscribe:filters', subscriptionRef.current || {});
      if (hasConnected) {
        summariesRefreshCallbackRef.current?.();
      }
      hasConnected = true;
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
