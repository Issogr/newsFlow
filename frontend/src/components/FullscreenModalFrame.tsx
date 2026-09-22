import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import ModalDialog from './ModalDialog';

const DEFAULT_OVERLAY_CLASS_NAME = 'fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-sm';
const DEFAULT_HEADER_CLASS_NAME = 'flex shrink-0 items-center border-b border-line bg-surface pb-3 pl-[calc(1rem+env(safe-area-inset-left))] pr-[calc(1rem+env(safe-area-inset-right))] pt-[calc(0.75rem+env(safe-area-inset-top))] sm:pb-4 sm:pl-[calc(1.25rem+env(safe-area-inset-left))] sm:pr-[calc(1.25rem+env(safe-area-inset-right))] sm:pt-[calc(1rem+env(safe-area-inset-top))] md:pl-[calc(1.5rem+env(safe-area-inset-left))] md:pr-[calc(1.5rem+env(safe-area-inset-right))]';

export const FullscreenPanelFrame = ({
  children,
  closeLabel,
  containerClassName,
  headerActions,
  headerStart,
  labelledBy,
  onClose,
  overlayClassName = DEFAULT_OVERLAY_CLASS_NAME,
  panelClassName,
}: {
  children: ReactNode;
  closeLabel: string;
  containerClassName: string;
  headerActions?: ReactNode;
  headerStart?: ReactNode;
  labelledBy: string;
  onClose: () => void;
  overlayClassName?: string;
  panelClassName: string;
}) => (
  <ModalDialog
    ariaLabelledBy={labelledBy}
    className={overlayClassName}
    dismissOnBackdrop
    onRequestClose={onClose}
  >
    <div className={containerClassName}>
      <section className={panelClassName} data-modal-content>
        <div className={DEFAULT_HEADER_CLASS_NAME}>
          {headerStart}
          <div className="ml-auto flex items-center gap-1.5">
            {headerActions}
            <button
              type="button"
              onClick={onClose}
              className="ui-icon-button"
              aria-label={closeLabel}
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>
        {children}
      </section>
    </div>
  </ModalDialog>
);
