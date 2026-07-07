import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AdminDashboard from './AdminDashboard';
import { createTranslator } from '../i18n';
import { createAdminPasswordSetupLink, deleteAdminUser, fetchAdminUsers, updateUserSettings } from '../services/api';

vi.mock('../services/api', () => ({
  fetchAdminUsers: vi.fn(),
  createAdminPasswordSetupLink: vi.fn(),
  deleteAdminUser: vi.fn(),
  isRequestCanceled: vi.fn((error) => error?.code === 'ERR_CANCELED'),
  updateUserSettings: vi.fn()
}));

describe('AdminDashboard', () => {
  const t = createTranslator('en');
  const currentUser = { user: { username: 'admin', isAdmin: true }, settings: { themeMode: 'light' } };
  const defaultDate = '2026-03-27T10:00:00.000Z';
  const defaultLoginDate = '2026-03-27T11:00:00.000Z';
  const defaultActivityDate = '2026-03-27T11:02:00.000Z';

  function adminSummary(overrides = {}) {
    return {
      totalUsers: 1,
      onlineUsers: 0,
      activeUsers: 0,
      anonymousPublicApiRequests: 0,
      onlineWindowMinutes: 5,
      ...overrides
    };
  }

  function adminUser(overrides = {}) {
    return {
      id: 'admin-id',
      username: 'admin',
      isAdmin: true,
      isOnline: false,
      passwordConfigured: true,
      createdAt: defaultDate,
      lastLoginAt: defaultLoginDate,
      lastActivityAt: defaultActivityDate,
      ...overrides
    };
  }

  function regularUser(overrides = {}) {
    return {
      id: 'user-1',
      username: 'alice',
      isAdmin: false,
      isOnline: false,
      passwordConfigured: true,
      publicApiRequestCount: 0,
      publicApiLastUsedAt: null,
      createdAt: defaultDate,
      lastLoginAt: defaultLoginDate,
      lastActivityAt: defaultActivityDate,
      ...overrides
    };
  }

  function usersResponse(users = [], summaryOverrides = {}) {
    return {
      summary: adminSummary(summaryOverrides),
      users
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    window.confirm = vi.fn(() => true);
  });

  test('does not start overlapping user reloads while polling', async () => {
    vi.useFakeTimers();
    let resolveUsers;
    fetchAdminUsers.mockImplementation(() => new Promise((resolve) => {
      resolveUsers = resolve;
    }));

    try {
      render(<AdminDashboard t={t} currentUser={currentUser} onLogout={vi.fn()} onUserUpdate={vi.fn()} />);

      expect(fetchAdminUsers).toHaveBeenCalledTimes(1);

      act(() => {
        vi.advanceTimersByTime(30000);
      });

      expect(fetchAdminUsers).toHaveBeenCalledTimes(1);

      await act(async () => {
        resolveUsers(usersResponse());
      });

      act(() => {
        vi.advanceTimersByTime(30000);
      });

      expect(fetchAdminUsers).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test('shows the top bar, summary cards, and user table', async () => {
    fetchAdminUsers.mockResolvedValue(usersResponse([
      adminUser({ isOnline: true }),
      regularUser({
        isOnline: true,
        publicApiRequestCount: 3,
        publicApiLastUsedAt: '2026-03-27T11:05:00.000Z'
      })
    ], {
      totalUsers: 3,
      onlineUsers: 1,
      activeUsers: 2,
      anonymousPublicApiRequests: 9
    }));

    render(<AdminDashboard t={t} currentUser={currentUser} onLogout={vi.fn()} onUserUpdate={vi.fn()} />);

    expect(await screen.findByText('Admin dashboard')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Switch to dark theme' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Logout' })).toBeInTheDocument();
    expect(screen.getAllByText('Online now').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Seen activity').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Total accounts').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Anonymous API requests').length).toBeGreaterThan(0);
    expect(screen.getByText('Users')).toBeInTheDocument();
    expect(await screen.findByText('alice')).toBeInTheDocument();
    expect(screen.getByText('3 public API requests')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '🔑 Reset' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.queryByText('Online means active in the last 5 minutes.')).not.toBeInTheDocument();
  });

  test('shows backend error messages when loading users fails', async () => {
    fetchAdminUsers.mockRejectedValue({
      response: {
        status: 429,
        data: { error: { message: 'Admin requests are temporarily limited.' } }
      }
    });

    render(<AdminDashboard t={t} currentUser={currentUser} onLogout={vi.fn()} onUserUpdate={vi.fn()} />);

    expect(await screen.findByText('Admin requests are temporarily limited.')).toBeInTheDocument();
  });

  test('creates a password setup link for a user and allows deleting a user', async () => {
    const adminAndAliceResponse = usersResponse([adminUser(), regularUser()], { totalUsers: 2, activeUsers: 1 });
    fetchAdminUsers
      .mockResolvedValueOnce(adminAndAliceResponse)
      .mockResolvedValueOnce(adminAndAliceResponse)
      .mockResolvedValueOnce(usersResponse([adminUser()], { activeUsers: 1 }));

    createAdminPasswordSetupLink.mockResolvedValue({
      setupLink: 'http://localhost/password/setup#token=abc',
      expiresAt: '2026-03-27T12:00:00.000Z'
    });
    deleteAdminUser.mockResolvedValue({ success: true });

    render(<AdminDashboard t={t} currentUser={currentUser} onLogout={vi.fn()} onUserUpdate={vi.fn()} />);

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
    await waitFor(() => {
      expect(screen.queryByText('alice')).not.toBeInTheDocument();
    });
  });

  test('removes a deleted user locally even when the follow-up reload fails', async () => {
    fetchAdminUsers
      .mockResolvedValueOnce(usersResponse([adminUser(), regularUser()], { totalUsers: 2, activeUsers: 1 }))
      .mockRejectedValueOnce(new Error('Reload failed'));
    deleteAdminUser.mockResolvedValue({ success: true });

    render(<AdminDashboard t={t} currentUser={currentUser} onLogout={vi.fn()} onUserUpdate={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(deleteAdminUser).toHaveBeenCalledWith('user-1');
    });
    await waitFor(() => {
      expect(screen.queryByText('alice')).not.toBeInTheDocument();
    });
  });

  test('toggles the admin theme with the header button', async () => {
    fetchAdminUsers.mockResolvedValue(usersResponse([adminUser()]));
    updateUserSettings.mockResolvedValue({
      settings: {
        ...currentUser.settings,
        themeMode: 'dark'
      }
    });
    const ThemeHarness = () => {
      const [userState, setUserState] = useState(currentUser);

      return (
        <AdminDashboard
          t={t}
          currentUser={userState}
          onLogout={vi.fn()}
          onUserUpdate={(settings) => {
            setUserState((current) => ({
              ...current,
              settings,
            }));
          }}
        />
      );
    };

    render(<ThemeHarness />);

    fireEvent.click(await screen.findByRole('button', { name: 'Switch to dark theme' }));

    await waitFor(() => {
      expect(updateUserSettings).toHaveBeenCalledWith({ themeMode: 'dark' });
    });
    expect(await screen.findByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument();
  });
});
