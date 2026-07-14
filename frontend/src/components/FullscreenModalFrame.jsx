import { X } from 'lucide-react';
import ModalDialog from './ModalDialog';

const DEFAULT_OVERLAY_CLASS_NAME = 'fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-sm';
const DEFAULT_HEADER_CLASS_NAME = 'flex shrink-0 items-center border-b border-slate-200 bg-white pb-3 pl-[calc(1rem+env(safe-area-inset-left))] pr-[calc(1rem+env(safe-area-inset-right))] pt-[calc(0.75rem+env(safe-area-inset-top))] sm:pb-4 sm:pl-[calc(1.25rem+env(safe-area-inset-left))] sm:pr-[calc(1.25rem+env(safe-area-inset-right))] sm:pt-[calc(1rem+env(safe-area-inset-top))] md:pl-[calc(1.5rem+env(safe-area-inset-left))] md:pr-[calc(1.5rem+env(safe-area-inset-right))]';
const DEFAULT_CLOSE_BUTTON_CLASS_NAME = 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[1rem] border border-slate-200 bg-slate-50 text-slate-700 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300';

const FullscreenModalFrame = ({ ariaLabelledBy, children, onClose, overlayClassName = DEFAULT_OVERLAY_CLASS_NAME, restoreFocusRef }) => (
    <ModalDialog
      ariaLabelledBy={ariaLabelledBy}
      className={overlayClassName}
      dismissOnBackdrop
      onRequestClose={onClose}
      restoreFocusRef={restoreFocusRef}
    >
      {children}
    </ModalDialog>
);

export const FullscreenPanelFrame = ({
  children,
  closeLabel,
  containerClassName,
  headerActions,
  headerStart,
  labelledBy,
  onClose,
  overlayClassName,
  panelClassName,
  restoreFocusRef,
}) => (
  <FullscreenModalFrame ariaLabelledBy={labelledBy} onClose={onClose} overlayClassName={overlayClassName} restoreFocusRef={restoreFocusRef}>
    <div className={containerClassName}>
      <section className={panelClassName} data-modal-content>
        <div className={DEFAULT_HEADER_CLASS_NAME}>
          {headerStart}
          <div className="ml-auto flex items-center gap-1.5">
            {headerActions}
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
