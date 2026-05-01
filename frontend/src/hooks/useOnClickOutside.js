import { useEffect, useRef } from 'react';

/**
 * Custom hook that detects clicks outside an element
 * @param {React.RefObject} ref - Reference to the element to watch
 * @param {Function} handler - Function to call when clicking outside
 */
export function useOnClickOutside(ref, handler) {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    const listener = (event) => {
      // Do nothing when the click is inside the element
      if (!ref.current || ref.current.contains(event.target)) {
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
