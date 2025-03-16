import { useEffect } from 'react';

/**
 * Hook personalizzato per rilevare i clic fuori da un elemento
 * @param {React.RefObject} ref - Riferimento all'elemento da monitorare
 * @param {Function} handler - Funzione da chiamare quando si clicca fuori
 */
export function useOnClickOutside(ref, handler) {
  useEffect(() => {
    const listener = (event) => {
      // Non fare nulla se il clic è all'interno dell'elemento
      if (!ref.current || ref.current.contains(event.target)) {
        return;
      }
      
      handler(event);
    };
    
    document.addEventListener('mousedown', listener);
    document.addEventListener('touchstart', listener);
    
    return () => {
      document.removeEventListener('mousedown', listener);
      document.removeEventListener('touchstart', listener);
    };
  }, [ref, handler]);
}