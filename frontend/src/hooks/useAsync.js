import { useState, useCallback, useEffect } from 'react';

/**
 * Hook personalizzato per gestire operazioni asincrone con stati di caricamento ed errore
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
  
  // Reset dello stato
  const reset = useCallback(() => {
    setStatus('idle');
    setData(null);
    setError(null);
  }, []);
  
  // Funzione per riprovare l'esecuzione
  const retry = useCallback(() => {
    setRetryCount(count => count + 1);
  }, []);
  
  // Funzione principale per eseguire l'operazione asincrona
  const execute = useCallback(async (...args) => {
    setStatus('pending');
    setData(null);
    setError(null);
    
    try {
      const result = await asyncFn(...args);
      setData(result);
      setStatus('success');
      
      if (onSuccess) {
        onSuccess(result);
      }
      
      return result;
    } catch (err) {
      setError(err);
      setStatus('error');
      
      if (onError) {
        onError(err);
      }
      
      throw err;
    }
  }, [asyncFn, onSuccess, onError]);
  
  // Effetto per l'esecuzione immediata o quando cambia la funzione asincrona
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