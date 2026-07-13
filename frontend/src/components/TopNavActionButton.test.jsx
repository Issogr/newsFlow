import { render, screen } from '@testing-library/react';
import { Search } from 'lucide-react';
import TopNavActionButton from './TopNavActionButton';

test('uses square count badges and circular status dots', () => {
  render(
    <>
      <TopNavActionButton icon={Search} label="Count" badge={2} />
      <TopNavActionButton icon={Search} label="Status" badge="" />
    </>
  );

  expect(screen.getByText('2')).toHaveClass('rounded-md');
  expect(screen.getByRole('button', { name: 'Status' }).querySelector('.absolute')).toHaveClass('rounded-full');
});
