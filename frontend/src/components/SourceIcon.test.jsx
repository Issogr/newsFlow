import { fireEvent, render, screen } from '@testing-library/react';
import SourceIcon from './SourceIcon';

describe('SourceIcon', () => {
  test('uses the same sized container for image and fallback icons', () => {
    const { container } = render(
      <>
        <SourceIcon source={{ name: 'Image', iconUrl: 'https://example.com/icon.png' }} className="h-10 w-10" />
        <SourceIcon source={{ name: 'Fallback' }} className="h-10 w-10" />
      </>
    );
    const imageContainer = container.querySelector('img').parentElement;
    const fallbackContainer = screen.getByText('F');

    expect(imageContainer).toHaveClass('box-border', 'h-10', 'w-10', 'overflow-hidden', 'rounded-full', 'bg-slate-100', 'ring-1', 'ring-inset');
    expect(fallbackContainer).toHaveClass('box-border', 'h-10', 'w-10', 'overflow-hidden', 'rounded-full', 'bg-slate-100', 'ring-1', 'ring-inset');
    expect(imageContainer).not.toHaveClass('border');
    expect(imageContainer).not.toHaveClass('border-2');
    expect(fallbackContainer).not.toHaveClass('border');
    expect(fallbackContainer).not.toHaveClass('border-2');
    expect(container.querySelector('img')).toHaveClass('h-full', 'w-full');
  });

  test('falls back for unsafe icon URLs', () => {
    const { container } = render(<SourceIcon source={{ name: 'Example', iconUrl: 'javascript:alert(1)' }} />);

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('E')).toBeInTheDocument();
  });

  test('recovers when a failed icon URL changes', () => {
    const { container, rerender } = render(<SourceIcon source={{ name: 'Bad', iconUrl: 'https://example.com/bad.png' }} />);

    fireEvent.error(container.querySelector('img'));

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('B')).toBeInTheDocument();

    rerender(<SourceIcon source={{ name: 'Good', iconUrl: 'https://example.com/good.png' }} />);

    expect(container.querySelector('img')).toHaveAttribute('src', 'https://example.com/good.png');
  });
});
