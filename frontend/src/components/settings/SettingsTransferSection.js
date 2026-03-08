import React from 'react';

const SettingsTransferSection = ({ t, saving, importInputRef, onExport, onImportClick, onImport }) => {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onExport}
          disabled={saving}
          className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
        >
          {t('exportSettings')}
        </button>
        <button
          type="button"
          onClick={onImportClick}
          disabled={saving}
          className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
        >
          {t('importSettings')}
        </button>
        <input
          ref={importInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={onImport}
        />
      </div>
      <p className="text-sm text-slate-500">{t('importSettingsHelp')}</p>
    </section>
  );
};

export default SettingsTransferSection;
