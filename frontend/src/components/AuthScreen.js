import React, { useState } from 'react';
import { KeyRound, LogIn, UserPlus } from 'lucide-react';
import BrandMark from './BrandMark';

const AuthScreen = ({ t, onLogin, onRegister, busy, error }) => {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (mode === 'login') {
      await onLogin({ username, password });
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

        <div className="mb-6 grid grid-cols-2 rounded-2xl bg-slate-100 p-1 text-sm font-medium">
          <button
            type="button"
            onClick={() => setMode('login')}
            className={`rounded-2xl px-4 py-2.5 transition-colors ${mode === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
          >
            {t('signIn')}
          </button>
          <button
            type="button"
            onClick={() => setMode('register')}
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
              onChange={(event) => setUsername(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition-colors focus:border-slate-400"
              required
              minLength={3}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">{t('passwordOptional')}</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition-colors focus:border-slate-400"
            />
          </label>

          <p className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">{t('passwordHelp')}</p>

          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error.message}
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
        </form>

        <div className="mt-6 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
          <KeyRound className="h-4 w-4 shrink-0 text-slate-400" />
          <span>{t('authTitle')}</span>
        </div>
      </div>
    </div>
  );
};

export default AuthScreen;
