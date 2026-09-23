import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AdminDashboard from './AdminDashboard';
import { createTranslator } from '../i18n';
import { createAdminPasswordSetupLink as createAdminPasswordSetupLinkImplementation, deleteAdminUser as deleteAdminUserImplementation, fetchAdminUsers as fetchAdminUsersImplementation } from '../services/api';
import type { AdminSummary, AdminUser, CurrentUser } from '../types';

vi.mock('../services/api', () => ({
  fetchAdminUsers: vi.fn(),
  createAdminPasswordSetupLink: vi.fn(),
  deleteAdminUser: vi.fn(),
  isRequestCanceled: vi.fn((error) => error?.code === 'ERR_CANCELED')
}));

const createAdminPasswordSetupLink = vi.mocked(createAdminPasswordSetupLinkImplementation);
const deleteAdminUser = vi.mocked(deleteAdminUserImplementation);
const fetchAdminUsers = vi.mocked(fetchAdminUsersImplementation);

describe('AdminDashboard', () => {
  const t = createTranslator('en');
  const currentUser: CurrentUser = { user: { username: 'admin', isAdmin: true }, settings: { themeMode: 'light' } };
  const defaultDate = '2026-03-27T10:00:00.000Z';
  const defaultLoginDate = '2026-03-27T11:00:00.000Z';
  const defaultActivityDate = '2026-03-27T11:02:00.000Z';

  function adminSummary(overrides: Partial<AdminSummary> = {}): AdminSummary {
    return {
      totalUsers: 1,
      onlineUsers: 0,
      activeUsers: 0,
      anonymousPublicApiRequests: 0,
      onlineWindowMinutes: 5,
      ...overrides
    };
  }

  function adminUser(overrides: Partial<AdminUser> = {}): AdminUser {
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

  function regularUser(overrides: Partial<AdminUser> = {}): AdminUser {
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

  function usersResponse(users: AdminUser[] = [], summaryOverrides: Partial<AdminSummary> = {}) {
    return {
      summary: adminSummary(summaryOverrides),
      users
    };
  }

  beforeEach(() => {
    window.confirm = vi.fn(() => true);
  });

  test('does not start overlapping user reloads while polling', async () => {
    vi.useFakeTimers();
    let resolveUsers!: (value: ReturnType<typeof usersResponse>) => void;
    fetchAdminUsers.mockImplementation(() => new Promise((resolve) => {
      resolveUsers = resolve;
    }));

    try {
      render(<AdminDashboard t={t} currentUser={currentUser} onLogout={vi.fn()} />);

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

  test('shows only the two account totals and the requested details for every account', async () => {
    fetchAdminUsers.mockResolvedValue(usersResponse([
      adminUser({ isOnline: true }),
      regularUser({
        isOnline: false,
        publicApiRequestCount: 3,
        publicApiLastUsedAt: '2026-03-27T11:05:00.000Z'
      })
    ], {
      totalUsers: 2,
      onlineUsers: 1,
      activeUsers: 2,
      anonymousPublicApiRequests: 9
    }));

    const onLogout = vi.fn();
    render(<AdminDashboard t={t} currentUser={currentUser} onLogout={onLogout} />);

    expect(await screen.findByText('Admin dashboard')).toBeInTheDocument();
    const header = within(screen.getByRole('banner'));
    expect(header.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(header.getByRole('button', { name: 'Logout' }));
    expect(onLogout).toHaveBeenCalledOnce();
    expect(await screen.findByRole('heading', { name: 'alice' })).toBeInTheDocument();
    const overview = within(screen.getByRole('region', { name: 'Account overview' }));
    expect(overview.getAllByRole('heading')).toHaveLength(2);
    expect(overview.getByRole('heading', { name: 'Online now' })).toBeInTheDocument();
    expect(overview.getByText('1')).toBeInTheDocument();
    expect(overview.getByRole('heading', { name: 'Total accounts' })).toBeInTheDocument();
    expect(overview.getByText('2')).toBeInTheDocument();
    expect(screen.queryByText('Seen activity')).not.toBeInTheDocument();
    expect(screen.queryByText('Anonymous API requests')).not.toBeInTheDocument();
    expect(screen.queryByText('Last login')).not.toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Users' })).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'admin' })).toBeInTheDocument();
    const formatDate = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    expect(screen.getAllByText(formatDate(defaultDate))).toHaveLength(2);
    expect(screen.getAllByText(formatDate(defaultActivityDate))).toHaveLength(2);
    expect(screen.getByText('3 public API requests')).toBeInTheDocument();
    expect(screen.getByText(`Last API use: ${formatDate('2026-03-27T11:05:00.000Z')}`)).toBeInTheDocument();
    const aliceActions = within(screen.getByRole('group', { name: 'Actions for alice' }));
    expect(aliceActions.getByRole('button', { name: 'Reset' })).toBeInTheDocument();
    expect(aliceActions.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    const adminActions = within(screen.getByRole('group', { name: 'Actions for admin' }));
    const protectedDelete = adminActions.getByRole('button', { name: 'Delete' });
    expect(protectedDelete).toBeDisabled();
    expect(protectedDelete).toHaveAttribute('title', 'Cannot be deleted');
    fireEvent.click(protectedDelete);
    expect(window.confirm).not.toHaveBeenCalled();
    expect(deleteAdminUser).not.toHaveBeenCalled();
    expect(screen.getByText('Online means active in the last 5 minutes.')).toBeInTheDocument();
    expect(screen.getByText('Updates every 30 seconds.')).toBeInTheDocument();
  });

  test('shows backend error messages when loading users fails', async () => {
    fetchAdminUsers.mockRejectedValue({
      response: {
        status: 429,
        data: { error: { message: 'Admin requests are temporarily limited.' } }
      }
    });

    render(<AdminDashboard t={t} currentUser={currentUser} onLogout={vi.fn()} />);

    expect(await screen.findByText('Admin requests are temporarily limited.')).toBeInTheDocument();
    expect(screen.getByText('Could not load users. Try refreshing.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Account overview' })).queryByText('0')).not.toBeInTheDocument();
  });

  test('creates a password setup link for a user and allows deleting a user', async () => {
    const adminAndAliceResponse = usersResponse([adminUser(), regularUser()], { totalUsers: 2, activeUsers: 1 });
    fetchAdminUsers
      .mockResolvedValueOnce(adminAndAliceResponse)
      .mockResolvedValueOnce(usersResponse([adminUser()], { activeUsers: 1 }));

    createAdminPasswordSetupLink.mockResolvedValue({
      setupLink: 'http://localhost/password/setup#token=abc',
      expiresAt: '2026-03-27T12:00:00.000Z'
    });
    deleteAdminUser.mockResolvedValue({ success: true });

    render(<AdminDashboard t={t} currentUser={currentUser} onLogout={vi.fn()} />);

    const aliceActions = within(await screen.findByRole('group', { name: 'Actions for alice' }));
    fireEvent.click(aliceActions.getByRole('button', { name: 'Reset' }));

    await waitFor(() => {
      expect(createAdminPasswordSetupLink).toHaveBeenCalledWith('user-1');
    });
    const resetLink = await screen.findByRole('textbox', { name: 'Password reset link for alice' });
    expect(resetLink).toHaveValue('http://localhost/password/setup#token=abc');
    expect(resetLink).toHaveAttribute('readonly');
    expect(screen.getByText(/Share this link with the user/)).toBeInTheDocument();
    expect(fetchAdminUsers).toHaveBeenCalledTimes(1);

    fireEvent.click(aliceActions.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(deleteAdminUser).toHaveBeenCalledWith('user-1');
    });
    expect(window.confirm).toHaveBeenCalledWith('Delete alice? This cannot be undone.');
    await waitFor(() => {
      expect(screen.queryByText('alice')).not.toBeInTheDocument();
    });
    expect(screen.queryByRole('textbox', { name: 'Password reset link for alice' })).not.toBeInTheDocument();
  });

  test('does not delete the account when confirmation is canceled', async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    fetchAdminUsers.mockResolvedValue(usersResponse([adminUser(), regularUser()], { totalUsers: 2 }));

    render(<AdminDashboard t={t} currentUser={currentUser} onLogout={vi.fn()} />);
    const aliceActions = within(await screen.findByRole('group', { name: 'Actions for alice' }));
    fireEvent.click(aliceActions.getByRole('button', { name: 'Delete' }));

    expect(window.confirm).toHaveBeenCalledWith('Delete alice? This cannot be undone.');
    expect(deleteAdminUser).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'alice' })).toBeInTheDocument();
  });

  test('keeps the account and allows retrying when deletion fails', async () => {
    fetchAdminUsers.mockResolvedValue(usersResponse([adminUser(), regularUser()], { totalUsers: 2 }));
    deleteAdminUser.mockRejectedValue(new Error('Delete failed'));

    render(<AdminDashboard t={t} currentUser={currentUser} onLogout={vi.fn()} />);
    const aliceActions = within(await screen.findByRole('group', { name: 'Actions for alice' }));
    fireEvent.click(aliceActions.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Delete failed');
    expect(screen.getByRole('heading', { name: 'alice' })).toBeInTheDocument();
    expect(aliceActions.getByRole('button', { name: 'Delete' })).toBeEnabled();
    expect(within(screen.getByRole('region', { name: 'Account overview' })).getByText('2')).toBeInTheDocument();
  });

  test('removes a deleted user locally even when the follow-up reload fails', async () => {
    fetchAdminUsers
      .mockResolvedValueOnce(usersResponse([adminUser(), regularUser({ isOnline: true })], { totalUsers: 2, onlineUsers: 1, activeUsers: 1 }))
      .mockRejectedValueOnce(new Error('Reload failed'));
    deleteAdminUser.mockResolvedValue({ success: true });

    render(<AdminDashboard t={t} currentUser={currentUser} onLogout={vi.fn()} />);

    const aliceActions = within(await screen.findByRole('group', { name: 'Actions for alice' }));
    fireEvent.click(aliceActions.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(deleteAdminUser).toHaveBeenCalledWith('user-1');
    });
    await waitFor(() => {
      expect(screen.queryByText('alice')).not.toBeInTheDocument();
    });
    const overview = within(screen.getByRole('region', { name: 'Account overview' }));
    expect(overview.getByText('1')).toBeInTheDocument();
    expect(overview.getByText('0')).toBeInTheDocument();
  });

  test('a stale poll cannot restore a deleted account or its totals', async () => {
    const oldResponse = usersResponse([adminUser(), regularUser()], { totalUsers: 2 });
    let resolvePoll!: (value: ReturnType<typeof usersResponse>) => void;
    fetchAdminUsers
      .mockResolvedValueOnce(oldResponse)
      .mockImplementationOnce(() => new Promise((resolve) => { resolvePoll = resolve; }))
      .mockResolvedValueOnce(usersResponse([adminUser()]));
    deleteAdminUser.mockResolvedValue({ success: true });

    render(<AdminDashboard t={t} currentUser={currentUser} onLogout={vi.fn()} />);
    await screen.findByRole('heading', { name: 'alice' });
    fireEvent(document, new Event('visibilitychange'));
    expect(fetchAdminUsers).toHaveBeenCalledTimes(2);
    const pollSignal = fetchAdminUsers.mock.calls[1][0]?.signal;

    const aliceActions = within(screen.getByRole('group', { name: 'Actions for alice' }));
    fireEvent.click(aliceActions.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(fetchAdminUsers).toHaveBeenCalledTimes(3));
    expect(pollSignal?.aborted).toBe(true);
    await act(async () => { resolvePoll(oldResponse); });

    expect(screen.queryByRole('heading', { name: 'alice' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Account overview' })).getByText('1')).toBeInTheDocument();
  });

});
