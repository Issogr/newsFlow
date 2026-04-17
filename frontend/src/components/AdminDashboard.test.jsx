import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AdminDashboard from './AdminDashboard';
import { createTranslator } from '../i18n';
import { createAdminPasswordSetupLink, deleteAdminUser, fetchAdminUsers } from '../services/api';

vi.mock('../services/api', () => ({
  fetchAdminUsers: vi.fn(),
  createAdminPasswordSetupLink: vi.fn(),
  deleteAdminUser: vi.fn()
}));

describe('AdminDashboard', () => {
  const t = createTranslator('en');
  const currentUser = { user: { username: 'admin', isAdmin: true } };

  beforeEach(() => {
    jest.clearAllMocks();
    window.confirm = jest.fn(() => true);
  });

  test('shows the top bar, summary cards, and user table', async () => {
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
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Logout' })).toBeInTheDocument();
    expect(screen.getAllByText('Online now').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Seen activity').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Total accounts').length).toBeGreaterThan(0);
    expect(screen.getByText('Users')).toBeInTheDocument();
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '🔑 Reset' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.queryByText('Online means active in the last 5 minutes.')).not.toBeInTheDocument();
  });

  test('creates a password setup link for a user and allows deleting a user', async () => {
    fetchAdminUsers
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce({
        summary: {
          totalUsers: 1,
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
          }
        ]
      });

    createAdminPasswordSetupLink.mockResolvedValue({
      setupLink: 'http://localhost/password/setup#token=abc',
      expiresAt: '2026-03-27T12:00:00.000Z'
    });
    deleteAdminUser.mockResolvedValue({ success: true });

    render(<AdminDashboard t={t} currentUser={currentUser} onLogout={jest.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: '🔑 Reset' }));

    await waitFor(() => {
      expect(createAdminPasswordSetupLink).toHaveBeenCalledWith('user-1');
    });
    expect(await screen.findByText('Setup link ready for alice')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(deleteAdminUser).toHaveBeenCalledWith('user-1');
    });
    expect(window.confirm).toHaveBeenCalledWith('Delete alice? This cannot be undone.');
  });
});
