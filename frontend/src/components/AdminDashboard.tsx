import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, KeyRound, LogOut, Trash2, UserCheck, Users, X } from 'lucide-react';
import BrandMark from './BrandMark';
import InlineAlert from './InlineAlert';
import useLatestRequest from '../hooks/useLatestRequest';
import { createAdminPasswordSetupLink, deleteAdminUser, fetchAdminUsers, isRequestCanceled } from '../services/api';
import { getFriendlyApiErrorMessage } from '../utils/apiError';
import type { AdminSummary, AdminUser, CurrentUser, Translator } from '../types';

const REFRESH_INTERVAL_MS = 30000;
const USER_ROW_LAYOUT = 'lg:grid lg:grid-cols-[minmax(8rem,1fr)_minmax(0,3fr)_13rem] lg:items-center lg:gap-6';

function formatDateTime(value: unknown) {
  if (!value) {
    return '—';
  }

  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    return '—';
  }

  return parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const AdminDashboard = ({ t, currentUser, onLogout }: {
  t: Translator;
  currentUser: CurrentUser;
  onLogout: () => void;
}) => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [creatingForUserId, setCreatingForUserId] = useState('');
  const [deletingUserId, setDeletingUserId] = useState('');
  const [latestGeneratedLink, setLatestGeneratedLink] = useState<{ userId: string; setupLink: string; expiresAt: string } | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const { startLatestRequest } = useLatestRequest();
  const hasLoadedRef = useRef(false);
  const isMountedRef = useRef(false);
  const usersRequestInFlightRef = useRef<AbortSignal | null>(null);
  const copyTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const loadUsers = useCallback(async ({ showRefreshingIndicator = false }: { showRefreshingIndicator?: boolean } = {}) => {
    if (usersRequestInFlightRef.current && !usersRequestInFlightRef.current.aborted && !showRefreshingIndicator) {
      return;
    }

    const request = startLatestRequest();
    usersRequestInFlightRef.current = request.signal;

    if (!hasLoadedRef.current) {
      setLoading(true);
    } else if (showRefreshingIndicator) {
      setRefreshing(true);
    }

    try {
      const response = await fetchAdminUsers({ signal: request.signal });
      if (!isMountedRef.current || !request.isLatest()) {
        return;
      }

      hasLoadedRef.current = true;
      setUsers(Array.isArray(response.users) ? response.users : []);
      setSummary(response.summary);
      setError('');
    } catch (requestError) {
      if (isRequestCanceled(requestError)) {
        return;
      }

      if (isMountedRef.current && request.isLatest()) {
        setError(getFriendlyApiErrorMessage(requestError, t));
      }
    } finally {
      if (usersRequestInFlightRef.current === request.signal) {
        usersRequestInFlightRef.current = null;
      }

      if (isMountedRef.current && request.isLatest()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [startLatestRequest, t]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    const refreshVisibleUsers = () => {
      if (document.visibilityState !== 'hidden') {
        void loadUsers();
      }
    };
    const intervalId = window.setInterval(refreshVisibleUsers, REFRESH_INTERVAL_MS);
    document.addEventListener('visibilitychange', refreshVisibleUsers);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', refreshVisibleUsers);
    };
  }, [loadUsers]);

  const userActionPending = Boolean(creatingForUserId || deletingUserId);
  const summaryCards = [
    {
      key: 'online',
      label: t('adminOnlineUsers'),
      value: summary?.onlineUsers,
      icon: UserCheck,
      accent: 'bg-emerald-100 text-emerald-700',
    },
    {
      key: 'total',
      label: t('adminTotalUsers'),
      value: summary?.totalUsers,
      icon: Users,
      accent: 'bg-sky-100 text-sky-700',
    },
  ];

  const handleCreateLink = async (user: AdminUser) => {
    setCreatingForUserId(user.id);
    setError('');

    try {
      const response = await createAdminPasswordSetupLink(user.id);
      if (!isMountedRef.current) {
        return;
      }

      setLatestGeneratedLink({
        userId: user.id,
        setupLink: response.setupLink,
        expiresAt: response.expiresAt,
      });
      setCopiedLink(false);
    } catch (requestError) {
      if (isMountedRef.current) {
        setError(getFriendlyApiErrorMessage(requestError, t));
      }
    } finally {
      if (isMountedRef.current) {
        setCreatingForUserId('');
      }
    }
  };

  const handleCopyLink = async () => {
    if (!latestGeneratedLink?.setupLink || !navigator.clipboard?.writeText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(latestGeneratedLink.setupLink);
      if (!isMountedRef.current) {
        return;
      }
      setCopiedLink(true);
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => {
        setCopiedLink(false);
        copyTimeoutRef.current = null;
      }, 1500);
    } catch {
      if (isMountedRef.current) {
        setError(t('adminCopyLinkError'));
      }
    }
  };

  const handleDeleteUser = async (user: AdminUser) => {
    const confirmed = window.confirm(t('adminDeleteUserConfirm', { username: user.username }));
    if (!confirmed) {
      return;
    }

    setDeletingUserId(user.id);
    setError('');

    try {
      await deleteAdminUser(user.id);
      if (!isMountedRef.current) {
        return;
      }

      setUsers((currentUsers) => currentUsers.filter((currentUserItem) => currentUserItem.id !== user.id));
      setSummary((currentSummary) => currentSummary && ({
        ...currentSummary,
        totalUsers: Math.max(0, Number(currentSummary.totalUsers || 0) - 1),
        onlineUsers: user.isOnline ? Math.max(0, Number(currentSummary.onlineUsers || 0) - 1) : currentSummary.onlineUsers,
      }));
      setLatestGeneratedLink((current) => (current?.userId === user.id ? null : current));
      loadUsers({ showRefreshingIndicator: true });
    } catch (requestError) {
      if (isMountedRef.current) {
        setError(getFriendlyApiErrorMessage(requestError, t));
      }
    } finally {
      if (isMountedRef.current) {
        setDeletingUserId('');
      }
    }
  };

  return (
    <div className="min-h-screen bg-canvas text-ink-heading">
      <div className="flex min-h-screen w-full flex-col">
        <header className="border-b border-line bg-surface px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] lg:px-6">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <BrandMark className="h-9 w-9" />
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-ink-heading">{t('adminDashboardTitle')}</h1>
                <p className="text-sm text-ink-subtle">{currentUser?.user?.username}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-700"
            >
              <LogOut className="h-4 w-4" />
              {t('logout')}
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-6 lg:px-6">
          <section aria-label={t('adminOverview')} className="grid grid-cols-2 gap-3 sm:gap-5">
            {summaryCards.map((card) => {
              const Icon = card.icon;

              return (
                <div key={card.key} className="rounded-2xl border border-line bg-surface p-4 sm:p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-medium text-ink-subtle">{card.label}</h2>
                      <p className="mt-3 text-3xl font-semibold tracking-tight text-ink-heading tabular-nums sm:text-4xl">{card.value ?? '—'}</p>
                    </div>
                    <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${card.accent} sm:h-9 sm:w-9`}>
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                  </div>
                </div>
              );
            })}
          </section>

          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-subtle">
            {summary ? <p>{t('adminOnlineHelp', { minutes: summary.onlineWindowMinutes })}</p> : null}
            <p>{t('adminAutoRefresh', { seconds: REFRESH_INTERVAL_MS / 1000 })}</p>
          </div>

          {error ? <InlineAlert className="mt-5">{error}</InlineAlert> : null}

          <section className="mt-8" aria-labelledby="admin-users-title" aria-busy={loading || refreshing}>
            <div className="mb-4 flex items-center gap-3">
              <h2 id="admin-users-title" className="text-lg font-semibold text-ink-heading">{t('adminUsersTitle')}</h2>
              {summary ? <span className="rounded-full bg-surface-inset px-2.5 py-0.5 text-xs font-medium text-ink-muted">{summary.totalUsers}</span> : null}
            </div>

            <div className="overflow-hidden rounded-2xl border border-line bg-surface">
              {loading ? (
                <p role="status" className="p-6 text-sm text-ink-subtle">{t('loadingMore')}</p>
              ) : users.length === 0 ? (
                <p className="p-6 text-sm text-ink-subtle">{t(error ? 'adminUsersUnavailable' : 'adminNoUsers')}</p>
              ) : (
                <>
                  <div aria-hidden="true" className={`hidden border-b border-line bg-surface-soft px-5 py-3 text-xs font-medium text-ink-subtle ${USER_ROW_LAYOUT}`}>
                    <span>{t('username')}</span>
                    <div className="grid grid-cols-3 gap-6">
                      <span>{t('createdAt')}</span>
                      <span>{t('lastActivityAt')}</span>
                      <span>{t('adminApiActivity')}</span>
                    </div>
                    <span className="text-right">{t('adminActions')}</span>
                  </div>
                  <ul className="divide-y divide-line" aria-label={t('adminUsersTitle')}>
                    {users.map((user) => (
                      <li key={user.id} className="p-5">
                        <div className={USER_ROW_LAYOUT}>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="break-all font-semibold text-ink-heading">{user.username}</h3>
                              {user.isAdmin ? <span className="rounded bg-surface-inset px-1.5 py-0.5 text-xs text-ink-muted">{t('adminAccount')}</span> : null}
                            </div>
                            <p className="mt-1 flex items-center gap-2 text-xs text-ink-subtle">
                              <span aria-hidden="true" className={`h-2 w-2 rounded-full ${user.isOnline ? 'bg-emerald-500' : 'bg-surface-disabled'}`} />
                              {t(user.isOnline ? 'onlineNow' : 'offlineNow')}
                            </p>
                          </div>

                          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm lg:mt-0 lg:grid-cols-3 lg:gap-6">
                            <div>
                              <dt className="mb-1 text-xs text-ink-subtle lg:sr-only">{t('createdAt')}</dt>
                              <dd className="text-ink-body">{formatDateTime(user.createdAt)}</dd>
                            </div>
                            <div>
                              <dt className="mb-1 text-xs text-ink-subtle lg:sr-only">{t('lastActivityAt')}</dt>
                              <dd className="text-ink-body">{user.lastActivityAt ? formatDateTime(user.lastActivityAt) : t('adminNoActivity')}</dd>
                            </div>
                            <div className="col-span-2 lg:col-span-1">
                              <dt className="mb-1 text-xs text-ink-subtle lg:sr-only">{t('adminApiActivity')}</dt>
                              <dd>
                                <p className="font-medium text-ink-body">{t('adminPublicApiRequestsValue', { count: user.publicApiRequestCount || 0 })}</p>
                                <p className="mt-1 text-xs text-ink-subtle">{t('adminPublicApiLastUsedValue', {
                                  time: user.publicApiLastUsedAt ? formatDateTime(user.publicApiLastUsedAt) : t('adminPublicApiNeverUsed')
                                })}</p>
                              </dd>
                            </div>
                          </dl>

                          <div className="mt-4 grid grid-cols-2 gap-2 lg:mt-0 lg:flex lg:flex-wrap lg:justify-end" role="group" aria-label={t('adminUserActions', { username: user.username })}>
                            <button
                              type="button"
                              onClick={() => handleCreateLink(user)}
                              disabled={userActionPending}
                              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm font-medium text-ink-body transition-colors hover:bg-hover-raised disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <KeyRound className="h-4 w-4 shrink-0" aria-hidden="true" />
                              {creatingForUserId === user.id ? t('saving') : t('adminResetPasswordAction')}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteUser(user)}
                              disabled={user.isAdmin || userActionPending}
                              title={user.isAdmin ? t('adminAccountProtected') : undefined}
                              className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${user.isAdmin ? 'border-line bg-surface-raised text-ink-subtle' : 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'}`}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                              {deletingUserId === user.id ? t('deleting') : t('adminDeleteUserAction')}
                            </button>
                          </div>
                        </div>

                        {latestGeneratedLink?.userId === user.id ? (
                          <section aria-label={t('adminSetupLinkReadyFor', { username: user.username })} className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p role="status" className="text-sm font-medium text-emerald-900">{t('adminSetupLinkReadyFor', { username: user.username })}</p>
                                <p className="mt-1 text-xs text-emerald-800">{t('adminResetLinkHelp')}</p>
                              </div>
                              <button type="button" className="ui-icon-button" onClick={() => setLatestGeneratedLink(null)} aria-label={t('close')}>
                                <X className="h-4 w-4" aria-hidden="true" />
                              </button>
                            </div>
                            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                              <input
                                readOnly
                                aria-label={t('adminSetupLinkReadyFor', { username: user.username })}
                                value={latestGeneratedLink.setupLink}
                                onFocus={(event) => event.currentTarget.select()}
                                className="ui-field min-w-0 flex-1"
                              />
                              <button
                                type="button"
                                onClick={handleCopyLink}
                                disabled={!navigator.clipboard?.writeText}
                                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-surface px-4 py-2 text-sm font-medium text-emerald-800 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <Copy className="h-4 w-4" aria-hidden="true" />
                                {copiedLink ? t('copied') : t('copyLink')}
                              </button>
                            </div>
                            <p className="mt-2 text-xs text-emerald-700">{t('expiresAtLabel', { time: formatDateTime(latestGeneratedLink.expiresAt) })}</p>
                          </section>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </section>

        </main>
      </div>
    </div>
  );
};

export default AdminDashboard;
