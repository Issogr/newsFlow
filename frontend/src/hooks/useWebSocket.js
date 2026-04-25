import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

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

const useWebSocket = (url = '', _messages = {}, enabled = true) => {
  const wsUrl = url || window.location.origin;
  const socketRef = useRef(null);
  const isConnectedRef = useRef(false);
  const announcedGroupIdsRef = useRef(new Map());
  const pendingGroupIdsRef = useRef(new Set());

  const [isConnected, setIsConnected] = useState(false);
  const [lastNewsUpdate, setLastNewsUpdate] = useState(null);

  useEffect(() => {
    isConnectedRef.current = isConnected;
  }, [isConnected]);

  useEffect(() => {
    if (!enabled) {
      setIsConnected(false);
      setLastNewsUpdate(null);
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
    };

    const onDisconnect = () => {
      setIsConnected(false);
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
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('news:update', onNewsUpdate);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('news:update', onNewsUpdate);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [enabled, wsUrl]);

  const updateSubscriptionFilters = useCallback((filters) => {
    if (!socketRef.current || !isConnectedRef.current) {
      return;
    }

    socketRef.current.emit('subscribe:filters', filters);
  }, []);

  const resetNewArticlesCount = useCallback(() => {
    pendingGroupIdsRef.current = new Set();
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

    return removedAny;
  }, []);

  return {
    isConnected,
    lastNewsUpdate,
    updateSubscriptionFilters,
    resetNewArticlesCount,
    markGroupsSeen
  };
};

export default useWebSocket;
