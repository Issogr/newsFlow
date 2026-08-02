import { render, screen } from '@testing-library/react';
import { Search } from 'lucide-react';
import TopNavActionButton from './TopNavActionButton';

test('uses standard pill geometry for count badges and status dots', () => {
  render(
    <>
      <TopNavActionButton icon={Search} label="Count" badge={2} />
      <TopNavActionButton icon={Search} label="Status" badge="" />
    </>
  );

  expect(screen.getByText('2')).toHaveClass('rounded-full');
  expect(screen.getByRole('button', { name: 'Status' }).querySelector('.absolute')).toHaveClass('rounded-full');
});
