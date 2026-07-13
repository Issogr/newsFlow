import { X } from 'lucide-react';
import useLockBodyScroll from '../hooks/useLockBodyScroll';

const DEFAULT_OVERLAY_CLASS_NAME = 'fixed inset-0 z-50 flex bg-slate-950/35 backdrop-blur-sm sm:px-4 sm:py-6';
const DEFAULT_PANEL_CLASS_NAME = 'ml-auto flex h-full w-full flex-col overflow-hidden bg-white shadow-[0_20px_60px_-30px_rgba(15,23,42,0.35)] sm:max-w-2xl sm:rounded-[1.6rem] sm:border sm:border-slate-200';

const SlideOverPanelFrame = ({ children, overlayClassName = DEFAULT_OVERLAY_CLASS_NAME }) => {
  useLockBodyScroll();

  return (
    <div className={overlayClassName}>
      <div className={DEFAULT_PANEL_CLASS_NAME}>
        {children}
      </div>
    </div>
  );
};

export const SlideOverPanelHeader = ({ closeLabel, eyebrow, icon: Icon, onClose, subtitle = '', title }) => (
  <div className="border-b border-slate-200 bg-white px-5 py-5 sm:px-6">
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
          {Icon ? <Icon className="h-4 w-4" /> : null}
          {eyebrow}
        </p>
        <h2 className="mt-2 text-xl font-semibold text-slate-900">{title}</h2>
        {subtitle ? <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">{subtitle}</p> : null}
      </div>
      <button type="button" onClick={onClose} className="rounded-full p-2 text-slate-500 hover:bg-slate-100" aria-label={closeLabel}>
        <X className="h-5 w-5" />
      </button>
    </div>
  </div>
);

export const SlideOverPanelBody = ({ children }) => (
  <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6 sm:py-6">
    {children}
  </div>
);

export const SlideOverPanelFooter = ({ children }) => (
  <div className="flex items-center justify-between gap-4 border-t border-slate-200 px-5 py-5 sm:px-6">
    {children}
  </div>
);

export default SlideOverPanelFrame;
