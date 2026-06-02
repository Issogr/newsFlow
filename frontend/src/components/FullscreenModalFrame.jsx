import React, { useEffect } from 'react';
import useLockBodyScroll from '../hooks/useLockBodyScroll';

const DEFAULT_OVERLAY_CLASS_NAME = 'fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-sm';

const FullscreenModalFrame = ({ children, closeLabel, onClose, overlayClassName = DEFAULT_OVERLAY_CLASS_NAME }) => {
  useLockBodyScroll();

  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  return (
    <div className={overlayClassName}>
      <button
        type="button"
        className="absolute inset-0 hidden cursor-default lg:block"
        aria-label={closeLabel}
        onClick={onClose}
      />
      {children}
    </div>
  );
};

export default FullscreenModalFrame;
