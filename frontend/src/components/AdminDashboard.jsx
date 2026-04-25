import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Copy, Globe, LogOut, Moon, RefreshCw, Sun, Trash2, UserCheck, Users } from 'lucide-react';
import BrandMark from './BrandMark';
import { createAdminPasswordSetupLink, deleteAdminUser, fetchAdminUsers, updateUserSettings } from '../services/api';

const REFRESH_INTERVAL_MS = 30000;

function formatDateTime(value) {
  if (!value) {
    return ' - ';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return ' - ';
  }

  return parsed.toLocaleString();
}

const AdminDashboard = ({ t, currentUser, onLogout, onUserUpdate }) => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [themeSaving, setThemeSaving] = useState(false);
  const [error, setError] = useState('');
  const [users, setUsers] = useState([]);
  const [summary, setSummary] = useState({ totalUsers: 0, onlineUsers: 0, activeUsers: 0, onlineWindowMinutes: 5 });
  const [creatingForUserId, setCreatingForUserId] = useState('');
  const [deletingUserId, setDeletingUserId] = useState('');
  const [latestGeneratedLink, setLatestGeneratedLink] = useState(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const hasLoadedRef = useRef(false);
  const isMountedRef = useRef(false);
  const latestRequestIdRef = useRef(0);
  const copyTimeoutRef = useRef(null);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      latestRequestIdRef.current += 1;
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const loadUsers = useCallback(async ({ showRefreshingIndicator = false } = {}) => {
    const requestId = latestRequestIdRef.current + 1;
    latestRequestIdRef.current = requestId;

    if (!hasLoadedRef.current) {
      setLoading(true);
    } else if (showRefreshingIndicator) {
      setRefreshing(true);
    }

    try {
      const response = await fetchAdminUsers();
      if (!isMountedRef.current || latestRequestIdRef.current !== requestId) {
        return;
      }

      hasLoadedRef.current = true;
      setUsers(Array.isArray(response.users) ? response.users : []);
      setSummary(response.summary || { totalUsers: 0, onlineUsers: 0, activeUsers: 0, onlineWindowMinutes: 5 });
      setError('');
    } catch (requestError) {
      if (isMountedRef.current && latestRequestIdRef.current === requestId) {
        setError(requestError.message || t('genericError'));
      }
    } finally {
      if (isMountedRef.current && latestRequestIdRef.current === requestId) {
        setLoading(false);
      }

      if (isMountedRef.current && showRefreshingIndicator) {
        setRefreshing(false);
      }
    }
  }, [t]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'hidden') {
        return;
      }

      loadUsers();
    }, REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadUsers]);

  const managedUsers = useMemo(() => users.filter((user) => !user.isAdmin), [users]);
  const activeTheme = useMemo(() => {
    const themeMode = String(currentUser?.settings?.themeMode || '').trim();
    if (themeMode === 'dark' || themeMode === 'light') {
      return themeMode;
    }

    const appliedTheme = String(document.documentElement?.dataset?.theme || '').trim();
    return appliedTheme === 'dark' ? 'dark' : 'light';
  }, [currentUser?.settings?.themeMode]);
  const nextThemeMode = activeTheme === 'dark' ? 'light' : 'dark';
  const summaryCards = useMemo(() => ([
    {
      key: 'online',
      label: t('adminOnlineUsers'),
      value: summary.onlineUsers,
      icon: UserCheck,
      accent: 'bg-emerald-100 text-emerald-700',
    },
    {
      key: 'active',
      label: t('adminTrackedUsers'),
      value: summary.activeUsers,
      icon: Activity,
      accent: 'bg-amber-100 text-amber-700',
    },
    {
      key: 'total',
      label: t('adminTotalUsers'),
      value: summary.totalUsers,
      icon: Users,
      accent: 'bg-sky-100 text-sky-700',
    },
    {
      key: 'anonymous-api',
      label: t('adminAnonymousApiRequests'),
      value: summary.anonymousPublicApiRequests || 0,
      icon: Globe,
      accent: 'bg-violet-100 text-violet-700',
    },
  ]), [summary.activeUsers, summary.anonymousPublicApiRequests, summary.onlineUsers, summary.totalUsers, t]);

  const handleCreateLink = async (user) => {
    setCreatingForUserId(user.id);
    setError('');

    try {
      const response = await createAdminPasswordSetupLink(user.id);
      if (!isMountedRef.current) {
        return;
      }

      setLatestGeneratedLink({
        userId: user.id,
        username: user.username,
        setupLink: response.setupLink,
        expiresAt: response.expiresAt,
      });
      setCopiedLink(false);
      await loadUsers();
    } catch (requestError) {
      if (isMountedRef.current) {
        setError(requestError.message || t('genericError'));
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

    await navigator.clipboard.writeText(latestGeneratedLink.setupLink);
    setCopiedLink(true);
    if (copyTimeoutRef.current) {
      window.clearTimeout(copyTimeoutRef.current);
    }
    copyTimeoutRef.current = window.setTimeout(() => {
      setCopiedLink(false);
      copyTimeoutRef.current = null;
    }, 1500);
  };

  const handleDeleteUser = async (user) => {
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

      setLatestGeneratedLink((current) => (current?.userId === user.id ? null : current));
      await loadUsers();
    } catch (requestError) {
      if (isMountedRef.current) {
        setError(requestError.message || t('genericError'));
      }
    } finally {
      if (isMountedRef.current) {
        setDeletingUserId('');
      }
    }
  };

  const handleToggleTheme = async () => {
    setThemeSaving(true);
    setError('');

    try {
      const response = await updateUserSettings({ themeMode: nextThemeMode });
      if (isMountedRef.current) {
        onUserUpdate?.(response.settings);
      }
    } catch (requestError) {
      if (isMountedRef.current) {
        setError(requestError.message || t('genericError'));
      }
    } finally {
      if (isMountedRef.current) {
        setThemeSaving(false);
      }
    }
  };

  const ThemeIcon = activeTheme === 'dark' ? Sun : Moon;

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="flex min-h-screen w-full flex-col bg-white">
        <header className="border-b border-slate-200 px-5 py-4 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <BrandMark className="h-11 w-11" />
              <div>
                <h1 className="text-lg font-semibold text-slate-900">{t('adminDashboardTitle')}</h1>
                <p className="text-sm text-slate-500">{currentUser?.user?.username}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleToggleTheme}
                disabled={themeSaving}
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                aria-label={activeTheme === 'dark' ? t('switchToLightTheme') : t('switchToDarkTheme')}
                title={activeTheme === 'dark' ? t('switchToLightTheme') : t('switchToDarkTheme')}
              >
                <ThemeIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => loadUsers({ showRefreshingIndicator: true })}
                disabled={refreshing || themeSaving}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshing ? t('refreshing') : t('refresh')}
              </button>
              <button
                type="button"
                onClick={onLogout}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-700"
              >
                <LogOut className="h-4 w-4" />
                {t('logout')}
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 px-5 py-5 sm:px-8 sm:py-6">
          <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            {summaryCards.map((card) => {
              const Icon = card.icon;

              return (
                <div key={card.key} className="rounded-[1.2rem] border border-slate-200 bg-slate-50 px-3.5 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{card.label}</p>
                      <p className="mt-1.5 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{card.value}</p>
                    </div>
                    <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.9rem] ${card.accent} sm:h-9 sm:w-9`}>
                      <Icon className="h-4 w-4" />
                    </span>
                  </div>
                </div>
              );
            })}
          </section>

          <section className="mt-6">
            <div className="flex items-center gap-4">
              <h2 className="text-lg font-semibold text-slate-900">{t('adminUsersTitle')}</h2>
              <div className="h-px flex-1 bg-slate-200" aria-hidden="true" />
            </div>

            <div className="mt-5">
              {loading ? (
                <div className="text-sm text-slate-500">{t('loadingMore')}</div>
              ) : managedUsers.length === 0 ? (
                <div className="text-sm text-slate-500">{t('adminNoUsers')}</div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {managedUsers.map((user) => (
                    <article key={user.id} className="flex h-full flex-col overflow-hidden rounded-[1.6rem] border border-slate-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-xl">
                      <div className={`h-1 w-full ${user.isOnline ? 'bg-emerald-400/80' : 'bg-slate-300'}`} aria-hidden="true" />
                      <div className="flex min-w-0 flex-1 flex-col p-5">
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-3">
                            <span
                              className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${user.isOnline ? 'bg-emerald-500' : 'bg-slate-300'}`}
                              aria-label={user.isOnline ? t('onlineNow') : t('offlineNow')}
                            />
                            <p className="truncate text-lg font-semibold text-slate-900">{user.username}</p>
                          </div>

                          <div className="mt-4 grid grid-cols-3 gap-2.5 text-sm text-slate-600">
                            <div className="h-full min-w-0 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{t('createdAt')}</p>
                              <p className="mt-2 font-medium text-slate-800">{formatDateTime(user.createdAt)}</p>
                            </div>
                            <div className="h-full min-w-0 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{t('lastLoginAt')}</p>
                              <p className="mt-2 font-medium text-slate-800">{formatDateTime(user.lastLoginAt)}</p>
                            </div>
                            <div className="h-full min-w-0 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{t('lastActivityAt')}</p>
                              <p className="mt-2 font-medium text-slate-800">{formatDateTime(user.lastActivityAt)}</p>
                            </div>
                          </div>

                          <div className="mt-3 flex flex-wrap gap-2">
                            <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
                              {t('adminPublicApiRequestsValue', { count: user.publicApiRequestCount || 0 })}
                            </span>
                            <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
                              {t('adminPublicApiLastUsedValue', {
                                time: user.publicApiLastUsedAt ? formatDateTime(user.publicApiLastUsedAt) : t('adminPublicApiNeverUsed')
                              })}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-auto border-t border-slate-100 bg-slate-50/70 px-5 py-4">
                        <div className="grid grid-cols-2 gap-2.5">
                          <button
                            type="button"
                            onClick={() => handleCreateLink(user)}
                            disabled={creatingForUserId === user.id || deletingUserId === user.id}
                            className="inline-flex min-w-0 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <span>{creatingForUserId === user.id ? t('saving') : t('adminResetPasswordAction')}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteUser(user)}
                            disabled={deletingUserId === user.id || creatingForUserId === user.id}
                            className="inline-flex min-w-0 items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <Trash2 className="h-4 w-4" />
                            <span>{deletingUserId === user.id ? t('deleting') : t('adminDeleteUserAction')}</span>
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>

          {latestGeneratedLink ? (
            <section className="mt-4 rounded-[1.5rem] border border-emerald-200 bg-emerald-50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-emerald-900">{t('adminSetupLinkReadyFor', { username: latestGeneratedLink.username })}</p>
                  <p className="mt-2 break-all text-xs leading-6 text-emerald-800">{latestGeneratedLink.setupLink}</p>
                  <p className="mt-2 text-xs text-emerald-700">{t('expiresAtLabel', { time: new Date(latestGeneratedLink.expiresAt).toLocaleString() })}</p>
                </div>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  disabled={!navigator.clipboard?.writeText}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 py-2.5 text-sm font-medium text-emerald-800 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Copy className="h-4 w-4" />
                  {copiedLink ? t('copied') : t('copyLink')}
                </button>
              </div>
            </section>
          ) : null}

          {error ? (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
};

export default AdminDashboard;
