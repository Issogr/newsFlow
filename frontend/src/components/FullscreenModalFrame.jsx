import { useEffect } from 'react';
import { X } from 'lucide-react';
import useLockBodyScroll from '../hooks/useLockBodyScroll';

const DEFAULT_OVERLAY_CLASS_NAME = 'fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-sm';
const DEFAULT_HEADER_CLASS_NAME = 'flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-3 sm:px-5 sm:py-4 md:px-6';
const DEFAULT_CLOSE_BUTTON_CLASS_NAME = 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[1rem] border border-slate-200 bg-slate-50 text-slate-700 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300';

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

export const FullscreenPanelFrame = ({
  children,
  closeLabel,
  containerClassName,
  headerStart,
  onClose,
  overlayClassName,
  panelClassName
}) => (
  <FullscreenModalFrame closeLabel={closeLabel} onClose={onClose} overlayClassName={overlayClassName}>
    <div className={containerClassName}>
      <section className={panelClassName}>
        <div className={DEFAULT_HEADER_CLASS_NAME}>
          {headerStart}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className={DEFAULT_CLOSE_BUTTON_CLASS_NAME}
              aria-label={closeLabel}
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>
        {children}
      </section>
    </div>
  </FullscreenModalFrame>
);
