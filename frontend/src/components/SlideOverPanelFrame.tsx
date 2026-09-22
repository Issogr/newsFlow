import { X, type LucideIcon } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import ModalDialog from './ModalDialog';

const DEFAULT_OVERLAY_CLASS_NAME = 'fixed inset-0 z-50 flex overflow-hidden bg-slate-950/35 backdrop-blur-sm sm:pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:pl-[calc(1rem+env(safe-area-inset-left))] sm:pr-[calc(1rem+env(safe-area-inset-right))] sm:pt-[calc(1.5rem+env(safe-area-inset-top))]';
const DEFAULT_PANEL_CLASS_NAME = 'ml-auto flex h-[100dvh] w-full flex-col overflow-hidden bg-surface shadow-xl sm:h-full sm:max-w-2xl sm:rounded-2xl sm:border sm:border-line';

const SlideOverPanelFrame = ({ ariaLabelledBy, children, dismissOnEscape = true, onClose, restoreFocusRef }: {
  ariaLabelledBy: string;
  children: ReactNode;
  dismissOnEscape?: boolean;
  onClose: () => void;
  restoreFocusRef?: RefObject<HTMLElement | null>;
}) => (
    <ModalDialog
      ariaLabelledBy={ariaLabelledBy}
      className={DEFAULT_OVERLAY_CLASS_NAME}
      dismissOnEscape={dismissOnEscape}
      onRequestClose={onClose}
      restoreFocusRef={restoreFocusRef}
    >
      <div className={DEFAULT_PANEL_CLASS_NAME} data-modal-content>
        {children}
      </div>
    </ModalDialog>
);

export const SlideOverPanelHeader = ({ closeDisabled = false, closeLabel, eyebrow, icon: Icon, onClose, subtitle = '', title, titleId }: {
  closeDisabled?: boolean;
  closeLabel: string;
  eyebrow?: string;
  icon?: LucideIcon;
  onClose: () => void;
  subtitle?: string;
  title: string;
  titleId: string;
}) => (
  <div className="border-b border-line bg-surface pb-5 pl-[calc(1.25rem+env(safe-area-inset-left))] pr-[calc(1.25rem+env(safe-area-inset-right))] pt-[calc(1.25rem+env(safe-area-inset-top))] sm:px-6 sm:py-5">
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="inline-flex items-center gap-2 text-xs font-medium text-ink-subtle">
          {Icon ? <Icon className="h-4 w-4" /> : null}
          {eyebrow}
        </p>
        <h2 id={titleId} className="mt-2 text-xl font-semibold text-ink-heading focus:outline-none" data-modal-title tabIndex={-1}>{title}</h2>
        {subtitle ? <p className="mt-2 max-w-xl text-sm leading-6 text-ink-muted">{subtitle}</p> : null}
      </div>
      <button type="button" onClick={onClose} disabled={closeDisabled} className="ui-icon-button" aria-label={closeLabel}>
        <X className="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
  </div>
);

export const SlideOverPanelBody = ({ children }: { children: ReactNode }) => (
  <div className="min-h-0 flex-1 overflow-y-auto py-5 pl-[calc(1.25rem+env(safe-area-inset-left))] pr-[calc(1.25rem+env(safe-area-inset-right))] sm:px-6 sm:py-6">
    {children}
  </div>
);

export const SlideOverPanelFooter = ({ children }: { children: ReactNode }) => (
  <div className="flex items-center justify-between gap-4 border-t border-line pb-[calc(1.25rem+env(safe-area-inset-bottom))] pl-[calc(1.25rem+env(safe-area-inset-left))] pr-[calc(1.25rem+env(safe-area-inset-right))] pt-5 sm:px-6 sm:py-5">
    {children}
  </div>
);

export default SlideOverPanelFrame;
