import { Pencil, Plus, Rss, Trash2 } from 'lucide-react';
import InlineAlert from '../InlineAlert';
import SettingsSectionCard from './SettingsSectionCard';
import SourceIcon from '../SourceIcon';
import { getFriendlyApiErrorMessage } from '../../utils/apiError';

const fieldClassName = 'w-full rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-3 text-slate-800 outline-none transition-[border-color,background-color,box-shadow] placeholder:text-slate-400 focus:border-sky-300 focus:bg-white focus:ring-2 focus:ring-sky-100';

const SettingsCustomSourcesSection = ({
  t,
  saving,
  sourceError,
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
    <SettingsSectionCard
      icon={Rss}
      title={t('customSources')}
      description={t('addSourceHelp')}
      badge={t('sourceCount', { count: customSources.length })}
      iconToneClassName="text-emerald-600"
    >
      <div>
        <form onSubmit={onAddSource} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <input
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            placeholder={t('rssUrl')}
            value={sourceForm.url}
            onChange={(event) => onSourceFormChange({ url: event.target.value })}
            className={fieldClassName}
            required
          />
          <button type="submit" disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-[1.25rem] bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60">
            <Plus className="h-4 w-4" />
            {saving ? t('saveSourceDetecting') : t('addSource')}
          </button>
        </form>
        <p className="mt-3 text-sm text-slate-500">{t('sourceAutoDetectedOnSave')}</p>
        {sourceError ? (
          <InlineAlert as="p" className="mt-3">
            {getFriendlyApiErrorMessage(sourceError, t)}
          </InlineAlert>
        ) : null}
      </div>

      <div className="border-t border-slate-200 pt-2">
        {customSources.length === 0 ? (
          <p className="py-4 text-sm text-slate-500">{t('noCustomSources')}</p>
        ) : (
          customSources.map((source) => {
            const isEditing = editingSourceId === source.id;

            return (
              <div key={source.id} className="border-b border-slate-200 py-4 last:border-b-0 last:pb-0">
                {isEditing ? (
                  <div className="space-y-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <input
                        value={editingSourceForm.name}
                        onChange={(event) => onEditingSourceFormChange((current) => ({ ...current, name: event.target.value }))}
                        className={fieldClassName}
                        placeholder={t('sourceName')}
                      />
                      <select
                        value={editingSourceForm.language}
                        onChange={(event) => onEditingSourceFormChange((current) => ({ ...current, language: event.target.value }))}
                        className={fieldClassName}
                      >
                        <option value="it">IT</option>
                        <option value="en">EN</option>
                        <option value="fr">FR</option>
                        <option value="es">ES</option>
                        <option value="de">DE</option>
                      </select>
                    </div>
                    <input
                      value={editingSourceForm.url}
                      onChange={(event) => onEditingSourceFormChange((current) => ({ ...current, url: event.target.value }))}
                      className={fieldClassName}
                      placeholder={t('rssUrl')}
                    />
                    <div className="flex flex-wrap items-center gap-3">
                      <button type="button" onClick={() => onUpdateSource(source.id)} disabled={saving} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60">
                        {saving ? t('saveSourceDetecting') : t('saveSource')}
                      </button>
                      <button type="button" onClick={onCancelEditSource} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
                        {t('cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <SourceIcon source={source} className="mt-0.5 h-8 w-8" imageClassName="h-5 w-5" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-slate-800">{source.name}</p>
                          {source.language ? (
                            <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                              {source.language}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 break-all text-sm text-slate-500">{source.url}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onStartEditSource(source)}
                        className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-slate-50 p-2 text-slate-700 hover:bg-slate-100"
                        aria-label={t('editSource')}
                        title={t('editSource')}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteSource(source.id)}
                        className="inline-flex items-center justify-center rounded-xl border border-red-200 bg-red-50 p-2 text-red-700 hover:bg-red-100"
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
    </SettingsSectionCard>
  );
};

export default SettingsCustomSourcesSection;
