import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PasswordSetupScreen from './PasswordSetupScreen';
import { createTranslator } from '../i18n';
import { completePasswordSetup, validatePasswordSetupToken } from '../services/api';

vi.mock('../services/api', () => ({
  validatePasswordSetupToken: vi.fn(),
  completePasswordSetup: vi.fn()
}));

describe('PasswordSetupScreen', () => {
  const t = createTranslator('en');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('validates the token and completes password setup', async () => {
    const onComplete = jest.fn();

    validatePasswordSetupToken.mockResolvedValue({
      username: 'alice',
      isAdmin: false,
      purpose: 'password-setup',
      expiresAt: '2026-03-27T12:00:00.000Z'
    });
    completePasswordSetup.mockResolvedValue({
      token: 'session-token',
      user: { id: 'user-1', username: 'alice', isAdmin: false },
      settings: {},
      limits: {},
      customSources: []
    });

    render(<PasswordSetupScreen t={t} token="setup-token" onComplete={onComplete} />);

    expect(await screen.findByText('Account: alice')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'renewed123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }));

    await waitFor(() => {
      expect(completePasswordSetup).toHaveBeenCalledWith({ token: 'setup-token', password: 'renewed123' });
    });
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ token: 'session-token' }));
  });

  test('blocks short passwords before submitting', async () => {
    validatePasswordSetupToken.mockResolvedValue({
      username: 'alice',
      isAdmin: false,
      purpose: 'password-setup',
      expiresAt: '2026-03-27T12:00:00.000Z'
    });

    render(<PasswordSetupScreen t={t} token="setup-token" onComplete={jest.fn()} />);

    expect(await screen.findByText('Account: alice')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save password' }));

    expect(completePasswordSetup).not.toHaveBeenCalled();
    expect(await screen.findByText('Password must be at least 8 characters long')).toBeInTheDocument();
  });
});
