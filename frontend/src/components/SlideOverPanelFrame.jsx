import useLockBodyScroll from '../hooks/useLockBodyScroll';

const DEFAULT_OVERLAY_CLASS_NAME = 'fixed inset-0 z-50 flex bg-slate-950/35 backdrop-blur-sm sm:px-4 sm:py-6';
const DEFAULT_PANEL_CLASS_NAME = 'ml-auto flex h-full w-full flex-col overflow-hidden bg-slate-50 shadow-2xl sm:max-w-2xl sm:rounded-[2rem] sm:border sm:border-slate-200';

const SlideOverPanelFrame = ({ children, overlayClassName = DEFAULT_OVERLAY_CLASS_NAME, panelClassName = DEFAULT_PANEL_CLASS_NAME }) => {
  useLockBodyScroll();

  return (
    <div className={overlayClassName}>
      <div className={panelClassName}>
        {children}
      </div>
    </div>
  );
};

export default SlideOverPanelFrame;
