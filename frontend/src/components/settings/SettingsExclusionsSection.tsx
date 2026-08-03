import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Check, ChevronDown, Pencil, Rss, Trash2 } from 'lucide-react';
import InlineAlert from '../InlineAlert';
import SettingsSectionCard from './SettingsSectionCard';
import SourceIcon from '../SourceIcon';
import { getFriendlyApiErrorMessage } from '../../utils/apiError';
import type { NewsSource, Translator, UserSettings } from '../../types';

const fieldClassName = 'w-full rounded-[1.25rem] border border-slate-200 bg-white px-4 py-3 text-slate-800 outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 focus:border-sky-300 focus:ring-2 focus:ring-sky-100';
const sourceLanguages = [
  ['it', 'languageItalian'],
  ['en', 'languageEnglish'],
  ['fr', 'languageFrench'],
  ['es', 'languageSpanish'],
  ['de', 'languageGerman']
];

const SettingsExclusionsSection = ({
  t,
  saving,
  settings,
  excludedSourceCatalog,
  customSources,
  pendingDeletedSourceIds,
  sourceError,
  editingSourceId,
  editingSourceForm,
  onEditingSourceFormChange,
  onToggleSource,
  onToggleSubFeed,
  onStartEditSource,
  onCancelEditSource,
  onDeleteSource
}: {
  t: Translator;
  saving: boolean;
  settings: UserSettings;
  excludedSourceCatalog: NewsSource[];
  customSources: NewsSource[];
  pendingDeletedSourceIds: string[];
  sourceError: unknown;
  editingSourceId: string;
  editingSourceForm: { name: string; url: string; language: string };
  onEditingSourceFormChange: Dispatch<SetStateAction<{ name: string; url: string; language: string }>>;
  onToggleSource: (sourceId: string) => void;
  onToggleSubFeed: (subSourceId: string) => void;
  onStartEditSource: (source: NewsSource) => void;
  onCancelEditSource: () => void;
  onDeleteSource: (sourceId: string) => void;
}) => {
  const [expandedSourceIds, setExpandedSourceIds] = useState<string[]>([]);
  const sourceButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const excludedSourceIds = settings.excludedSourceIds || [];
  const excludedSubSourceIds = settings.excludedSubSourceIds || [];
  const pendingDeletedSourceIdSet = new Set(pendingDeletedSourceIds);
  const visibleCustomSources = customSources.filter((source) => !pendingDeletedSourceIdSet.has(source.id));
  const visibleSourceCatalog = excludedSourceCatalog.flatMap((source) => {
    if (pendingDeletedSourceIdSet.has(source.id)) {
      return [];
    }

    const subSources = (source.subSources || []).filter((subSource) => !pendingDeletedSourceIdSet.has(subSource.id));
    return source.subSources?.length && subSources.length === 0 ? [] : [{ ...source, subSources }];
  });
  const customSourcesById = new Map(visibleCustomSources.map((source) => [source.id, source]));
  const representedCustomSourceIds = new Set(visibleSourceCatalog.flatMap((source) => [
    source.id,
    ...(source.subSources || []).map((subSource) => subSource.id)
  ]));
  const uniqueSourceCatalog = new Map<string, NewsSource>(visibleSourceCatalog.map((source) => [source.id, source]));
  visibleCustomSources.forEach((source) => {
    if (!representedCustomSourceIds.has(source.id) && !uniqueSourceCatalog.has(source.id)) {
      uniqueSourceCatalog.set(source.id, source);
    }
  });
  const isSourceShown = (source: NewsSource) => !excludedSourceIds.includes(source.id)
    && (!Array.isArray(source.subSources)
      || source.subSources.length === 0
      || source.subSources.some((subSource) => !excludedSubSourceIds.includes(subSource.id)));
  const sourceCatalog = [...uniqueSourceCatalog.values()].sort((left, right) => (
    Number(isSourceShown(right)) - Number(isSourceShown(left))
    || left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
  ));
  const shownSourcesCount = sourceCatalog.filter(isSourceShown).length;

  const toggleExpanded = (sourceId: string) => {
    setExpandedSourceIds((current) => current.includes(sourceId)
      ? current.filter((id) => id !== sourceId)
      : [...current, sourceId]);
  };

  const renderCustomSourceActions = (source: NewsSource) => editingSourceId === source.id ? null : (
    <>
      <button
        type="button"
        onClick={() => onStartEditSource(source)}
        disabled={saving}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label={t('editSource')}
        title={t('editSource')}
      >
        <Pencil className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => onDeleteSource(source.id)}
        disabled={saving}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-red-200 bg-red-50 text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label={t('remove')}
        title={t('remove')}
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </button>
    </>
  );

  return (
    <SettingsSectionCard
      icon={Rss}
      title={t('sourcesShown')}
      badge={t('sourcesShownCount', { shown: shownSourcesCount, count: sourceCatalog.length })}
      iconToneClassName="text-sky-600"
    >
      {sourceError ? (
        <InlineAlert as="p">
          {getFriendlyApiErrorMessage(sourceError, t)}
        </InlineAlert>
      ) : null}
      <div>
        {sourceCatalog.map((source) => {
          const isShown = isSourceShown(source);
          const subSources = [...(source.subSources || [])].sort((left, right) => (
            Number(!excludedSubSourceIds.includes(right.id)) - Number(!excludedSubSourceIds.includes(left.id))
            || String(left.label || left.name).localeCompare(String(right.label || right.name), undefined, { sensitivity: 'base' })
          ));
          const hasSubSources = subSources.length > 1;
          const isExpanded = isShown && expandedSourceIds.includes(source.id);
          const rowCustomSource = customSourcesById.get(source.id)
            || (subSources.length === 1 ? customSourcesById.get(subSources[0].id) : undefined);
          const editingSource = customSourcesById.get(editingSourceId);
          const containsEditingSource = Boolean(editingSource && (
            source.id === editingSource.id || subSources.some((subSource) => subSource.id === editingSource.id)
          ));

          return (
            <div key={source.id} className="py-1.5 first:pt-0 last:pb-0">
              <div className="flex items-center gap-2">
                <button
                  ref={(node) => {
                    if (node) {
                      sourceButtonRefs.current.set(source.id, node);
                    } else {
                      sourceButtonRefs.current.delete(source.id);
                    }
                  }}
                  type="button"
                  onClick={() => {
                    if (!saving) {
                      onToggleSource(source.id);
                    }
                  }}
                  aria-disabled={saving}
                  aria-pressed={isShown}
                  className={`flex min-w-0 flex-1 items-center gap-3 rounded-[1.25rem] border px-3 py-2.5 text-left transition-colors aria-disabled:cursor-not-allowed aria-disabled:opacity-60 ${isShown ? 'border-sky-200 bg-sky-50 text-sky-950' : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100'}`}
                >
                  <SourceIcon source={source} className="h-8 w-8" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{source.name}</span>
                  <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${isShown ? 'bg-sky-600 text-white' : 'bg-slate-200 text-transparent'}`} aria-hidden="true">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                </button>

                {hasSubSources ? (
                  <button
                    type="button"
                    onClick={() => toggleExpanded(source.id)}
                    disabled={saving || !isShown}
                    aria-expanded={isExpanded}
                    aria-label={t(isExpanded ? 'collapseSourceFeeds' : 'expandSourceFeeds', { name: source.name })}
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} aria-hidden="true" />
                  </button>
                ) : null}

                {rowCustomSource ? renderCustomSourceActions(rowCustomSource) : null}
              </div>

              {containsEditingSource ? (
                <div className="mt-3 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
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
                    <button type="button" onClick={onCancelEditSource} disabled={saving} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60">
                      {t('cancel')}
                    </button>
                  </div>
                </div>
              ) : null}

              {isExpanded ? (
                <div className="mt-3 grid gap-2 pl-3">
                  {subSources.map((subSource) => {
                    const isSubSourceShown = !excludedSubSourceIds.includes(subSource.id);
                    const subSourceName = subSource.label || subSource.name;
                    const visibleSubSourceCount = subSources.filter((item) => !excludedSubSourceIds.includes(item.id)).length;
                    const customSource = customSourcesById.get(subSource.id);

                    return (
                      <div key={subSource.id} className="flex min-w-0 items-center gap-2">
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => {
                            if (isSubSourceShown && visibleSubSourceCount === 1) {
                              sourceButtonRefs.current.get(source.id)?.focus();
                            }
                            onToggleSubFeed(subSource.id);
                          }}
                          aria-pressed={isSubSourceShown}
                          className={`inline-flex min-w-0 flex-1 items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors disabled:opacity-60 ${isSubSourceShown ? 'border-sky-200 bg-white text-sky-950' : 'border-slate-200 bg-slate-100 text-slate-500'}`}
                        >
                          <SourceIcon source={{ ...source, iconUrl: subSource.iconUrl || source.iconUrl }} className="h-6 w-6" />
                          <span className="min-w-0 flex-1 truncate text-left">{subSourceName}</span>
                          <Check className={`h-3.5 w-3.5 shrink-0 ${isSubSourceShown ? 'text-sky-600' : 'text-transparent'}`} aria-hidden="true" />
                        </button>
                        {customSource ? renderCustomSourceActions(customSource) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </SettingsSectionCard>
  );
};

export default SettingsExclusionsSection;
