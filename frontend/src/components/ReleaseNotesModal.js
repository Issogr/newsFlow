import React from 'react';
import { Sparkles, X } from 'lucide-react';

const ReleaseNotesModal = ({ t, releaseNotes, saving, onDismiss }) => {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-xl overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-5">
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
            className="rounded-full p-2 text-slate-500 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            aria-label={t('releaseNotesDismiss')}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-6">
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

        <div className="flex justify-end border-t border-slate-200 px-6 py-5">
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
