import React from 'react';
import { Github, Sparkles, X } from 'lucide-react';
import { PROJECT_GITHUB_URL } from '../config/projectLinks';
import useLockBodyScroll from '../hooks/useLockBodyScroll';

const ReleaseNotesModal = ({ t, releaseNotes, saving, onDismiss }) => {
  useLockBodyScroll();

  return (
    <div className="fixed inset-0 z-[60] flex items-stretch justify-center overflow-y-auto bg-slate-950/45 px-0 py-0 backdrop-blur-sm sm:items-center sm:px-4 sm:py-6">
      <div className="flex min-h-full w-full max-w-xl flex-col overflow-hidden bg-white shadow-2xl sm:min-h-0 sm:max-h-[calc(100dvh-3rem)] sm:rounded-[2rem] sm:border sm:border-slate-200">
        <div className="flex shrink-0 items-start justify-between border-b border-slate-200 px-6 py-5">
          <div>
            <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              <Sparkles className="h-4 w-4" />
              {releaseNotes.eyebrow}
            </p>
            <h2 className="mt-2 text-xl font-semibold text-slate-900">{releaseNotes.title}</h2>
            <p className="mt-2 text-sm text-slate-500">{releaseNotes.intro}</p>
          </div>

          <button
            type="button"
            onClick={onDismiss}
            disabled={saving}
            className="shrink-0 rounded-full p-2 text-slate-500 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            aria-label={t('releaseNotesDismiss')}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-6">
          <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
            {t('changelogVersionLabel', { version: releaseNotes.version })}
          </span>

          <ul className="space-y-3 text-sm text-slate-700">
            {releaseNotes.items.map((item) => (
              <li key={item} className="rounded-2xl bg-slate-50 px-4 py-3">
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-slate-200 px-6 py-5">
          <a
            href={PROJECT_GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub"
            className="inline-flex items-center justify-center rounded-full p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <Github className="h-5 w-5" />
          </a>
          <button
            type="button"
            onClick={onDismiss}
            disabled={saving}
            className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? t('saving') : t('releaseNotesDismiss')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReleaseNotesModal;
