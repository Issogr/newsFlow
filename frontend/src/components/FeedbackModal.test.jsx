import { render, screen } from '@testing-library/react';
import FeedbackModal from './FeedbackModal';
import { createTranslator } from '../i18n';

function renderFeedbackModal(locale = 'en') {
  return render(
    <FeedbackModal
      t={createTranslator(locale)}
      onClose={vi.fn()}
    />
  );
}

describe('FeedbackModal', () => {
  test('renders localized category labels instead of translation keys', () => {
    renderFeedbackModal('en');

    expect(screen.getByText('Bug')).toBeInTheDocument();
    expect(screen.getByText('Feedback')).toBeInTheDocument();
    expect(screen.getByText('Idea')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Send feedback or report a bug' })).toHaveAttribute('aria-modal', 'true');
    expect(screen.queryByText('feedbackCategoryBug')).not.toBeInTheDocument();
    expect(screen.queryByText('feedbackCategoryFeedback')).not.toBeInTheDocument();
    expect(screen.queryByText('feedbackCategoryIdea')).not.toBeInTheDocument();
  });
});
