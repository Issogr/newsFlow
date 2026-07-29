import { useRef } from 'react';
import { Pencil, Plus, Rss, Trash2 } from 'lucide-react';
import InlineAlert from '../InlineAlert';
import SettingsSectionCard from './SettingsSectionCard';
import SourceIcon from '../SourceIcon';
import { getFriendlyApiErrorMessage } from '../../utils/apiError';

const fieldClassName = 'w-full rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-3 text-slate-800 outline-none transition-[border-color,background-color,box-shadow] placeholder:text-slate-400 focus:border-sky-300 focus:bg-white focus:ring-2 focus:ring-sky-100';
const sourceLanguages = [
  ['it', 'languageItalian'],
  ['en', 'languageEnglish'],
  ['fr', 'languageFrench'],
  ['es', 'languageSpanish'],
  ['de', 'languageGerman']
];

const SettingsCustomSourcesSection = ({
  t,
  saving,
  sourceError,
  customSources,
  maxSourceCount,
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
  const addSourceDetailsRef = useRef(null);
  const sourceLimitReached = Number.isFinite(maxSourceCount) && customSources.length >= maxSourceCount;
  const closeAddSourceForm = () => {
    if (addSourceDetailsRef.current) {
      addSourceDetailsRef.current.open = false;
      addSourceDetailsRef.current.querySelector('summary')?.focus();
    }
  };
  const cancelAddSourceForm = () => {
    onSourceFormChange({ url: '' });
    closeAddSourceForm();
  };
  const handleAddSource = async (event) => {
    if (await onAddSource(event)) {
      closeAddSourceForm();
    }
  };

  return (
    <SettingsSectionCard
      icon={Rss}
      title={t('customSources')}
      badge={t('sourceCount', { count: customSources.length })}
      iconToneClassName="text-emerald-600"
    >
      <div>
        <details ref={addSourceDetailsRef} className="group">
          <summary
            aria-disabled={saving || sourceLimitReached}
            onClick={(event) => {
              if (saving || sourceLimitReached) {
                event.preventDefault();
              }
            }}
            className="inline-flex cursor-pointer list-none items-center justify-center gap-2 rounded-[1.25rem] bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-700 aria-disabled:cursor-not-allowed aria-disabled:opacity-60 [&::-webkit-details-marker]:hidden"
          >
            <Plus className="h-4 w-4" />
            {t('addSource')}
          </summary>

          <form onSubmit={handleAddSource} className="mt-4 space-y-3">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">{t('rssUrl')}</span>
              <input
                type="url"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                placeholder="https://example.com/feed.xml"
                value={sourceForm.url}
                onChange={(event) => onSourceFormChange({ url: event.target.value })}
                disabled={saving}
                className={fieldClassName}
                required
              />
            </label>
            <p className="text-sm text-slate-500">{t('addSourceHelp')}</p>
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60">
                {saving ? t('saveSourceDetecting') : t('saveSource')}
              </button>
              <button type="button" onClick={cancelAddSourceForm} disabled={saving} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60">
                {t('cancel')}
              </button>
            </div>
          </form>
        </details>
        {Number.isFinite(maxSourceCount) && (
          <p className="mt-2 text-xs text-slate-500">{t('customSourceLimit', { count: maxSourceCount })}</p>
        )}
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
                      <label className="block">
                        <span className="mb-2 block text-sm font-medium text-slate-700">{t('sourceName')}</span>
                        <input
                          value={editingSourceForm.name}
                          onChange={(event) => onEditingSourceFormChange((current) => ({ ...current, name: event.target.value }))}
                          disabled={saving}
                          className={fieldClassName}
                        />
                      </label>
                      <label className="block">
                        <span className="mb-2 block text-sm font-medium text-slate-700">{t('language')}</span>
                        <select
                          value={editingSourceForm.language}
                          onChange={(event) => onEditingSourceFormChange((current) => ({ ...current, language: event.target.value }))}
                          disabled={saving}
                          className={fieldClassName}
                        >
                          {sourceLanguages.map(([value, labelKey]) => (
                            <option key={value} value={value}>{t(labelKey)}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-slate-700">{t('rssUrl')}</span>
                      <input
                        type="url"
                        inputMode="url"
                        value={editingSourceForm.url}
                        onChange={(event) => onEditingSourceFormChange((current) => ({ ...current, url: event.target.value }))}
                        disabled={saving}
                        className={fieldClassName}
                      />
                    </label>
                    <div className="flex flex-wrap items-center gap-3">
                      <button type="button" onClick={() => onUpdateSource(source.id)} disabled={saving} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60">
                        {saving ? t('saveSourceDetecting') : t('saveSource')}
                      </button>
                      <button type="button" onClick={onCancelEditSource} disabled={saving} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60">
                        {t('cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <SourceIcon source={source} className="mt-0.5 h-8 w-8" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-slate-800">{source.name}</p>
                          {source.language ? (
                            <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-500">
                              {t(sourceLanguages.find(([value]) => value === source.language)?.[1] || source.language)}
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
                        disabled={saving}
                        className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-slate-50 p-2 text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                        aria-label={t('editSource')}
                        title={t('editSource')}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteSource(source.id)}
                        disabled={saving}
                        className="inline-flex items-center justify-center rounded-xl border border-red-200 bg-red-50 p-2 text-red-700 hover:bg-red-100 disabled:opacity-60"
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
