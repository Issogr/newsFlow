import React, { useState } from 'react';
import { ExternalLink, LogIn, UserPlus } from 'lucide-react';
import BrandMark from './BrandMark';

const MIN_PASSWORD_LENGTH = 8;

const AuthScreen = ({ t, onLogin, onRegister, onClerkLogin, clerkAvailable = false, busy, error }) => {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [clientError, setClientError] = useState('');

  const getFriendlyError = () => {
    if (clientError) {
      return clientError;
    }

    if (!error) {
      return '';
    }

    const apiCode = error.response?.data?.error?.code;
    const apiMessage = error.response?.data?.error?.message;
    const status = error.response?.status;

    if (error.code === 'ECONNABORTED') {
      return t('authErrorTimeout');
    }

    if (!error.response) {
      return t('authErrorNetwork');
    }

    if (apiCode === 'USER_ALREADY_EXISTS' || status === 409 || apiMessage === 'Username already exists') {
      return t('authErrorUsernameTaken');
    }

    if (apiMessage === 'Password is required') {
      return t('authErrorPasswordRequired');
    }

    if (apiMessage === `Password must contain at least ${MIN_PASSWORD_LENGTH} characters`) {
      return t('authErrorPasswordMinLength', { count: MIN_PASSWORD_LENGTH });
    }

    if (apiCode === 'INVALID_PASSWORD') {
      return apiMessage || t('authErrorPasswordRequired');
    }

    if (apiCode === 'INVALID_USERNAME' || apiMessage === 'Username must contain at least 3 characters') {
      return t('authErrorInvalidUsername');
    }

    if (apiCode === 'UNAUTHORIZED' || status === 401 || apiMessage === 'Invalid username or password') {
      return t('authErrorInvalidCredentials');
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

    return apiMessage || t('authErrorGeneric');
  };

  const rawErrorMessage = clientError ? '' : (error?.message || '');
  const friendlyError = getFriendlyError();

  const handleSubmit = async (event) => {
    event.preventDefault();
    setClientError('');

    if (mode === 'login') {
      await onLogin({ username, password });
      return;
    }

    if (!password) {
      setClientError(t('authErrorPasswordRequired'));
      return;
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      setClientError(t('authErrorPasswordMinLength', { count: MIN_PASSWORD_LENGTH }));
      return;
    }

    await onRegister({ username, password });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10 text-slate-900">
      <div className="w-full max-w-md rounded-[2rem] border border-slate-200 bg-white p-8 shadow-xl">
        <div className="mb-6 flex items-center gap-3">
          <BrandMark className="h-12 w-12" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">News Flow</h1>
            <p className="text-sm text-slate-500">{t('authSubtitle')}</p>
          </div>
        </div>

        {clerkAvailable ? (
          <div className="mb-5 space-y-3">
            <button
              type="button"
              onClick={onClerkLogin}
              disabled={busy}
              className="inline-flex w-full items-center justify-center gap-3 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <svg className="h-4 w-4 shrink-0" viewBox="0 0 18 18" aria-hidden="true">
                <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.56 2.68-3.86 2.68-6.62Z" />
                <path fill="#34A853" d="M9 18c2.43 0 4.46-.8 5.95-2.18l-2.92-2.26c-.81.54-1.84.86-3.03.86-2.33 0-4.31-1.57-5.02-3.68H.96V13c1.48 2.94 4.52 5 8.04 5Z" />
                <path fill="#FBBC05" d="M3.98 10.74A5.4 5.4 0 0 1 3.7 9c0-.6.1-1.18.28-1.74V5H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4l3.02-2.26Z" />
                <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.33l2.58-2.58C13.45.9 11.42 0 9 0 5.48 0 2.44 2.06.96 5l3.02 2.26C4.69 5.15 6.67 3.58 9 3.58Z" />
              </svg>
              {t('googleLoginAction')}
            </button>
            <div className="flex items-center gap-3 text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
              <span className="h-px flex-1 bg-slate-200" />
              <span>{t('authOrLocal')}</span>
              <span className="h-px flex-1 bg-slate-200" />
            </div>
          </div>
        ) : null}

        <div className="mb-6 grid grid-cols-2 rounded-2xl bg-slate-100 p-1 text-sm font-medium">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setClientError('');
            }}
            className={`rounded-2xl px-4 py-2.5 transition-colors ${mode === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
          >
            {t('signIn')}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('register');
              setClientError('');
            }}
            className={`rounded-2xl px-4 py-2.5 transition-colors ${mode === 'register' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
          >
            {t('createAccount')}
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">{t('username')}</span>
            <input
              value={username}
              onChange={(event) => {
                setUsername(event.target.value);
                setClientError('');
              }}
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
              onChange={(event) => {
                setPassword(event.target.value);
                setClientError('');
              }}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition-colors focus:border-slate-400"
              required={mode === 'register'}
              minLength={mode === 'register' ? MIN_PASSWORD_LENGTH : undefined}
            />
          </label>

          {mode === 'register' && (
            <p className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">{t('passwordHelp')}</p>
          )}

          {(clientError || error) && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <p className="font-medium">{friendlyError}</p>
              {rawErrorMessage && rawErrorMessage !== friendlyError && (
                <p className="mt-1 text-xs text-red-600">{rawErrorMessage}</p>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {mode === 'login' ? <LogIn className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
            {mode === 'login' ? t('loginAction') : t('registerAction')}
          </button>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-6 text-slate-500">
            <p>{t('technicalCookieNotice')}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href="/privacy-policy"
                className="inline-flex w-fit items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100"
              >
                <span>{t('privacyPolicyLink')}</span>
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
              <a
                href="/cookie-policy"
                className="inline-flex w-fit items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100"
              >
                <span>{t('cookiePolicyLink')}</span>
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AuthScreen;
