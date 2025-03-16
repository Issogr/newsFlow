import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * Hook personalizzato per gestire operazioni asincrone con stati di caricamento ed errore
 * Versione migliorata con gestione delle race condition e cleanup
 * 
 * @param {Function} asyncFn - Funzione asincrona da eseguire
 * @param {boolean} immediate - Se eseguire la funzione immediatamente
 * @param {Object} options - Opzioni di configurazione
 * @param {Function} options.onSuccess - Callback di successo
 * @param {Function} options.onError - Callback di errore
 * @param {boolean} options.resetOnChange - Se resettare stato quando asyncFn cambia
 * @returns {Object} - Stati e funzioni per gestire l'operazione asincrona
 */
const useAsync = (asyncFn, immediate = true, options = {}) => {
  const { onSuccess, onError, resetOnChange = true } = options;
  
  // Stati per tracciare l'operazione asincrona
  const [status, setStatus] = useState('idle');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);
  
  // Ref per tracciare se il componente è montato
  const isMounted = useRef(true);
  
  // Ref per la richiesta corrente (per gestire race condition)
  const currentRequest = useRef(null);
  
  // Cleanup quando il componente si smonta
  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);
  
  // Reset dello stato
  const reset = useCallback(() => {
    if (isMounted.current) {
      setStatus('idle');
      setData(null);
      setError(null);
    }
  }, []);
  
  // Funzione per riprovare l'esecuzione
  const retry = useCallback(() => {
    setRetryCount(count => count + 1);
  }, []);
  
  // Funzione principale per eseguire l'operazione asincrona
  const execute = useCallback(async (...args) => {
    if (!isMounted.current) return;
    
    // Crea un ID univoco per questa richiesta
    const requestId = Date.now();
    currentRequest.current = requestId;
    
    setStatus('pending');
    setData(null);
    setError(null);
    
    try {
      const result = await asyncFn(...args);
      
      // Verifica se questa è ancora la richiesta più recente e il componente è montato
      if (currentRequest.current === requestId && isMounted.current) {
        setData(result);
        setStatus('success');
        
        if (onSuccess && typeof onSuccess === 'function') {
          onSuccess(result);
        }
      }
      
      return result;
    } catch (err) {
      // Verifica se questa è ancora la richiesta più recente e il componente è montato
      if (currentRequest.current === requestId && isMounted.current) {
        setError(err);
        setStatus('error');
        
        if (onError && typeof onError === 'function') {
          onError(err);
        }
      }
      
      throw err;
    }
  }, [asyncFn, onSuccess, onError]);
  
  // Effetto per l'esecuzione immediata o quando cambia la funzione asincrona o il contatore di retry
  useEffect(() => {
    if (immediate) {
      execute();
    }
  }, [execute, immediate, retryCount]);
  
  // Effetto per resettare lo stato quando cambia la funzione asincrona
  useEffect(() => {
    if (resetOnChange) {
      reset();
    }
  }, [asyncFn, reset, resetOnChange]);
  
  return {
    execute,
    status,
    data,
    error,
    reset,
    retry,
    isPending: status === 'pending',
    isSuccess: status === 'success',
    isError: status === 'error',
    isIdle: status === 'idle'
  };
};

export default useAsync;