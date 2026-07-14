import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import FeedbackModal from './FeedbackModal';
import { createTranslator } from '../i18n';
import { submitFeedback } from '../services/api';
import { createDeferred, resolveDeferred } from '../test-utils/deferred';

vi.mock('../services/api', () => ({
  submitFeedback: vi.fn()
}));

function renderFeedbackModal(locale = 'en') {
  return render(
    <FeedbackModal
      t={createTranslator(locale)}
      onClose={vi.fn()}
    />
  );
}

describe('FeedbackModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('shows compact localized categories and contextual guidance', () => {
    renderFeedbackModal('en');

    expect(screen.getByText('Bug')).toBeInTheDocument();
    expect(screen.getByText('Feedback')).toBeInTheDocument();
    expect(screen.getByText('Idea')).toBeInTheDocument();
    expect(screen.getByText('Something is broken or behaves unexpectedly.')).toBeInTheDocument();
    expect(screen.getByText('Include what happened, what you expected, and steps to reproduce it.')).toBeInTheDocument();
    expect(screen.queryByText('Share a rough edge or general comment.')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Help improve News Flow' })).toHaveAttribute('aria-modal', 'true');
    expect(screen.queryByText('feedbackCategoryBug')).not.toBeInTheDocument();
    expect(screen.queryByText('feedbackCategoryFeedback')).not.toBeInTheDocument();
    expect(screen.queryByText('feedbackCategoryIdea')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Idea' }));

    expect(screen.getByText('Suggest an improvement or new feature.')).toBeInTheDocument();
    expect(screen.getByText('Describe the improvement and how it would help.')).toBeInTheDocument();
    expect(screen.queryByText('Include what happened, what you expected, and steps to reproduce it.')).not.toBeInTheDocument();
  });

  test('shows validation beside required fields and hides empty counters', () => {
    renderFeedbackModal('en');

    const titleInput = screen.getByRole('textbox', { name: /Title/u });
    const descriptionInput = screen.getByRole('textbox', { name: /Description/u });

    expect(screen.queryByText('0/120')).not.toBeInTheDocument();
    expect(screen.queryByText('0/2800')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));

    expect(screen.getByText('Please enter a title with at least 3 characters.')).toBeInTheDocument();
    expect(screen.getByText('Please add a short description before sending.')).toBeInTheDocument();
    expect(titleInput).toHaveFocus();
    expect(titleInput).toHaveAttribute('aria-invalid', 'true');
    expect(descriptionInput).toHaveAttribute('aria-invalid', 'true');

    fireEvent.change(titleInput, { target: { value: 'Idea' } });

    expect(screen.getByText('4/120')).toBeInTheDocument();
    expect(screen.queryByText('Please enter a title with at least 3 characters.')).not.toBeInTheDocument();
  });

  test('locks dismissal while feedback is being sent', async () => {
    const request = createDeferred();
    submitFeedback.mockImplementation(() => request.promise);
    renderFeedbackModal('en');

    fireEvent.change(screen.getByRole('textbox', { name: /Title/u }), { target: { value: 'Reader issue' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Description/u }), { target: { value: 'The text is difficult to scan.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));

    await waitFor(() => {
      expect(submitFeedback).toHaveBeenCalledWith({
        category: 'bug',
        title: 'Reader issue',
        description: 'The text is difficult to scan.',
        attachment: null
      });
    });
    expect(screen.getByRole('button', { name: 'Sending...' })).toBeDisabled();
    screen.getAllByRole('button', { name: 'Cancel' }).forEach((button) => expect(button).toBeDisabled());

    await resolveDeferred(request);

    expect(screen.getByText('Feedback sent')).toBeInTheDocument();
  });
});
