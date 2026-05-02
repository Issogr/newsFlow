import React, { useMemo, useState } from 'react';
import { Fingerprint, X } from 'lucide-react';
import useLockBodyScroll from '../hooks/useLockBodyScroll';

function getFriendlyMergeError(error, t) {
  const apiCode = error?.response?.data?.error?.code;
  const apiMessage = error?.response?.data?.error?.message;
  const status = error?.response?.status;

  if (error?.code === 'ECONNABORTED') {
    return t('authErrorTimeout');
  }

  if (!error?.response) {
    return t('authErrorNetwork');
  }

  if (apiCode === 'UNAUTHORIZED' || status === 401 || apiMessage === 'Invalid username or password') {
    return t('authErrorInvalidCredentials');
  }

  if (apiCode === 'CLERK_ACCOUNT_ALREADY_LINKED' || status === 409) {
    return apiMessage || t('authErrorGeneric');
  }

  if (status === 429) {
    return t('authErrorRateLimit');
  }

  if (status === 503) {
    return t('authErrorUnavailable');
  }

  if (status === 500) {
    return t('authErrorServer');
  }

  return apiMessage || error?.message || t('authErrorGeneric');
}

const ClerkMergePromptModal = ({ t, busy, onSubmit, onDismiss }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const friendlyError = useMemo(() => (error ? getFriendlyMergeError(error, t) : ''), [error, t]);

  useLockBodyScroll();

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);

    try {
      await onSubmit({ username, password });
    } catch (submitError) {
      setError(submitError);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-stretch justify-center overflow-y-auto bg-slate-950/45 px-0 py-0 backdrop-blur-sm sm:items-center sm:px-4 sm:py-6">
      <div className="flex min-h-full w-full max-w-lg flex-col overflow-hidden bg-white shadow-2xl sm:min-h-0 sm:rounded-[2rem] sm:border sm:border-slate-200">
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-5">
          <div>
            <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-violet-500">
              <Fingerprint className="h-4 w-4" />
              Clerk
            </p>
            <h2 className="mt-2 text-xl font-semibold text-slate-900">{t('clerkMergeTitle')}</h2>
            <p className="mt-2 text-sm text-slate-500">{t('clerkMergeHelp')}</p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            disabled={busy}
            className="rounded-full p-2 text-slate-500 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            aria-label={t('close')}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-6">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">{t('username')}</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition-colors focus:border-slate-400"
              required
              minLength={3}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">{t('password')}</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition-colors focus:border-slate-400"
              required
            />
          </label>

          {friendlyError ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {friendlyError}
            </div>
          ) : null}

          <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onDismiss}
              disabled={busy}
              className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t('clerkMergeSkip')}
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? t('saving') : t('clerkMergeAction')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ClerkMergePromptModal;
