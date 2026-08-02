import { useEffect, useRef, type RefObject } from 'react';

/**
 * Custom hook that detects clicks outside an element
 * @param {React.RefObject} ref - Reference to the element to watch
 * @param {Function} handler - Function to call when clicking outside
 */
export function useOnClickOutside<T extends HTMLElement>(ref: RefObject<T | null>, handler: (event: MouseEvent | TouchEvent) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const listener = (event: MouseEvent | TouchEvent) => {
      // Do nothing when the click is inside the element
      if (!ref.current || ref.current.contains(event.target as Node)) {
        return;
      }
      
      handlerRef.current(event);
    };
    
    document.addEventListener('mousedown', listener);
    document.addEventListener('touchstart', listener);
    
    return () => {
      document.removeEventListener('mousedown', listener);
      document.removeEventListener('touchstart', listener);
    };
  }, [ref]);
}
