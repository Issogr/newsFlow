import { fireEvent, render, screen } from '@testing-library/react';
import SourceIcon from './SourceIcon';

describe('SourceIcon', () => {
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
