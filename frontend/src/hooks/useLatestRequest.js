import { useCallback, useEffect, useRef } from 'react';

const useLatestRequest = () => {
  const requestRef = useRef({ id: 0, controller: null });

  const cancelLatestRequest = useCallback(() => {
    requestRef.current.controller?.abort();
  }, []);

  const resetLatestRequest = useCallback(() => {
    const nextRequestId = requestRef.current.id + 1;
    cancelLatestRequest();
    requestRef.current = { id: nextRequestId, controller: null };
  }, [cancelLatestRequest]);

  const startLatestRequest = useCallback(() => {
    const controller = new AbortController();
    const requestId = requestRef.current.id + 1;

    cancelLatestRequest();
    requestRef.current = { id: requestId, controller };

    return {
      id: requestId,
      signal: controller.signal,
      isLatest: () => requestRef.current.id === requestId
    };
  }, [cancelLatestRequest]);

  useEffect(() => cancelLatestRequest, [cancelLatestRequest]);

  return {
    startLatestRequest,
    cancelLatestRequest,
    resetLatestRequest
  };
};

export default useLatestRequest;
