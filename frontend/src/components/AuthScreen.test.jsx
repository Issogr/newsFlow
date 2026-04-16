import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import AuthScreen from './AuthScreen';
import { createTranslator } from '../i18n';

describe('AuthScreen', () => {
  const t = createTranslator('en');

  test('blocks registration when the password is empty', async () => {
    const onRegister = jest.fn();

    render(
      <AuthScreen
        t={t}
        onLogin={jest.fn()}
        onRegister={onRegister}
        busy={false}
        error={null}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Create user' }).closest('form'));

    expect(onRegister).not.toHaveBeenCalled();
    expect(await screen.findByText('Password is required')).toBeInTheDocument();
  });

  test('shows the password hint only in registration mode', () => {
    render(
      <AuthScreen
        t={t}
        onLogin={jest.fn()}
        onRegister={jest.fn()}
        busy={false}
        error={null}
      />
    );

    expect(screen.queryByText('Use at least 8 characters when creating a new account.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(screen.getByText('Use at least 8 characters when creating a new account.')).toBeInTheDocument();
  });

  test('submits registration when a password is provided', () => {
    const onRegister = jest.fn();

    render(
      <AuthScreen
        t={t}
        onLogin={jest.fn()}
        onRegister={onRegister}
        busy={false}
        error={null}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create user' }));

    expect(onRegister).toHaveBeenCalledWith({ username: 'alice', password: 'secret123' });
  });

  test('blocks registration when the password is too short', async () => {
    const onRegister = jest.fn();

    render(
      <AuthScreen
        t={t}
        onLogin={jest.fn()}
        onRegister={onRegister}
        busy={false}
        error={null}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create user' }));

    expect(onRegister).not.toHaveBeenCalled();
    expect(await screen.findByText('Password must be at least 8 characters long')).toBeInTheDocument();
  });

  test('shows technical-cookie legal links on the auth screen', () => {
    render(
      <AuthScreen
        t={t}
        onLogin={jest.fn()}
        onRegister={jest.fn()}
        busy={false}
        error={null}
      />
    );

    expect(screen.getByText('This website uses only technical cookies strictly necessary for login, authentication, and secure access to reserved areas.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy-policy');
    expect(screen.getByRole('link', { name: 'Cookie Policy' })).toHaveAttribute('href', '/cookie-policy');
  });
});
