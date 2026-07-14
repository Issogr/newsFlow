import { useRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ModalDialog from './ModalDialog';

function DialogHarness({ dismissOnBackdrop = false, dismissOnEscape = true }) {
  const [open, setOpen] = useState(false);
  const openerRef = useRef(null);

  return (
    <>
      <button ref={openerRef} type="button" onClick={() => setOpen(true)}>Open</button>
      {open ? (
        <ModalDialog
          ariaLabelledBy="test-dialog-title"
          className="fixed inset-0"
          dismissOnBackdrop={dismissOnBackdrop}
          dismissOnEscape={dismissOnEscape}
          onRequestClose={() => setOpen(false)}
          restoreFocusRef={openerRef}
        >
          <div data-modal-content>
            <h2 id="test-dialog-title" data-modal-title tabIndex={-1}>Dialog title</h2>
            <button type="button">Action</button>
          </div>
        </ModalDialog>
      ) : null}
    </>
  );
}

test('labels the modal, focuses its title, and restores its opener on cancel', () => {
  render(<DialogHarness />);
  const opener = screen.getByRole('button', { name: 'Open' });
  fireEvent.click(opener);

  const dialog = screen.getByRole('dialog', { name: 'Dialog title' });
  expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(screen.getByRole('heading', { name: 'Dialog title' })).toHaveFocus();

  fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
});

test('only dismisses direct backdrop interactions when enabled', () => {
  render(<DialogHarness dismissOnBackdrop />);
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  const dialog = screen.getByRole('dialog');

  fireEvent.pointerDown(screen.getByRole('button', { name: 'Action' }));
  fireEvent.click(screen.getByRole('button', { name: 'Action' }));
  expect(dialog).toBeInTheDocument();

  fireEvent.pointerDown(dialog);
  fireEvent.click(dialog);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('can make Escape non-dismissible', () => {
  render(<DialogHarness dismissOnEscape={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  const dialog = screen.getByRole('dialog');

  fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }));
  expect(dialog).toBeInTheDocument();
});

test('uses the page fallback when no connected opener exists', () => {
  const modal = (
    <>
      <button type="button" data-focus-fallback>Page heading</button>
      <ModalDialog ariaLabel="Dialog" className="fixed inset-0">
        <div data-modal-content>Content</div>
      </ModalDialog>
    </>
  );
  const { rerender } = render(modal);

  rerender(<button type="button" data-focus-fallback>Page heading</button>);

  expect(screen.getByRole('button', { name: 'Page heading' })).toHaveFocus();
});
