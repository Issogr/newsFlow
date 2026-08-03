import { useLayoutEffect, useRef, type AriaRole, type ReactNode, type RefObject } from 'react';
import useLockBodyScroll from '../hooks/useLockBodyScroll';

interface ModalDialogProps {
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  children: ReactNode;
  className?: string;
  dismissOnBackdrop?: boolean;
  dismissOnEscape?: boolean;
  onRequestClose?: () => void;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  role?: AriaRole;
}

const ModalDialog = ({
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  children,
  className,
  dismissOnBackdrop = false,
  dismissOnEscape = true,
  onRequestClose,
  restoreFocusRef,
  role = 'dialog',
}: ModalDialogProps) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
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
    openerRef.current = explicitRestoreTarget || document.activeElement as HTMLElement | null;
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }

    const initialFocusTarget = dialog.querySelector<HTMLElement>('[data-modal-title]') || dialog;
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
        document.querySelector<HTMLElement>('[data-focus-fallback]')?.focus({ preventScroll: true });
      }
    };
  }, [restoreFocusRef]);

  const isOutsideContent = (target: EventTarget | null) => !(target as Element | null)?.closest?.('[data-modal-content]');

  return (
    <dialog
      ref={dialogRef}
      role={role}
      aria-modal="true"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      className={`m-0 h-[100dvh] w-full max-h-none max-w-none border-0 p-0 ${className}`}
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
