import { useCallback, useEffect, useRef } from 'react';

function createInitialRequestState() {
  return {
    id: 0,
    controller: null
  };
}

const useLatestRequest = () => {
  const requestRef = useRef(createInitialRequestState());

  const cancelLatestRequest = useCallback(() => {
    requestRef.current.controller?.abort();
  }, []);

  const resetLatestRequest = useCallback(() => {
    cancelLatestRequest();
    requestRef.current = createInitialRequestState();
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

  useEffect(() => {
    return () => {
      cancelLatestRequest();
    };
  }, [cancelLatestRequest]);

  return {
    startLatestRequest,
    cancelLatestRequest,
    resetLatestRequest
  };
};

export default useLatestRequest;
