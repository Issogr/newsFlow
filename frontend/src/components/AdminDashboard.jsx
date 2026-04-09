import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, KeyRound, LogOut, RefreshCw, ShieldCheck, UserCheck, Users } from 'lucide-react';
import BrandMark from './BrandMark';
import { createAdminPasswordSetupLink, fetchAdminUsers } from '../services/api';

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

const AdminDashboard = ({ t, currentUser, onLogout }) => {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [users, setUsers] = useState([]);
  const [summary, setSummary] = useState({ totalUsers: 0, onlineUsers: 0, activeUsers: 0, onlineWindowMinutes: 5 });
  const [creatingForUserId, setCreatingForUserId] = useState('');
  const [generatedLinks, setGeneratedLinks] = useState({});
  const [copiedUserId, setCopiedUserId] = useState('');
  const hasLoadedRef = useRef(false);
  const latestRequestIdRef = useRef(0);

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
      if (latestRequestIdRef.current !== requestId) {
        return;
      }

      hasLoadedRef.current = true;
      setUsers(Array.isArray(response.users) ? response.users : []);
      setSummary(response.summary || { totalUsers: 0, onlineUsers: 0, activeUsers: 0, onlineWindowMinutes: 5 });
      setError('');
    } catch (requestError) {
      if (latestRequestIdRef.current === requestId) {
        setError(requestError.message || t('genericError'));
      }
    } finally {
      if (latestRequestIdRef.current === requestId) {
        setLoading(false);
      }

      if (showRefreshingIndicator) {
        setRefreshing(false);
      }
    }
  }, [t]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      loadUsers();
    }, REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadUsers]);

  const managedUsers = useMemo(() => users.filter((user) => !user.isAdmin), [users]);

  const handleCreateLink = async (userId) => {
    setCreatingForUserId(userId);
    setError('');

    try {
      const response = await createAdminPasswordSetupLink(userId);
      setGeneratedLinks((current) => ({
        ...current,
        [userId]: {
          setupLink: response.setupLink,
          expiresAt: response.expiresAt
        }
      }));
      await loadUsers();
    } catch (requestError) {
      setError(requestError.message || t('genericError'));
    } finally {
      setCreatingForUserId('');
    }
  };

  const handleCopyLink = async (userId) => {
    const link = generatedLinks[userId]?.setupLink;
    if (!link || !navigator.clipboard?.writeText) {
      return;
    }

    await navigator.clipboard.writeText(link);
    setCopiedUserId(userId);
    window.setTimeout(() => {
      setCopiedUserId((current) => (current === userId ? '' : current));
    }, 1500);
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#f8fafc,_#e2e8f0_55%,_#cbd5e1)] px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-6xl flex-col overflow-hidden rounded-[2rem] border border-slate-200 bg-white/95 shadow-2xl backdrop-blur">
        <header className="border-b border-slate-200 bg-white/90 px-5 py-5 sm:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <BrandMark className="h-14 w-14" />
              <div>
                <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  <ShieldCheck className="h-4 w-4" />
                  {t('adminDashboard')}
                </p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{t('adminDashboardTitle')}</h1>
                <p className="mt-1 text-sm text-slate-500">{t('adminDashboardSubtitle')}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                <p className="font-medium text-slate-800">{currentUser?.user?.username}</p>
                <p>{t('adminOnlineWindow', { count: summary.onlineWindowMinutes || 5 })}</p>
              </div>
              <button
                type="button"
                onClick={() => loadUsers({ showRefreshingIndicator: true })}
                disabled={refreshing}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshing ? t('refreshing') : t('refresh')}
              </button>
              <button
                type="button"
                onClick={onLogout}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-slate-700"
              >
                <LogOut className="h-4 w-4" />
                {t('logout')}
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-5 py-5 sm:px-8 sm:py-6">
          <section className="grid gap-4 md:grid-cols-3">
            <div className="rounded-[1.75rem] border border-slate-200 bg-slate-50 p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{t('adminTotalUsers')}</p>
              <div className="mt-3 flex items-center gap-3">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">
                  <Users className="h-5 w-5" />
                </span>
                <p className="text-3xl font-semibold text-slate-900">{summary.totalUsers}</p>
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-slate-200 bg-slate-50 p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{t('adminOnlineUsers')}</p>
              <div className="mt-3 flex items-center gap-3">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                  <UserCheck className="h-5 w-5" />
                </span>
                <p className="text-3xl font-semibold text-slate-900">{summary.onlineUsers}</p>
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-slate-200 bg-slate-50 p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{t('adminTrackedUsers')}</p>
              <div className="mt-3 flex items-center gap-3">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
                  <ShieldCheck className="h-5 w-5" />
                </span>
                <p className="text-3xl font-semibold text-slate-900">{summary.activeUsers}</p>
              </div>
            </div>
          </section>

          <section className="mt-6 rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{t('adminUserResetSection')}</p>
                <h2 className="mt-2 text-lg font-semibold text-slate-900">{t('adminUserResetTitle')}</h2>
                <p className="mt-1 text-sm text-slate-500">{t('adminUserResetSubtitle')}</p>
              </div>
            </div>

            {loading ? (
              <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-500">{t('loadingMore')}</div>
            ) : managedUsers.length === 0 ? (
              <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-500">{t('adminNoUsers')}</div>
            ) : (
              <div className="mt-4 space-y-4">
                {managedUsers.map((user) => {
                  const generatedLink = generatedLinks[user.id];
                  return (
                    <article key={user.id} className="rounded-[1.5rem] border border-slate-200 bg-slate-50/70 p-5">
                      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-base font-semibold text-slate-900">{user.username}</p>
                            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${user.isOnline ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                              {user.isOnline ? t('onlineNow') : t('offlineNow')}
                            </span>
                            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${user.passwordConfigured ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-700'}`}>
                              {user.passwordConfigured ? t('passwordConfigured') : t('passwordMissing')}
                            </span>
                          </div>

                          <div className="mt-3 grid gap-3 text-sm text-slate-600 sm:grid-cols-3">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{t('createdAt')}</p>
                              <p className="mt-1">{formatDateTime(user.createdAt)}</p>
                            </div>
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{t('lastLoginAt')}</p>
                              <p className="mt-1">{formatDateTime(user.lastLoginAt)}</p>
                            </div>
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{t('lastActivityAt')}</p>
                              <p className="mt-1">{formatDateTime(user.lastActivityAt)}</p>
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleCreateLink(user.id)}
                          disabled={creatingForUserId === user.id}
                          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <KeyRound className="h-4 w-4" />
                          {creatingForUserId === user.id ? t('saving') : t('adminCreateSetupLink')}
                        </button>
                      </div>

                      {generatedLink && (
                        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-slate-800">{t('adminSetupLinkReady')}</p>
                              <p className="mt-1 break-all text-xs text-slate-500">{generatedLink.setupLink}</p>
                              <p className="mt-2 text-xs text-slate-500">{t('expiresAtLabel', { time: new Date(generatedLink.expiresAt).toLocaleString() })}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleCopyLink(user.id)}
                              disabled={!navigator.clipboard?.writeText}
                              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <Copy className="h-4 w-4" />
                              {copiedUserId === user.id ? t('copied') : t('copyLink')}
                            </button>
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}

            {error && (
              <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
};

export default AdminDashboard;
