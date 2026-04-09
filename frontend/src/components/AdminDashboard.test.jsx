import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AdminDashboard from './AdminDashboard';
import { createTranslator } from '../i18n';
import { createAdminPasswordSetupLink, fetchAdminUsers } from '../services/api';

vi.mock('../services/api', () => ({
  fetchAdminUsers: vi.fn(),
  createAdminPasswordSetupLink: vi.fn()
}));

describe('AdminDashboard', () => {
  const t = createTranslator('en');
  const currentUser = { user: { username: 'admin', isAdmin: true } };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('shows admin metrics and user activity details', async () => {
    fetchAdminUsers.mockResolvedValue({
      summary: {
        totalUsers: 3,
        onlineUsers: 1,
        activeUsers: 2,
        onlineWindowMinutes: 5
      },
      users: [
        {
          id: 'admin-id',
          username: 'admin',
          isAdmin: true,
          isOnline: true,
          passwordConfigured: true,
          createdAt: '2026-03-27T10:00:00.000Z',
          lastLoginAt: '2026-03-27T11:00:00.000Z',
          lastActivityAt: '2026-03-27T11:02:00.000Z'
        },
        {
          id: 'user-1',
          username: 'alice',
          isAdmin: false,
          isOnline: true,
          passwordConfigured: true,
          createdAt: '2026-03-27T10:00:00.000Z',
          lastLoginAt: '2026-03-27T11:00:00.000Z',
          lastActivityAt: '2026-03-27T11:02:00.000Z'
        }
      ]
    });

    render(<AdminDashboard t={t} currentUser={currentUser} onLogout={jest.fn()} />);

    expect(await screen.findByText('Admin dashboard')).toBeInTheDocument();
    expect(await screen.findByText('alice')).toBeInTheDocument();
    expect(screen.getByText('Total accounts')).toBeInTheDocument();
    expect(screen.getByText('Online means active in the last 5 minutes.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create setup link' })).toBeInTheDocument();
  });

  test('creates a password setup link for a managed user', async () => {
    fetchAdminUsers.mockResolvedValue({
      summary: {
        totalUsers: 2,
        onlineUsers: 0,
        activeUsers: 1,
        onlineWindowMinutes: 5
      },
      users: [
        {
          id: 'admin-id',
          username: 'admin',
          isAdmin: true,
          isOnline: false,
          passwordConfigured: true,
          createdAt: '2026-03-27T10:00:00.000Z',
          lastLoginAt: '2026-03-27T11:00:00.000Z',
          lastActivityAt: '2026-03-27T11:02:00.000Z'
        },
        {
          id: 'user-1',
          username: 'alice',
          isAdmin: false,
          isOnline: false,
          passwordConfigured: true,
          createdAt: '2026-03-27T10:00:00.000Z',
          lastLoginAt: '2026-03-27T11:00:00.000Z',
          lastActivityAt: '2026-03-27T11:02:00.000Z'
        }
      ]
    });
    createAdminPasswordSetupLink.mockResolvedValue({
      setupLink: 'http://localhost/password/setup?token=abc',
      expiresAt: '2026-03-27T12:00:00.000Z'
    });

    render(<AdminDashboard t={t} currentUser={currentUser} onLogout={jest.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Create setup link' }));

    await waitFor(() => {
      expect(createAdminPasswordSetupLink).toHaveBeenCalledWith('user-1');
    });
    expect(await screen.findByText('Setup link ready')).toBeInTheDocument();
  });
});
