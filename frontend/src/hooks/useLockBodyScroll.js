import { useEffect } from 'react';

let lockCount = 0;
let previousBodyStyles = null;
let lockedScrollY = 0;

export default function useLockBodyScroll() {
  useEffect(() => {
    if (lockCount === 0) {
      const body = document.body;
      lockedScrollY = window.scrollY || window.pageYOffset || 0;
      previousBodyStyles = {
        overflow: body.style.overflow,
        position: body.style.position,
        top: body.style.top,
        left: body.style.left,
        right: body.style.right,
        width: body.style.width
      };

      body.style.overflow = 'hidden';
      body.style.position = 'fixed';
      body.style.top = `-${lockedScrollY}px`;
      body.style.left = '0';
      body.style.right = '0';
      body.style.width = '100%';
    }

    lockCount += 1;

    return () => {
      lockCount = Math.max(0, lockCount - 1);

      if (lockCount !== 0 || !previousBodyStyles) {
        return;
      }

      const restoreScrollY = lockedScrollY;
      const body = document.body;
      body.style.overflow = previousBodyStyles.overflow;
      body.style.position = previousBodyStyles.position;
      body.style.top = previousBodyStyles.top;
      body.style.left = previousBodyStyles.left;
      body.style.right = previousBodyStyles.right;
      body.style.width = previousBodyStyles.width;
      previousBodyStyles = null;
      lockedScrollY = 0;

      if (restoreScrollY > 0 && typeof window.scrollTo === 'function') {
        try {
          window.scrollTo(0, restoreScrollY);
        } catch {
          // Some test environments expose scrollTo but do not implement it.
        }
      }
    };
  }, []);
}
