import { render, screen } from '@testing-library/react';
import SlideOverPanelFrame, { SlideOverPanelBody, SlideOverPanelHeader } from './SlideOverPanelFrame';

test('fills the viewport, right-aligns the panel, and keeps its body scrollable', () => {
  render(
    <SlideOverPanelFrame ariaLabelledBy="panel-title" onClose={vi.fn()}>
      <SlideOverPanelHeader closeLabel="Close" onClose={vi.fn()} title="Panel" titleId="panel-title" />
      <SlideOverPanelBody>Scrollable content</SlideOverPanelBody>
    </SlideOverPanelFrame>
  );

  const dialog = screen.getByRole('dialog', { name: 'Panel' });
  expect(dialog).toHaveClass('h-[100dvh]', 'w-full', 'flex', 'overflow-hidden');
  expect(dialog.querySelector('[data-modal-content]')).toHaveClass('ml-auto', 'h-[100dvh]', 'sm:h-full');
  expect(screen.getByText('Scrollable content')).toHaveClass('min-h-0', 'overflow-y-auto');
});
