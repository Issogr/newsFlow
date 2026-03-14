import React from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';

const SettingsCustomSourcesSection = ({
  t,
  saving,
  customSources,
  sourceForm,
  editingSourceId,
  editingSourceForm,
  onSourceFormChange,
  onEditingSourceFormChange,
  onAddSource,
  onStartEditSource,
  onCancelEditSource,
  onUpdateSource,
  onDeleteSource
}) => {
  return (
    <section className="space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">{t('customSources')}</h3>
      <p className="text-sm text-slate-500">{t('addSourceHelp')}</p>
      <form onSubmit={onAddSource} className="grid gap-3 md:grid-cols-[1fr_auto]">
        <input
          placeholder={t('rssUrl')}
          value={sourceForm.url}
          onChange={(event) => onSourceFormChange({ url: event.target.value })}
          className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
          required
        />
        <button type="submit" disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60">
          <Plus className="h-4 w-4" />
          {saving ? t('saveSourceDetecting') : t('addSource')}
        </button>
      </form>
      <p className="text-sm text-slate-500">{t('sourceAutoDetectedOnSave')}</p>

      <div className="space-y-3">
        {customSources.length === 0 ? (
          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">{t('noCustomSources')}</div>
        ) : (
          customSources.map((source) => {
            const isEditing = editingSourceId === source.id;

            return (
              <div key={source.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                {isEditing ? (
                  <div className="space-y-3">
                    <input
                      value={editingSourceForm.name}
                      onChange={(event) => onEditingSourceFormChange((current) => ({ ...current, name: event.target.value }))}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3"
                      placeholder={t('sourceName')}
                    />
                    <input
                      value={editingSourceForm.url}
                      onChange={(event) => onEditingSourceFormChange((current) => ({ ...current, url: event.target.value }))}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3"
                      placeholder={t('rssUrl')}
                    />
                    <div className="flex flex-wrap items-center gap-3">
                      <select
                        value={editingSourceForm.language}
                        onChange={(event) => onEditingSourceFormChange((current) => ({ ...current, language: event.target.value }))}
                        className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                      >
                        <option value="it">IT</option>
                        <option value="en">EN</option>
                        <option value="fr">FR</option>
                        <option value="es">ES</option>
                        <option value="de">DE</option>
                      </select>
                      <button type="button" onClick={() => onUpdateSource(source.id)} disabled={saving} className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60">
                        {saving ? t('saveSourceDetecting') : t('saveSource')}
                      </button>
                      <button type="button" onClick={onCancelEditSource} className="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
                        {t('cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-medium text-slate-800">{source.name}</p>
                      <p className="text-sm text-slate-500">{source.url}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onStartEditSource(source)}
                        className="inline-flex items-center justify-center rounded-full border border-slate-200 p-2 text-slate-700 hover:bg-slate-100"
                        aria-label={t('editSource')}
                        title={t('editSource')}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteSource(source.id)}
                        className="inline-flex items-center justify-center rounded-full border border-red-200 p-2 text-red-700 hover:bg-red-50"
                        aria-label={t('remove')}
                        title={t('remove')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};

export default SettingsCustomSourcesSection;
