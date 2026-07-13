import { X } from 'lucide-react';
import ModalDialog from './ModalDialog';

const DEFAULT_OVERLAY_CLASS_NAME = 'fixed inset-0 z-50 flex bg-slate-950/35 backdrop-blur-sm sm:pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:pl-[calc(1rem+env(safe-area-inset-left))] sm:pr-[calc(1rem+env(safe-area-inset-right))] sm:pt-[calc(1.5rem+env(safe-area-inset-top))]';
const DEFAULT_PANEL_CLASS_NAME = 'ml-auto flex h-[100dvh] w-full flex-col overflow-hidden bg-white shadow-[0_20px_60px_-30px_rgba(15,23,42,0.35)] sm:h-full sm:max-w-2xl sm:rounded-[1.6rem] sm:border sm:border-slate-200';

const SlideOverPanelFrame = ({ ariaLabelledBy, children, onClose, overlayClassName = DEFAULT_OVERLAY_CLASS_NAME, restoreFocusRef }) => (
    <ModalDialog
      ariaLabelledBy={ariaLabelledBy}
      className={overlayClassName}
      onRequestClose={onClose}
      restoreFocusRef={restoreFocusRef}
    >
      <div className={DEFAULT_PANEL_CLASS_NAME} data-modal-content>
        {children}
      </div>
    </ModalDialog>
);

export const SlideOverPanelHeader = ({ closeLabel, eyebrow, icon: Icon, onClose, subtitle = '', title, titleId }) => (
  <div className="border-b border-slate-200 bg-white pb-5 pl-[calc(1.25rem+env(safe-area-inset-left))] pr-[calc(1.25rem+env(safe-area-inset-right))] pt-[calc(1.25rem+env(safe-area-inset-top))] sm:px-6 sm:py-5">
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
          {Icon ? <Icon className="h-4 w-4" /> : null}
          {eyebrow}
        </p>
        <h2 id={titleId} className="mt-2 text-xl font-semibold text-slate-900 focus:outline-none" data-modal-title tabIndex={-1}>{title}</h2>
        {subtitle ? <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">{subtitle}</p> : null}
      </div>
      <button type="button" onClick={onClose} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[1rem] border border-slate-200 bg-slate-50 text-slate-700 transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300" aria-label={closeLabel}>
        <X className="h-5 w-5" aria-hidden="true" />
      </button>
    </div>
  </div>
);

export const SlideOverPanelBody = ({ children }) => (
  <div className="min-h-0 flex-1 overflow-y-auto py-5 pl-[calc(1.25rem+env(safe-area-inset-left))] pr-[calc(1.25rem+env(safe-area-inset-right))] sm:px-6 sm:py-6">
    {children}
  </div>
);

export const SlideOverPanelFooter = ({ children }) => (
  <div className="flex items-center justify-between gap-4 border-t border-slate-200 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pl-[calc(1.25rem+env(safe-area-inset-left))] pr-[calc(1.25rem+env(safe-area-inset-right))] pt-5 sm:px-6 sm:py-5">
    {children}
  </div>
);

export default SlideOverPanelFrame;
