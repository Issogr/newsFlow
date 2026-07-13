import { useLayoutEffect, useRef } from 'react';
import useLockBodyScroll from '../hooks/useLockBodyScroll';

const ModalDialog = ({
  ariaLabel,
  ariaLabelledBy,
  children,
  className,
  dismissOnBackdrop = false,
  dismissOnEscape = true,
  onRequestClose,
  restoreFocusRef,
}) => {
  const dialogRef = useRef(null);
  const openerRef = useRef(null);
  const pointerDownOutsideRef = useRef(false);
  const onRequestCloseRef = useRef(onRequestClose);
  onRequestCloseRef.current = onRequestClose;

  useLockBodyScroll();

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return undefined;
    }

    const explicitRestoreTarget = restoreFocusRef?.current;
    openerRef.current = explicitRestoreTarget || document.activeElement;
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }

    const initialFocusTarget = dialog.querySelector('[data-modal-title]') || dialog;
    initialFocusTarget.focus({ preventScroll: true });

    return () => {
      if (dialog.open && typeof dialog.close === 'function') {
        dialog.close();
      } else {
        dialog.removeAttribute('open');
      }

      const restoreTarget = explicitRestoreTarget || openerRef.current;
      const canRestoreTarget = restoreTarget?.isConnected
        && restoreTarget !== document.body
        && restoreTarget !== document.documentElement;
      if (canRestoreTarget) {
        restoreTarget.focus({ preventScroll: true });
      } else {
        document.querySelector('[data-focus-fallback]')?.focus({ preventScroll: true });
      }
    };
  }, [restoreFocusRef]);

  const isOutsideContent = (target) => !target?.closest?.('[data-modal-content]');

  return (
    <dialog
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={`m-0 max-h-none max-w-none border-0 p-0 ${className}`}
      tabIndex={-1}
      onCancel={(event) => {
        event.preventDefault();
        if (dismissOnEscape) {
          onRequestCloseRef.current?.();
        }
      }}
      onPointerDown={(event) => {
        pointerDownOutsideRef.current = isOutsideContent(event.target);
      }}
      onClick={(event) => {
        if (dismissOnBackdrop && pointerDownOutsideRef.current && isOutsideContent(event.target)) {
          onRequestCloseRef.current?.();
        }
        pointerDownOutsideRef.current = false;
      }}
    >
      {children}
    </dialog>
  );
};

export default ModalDialog;
