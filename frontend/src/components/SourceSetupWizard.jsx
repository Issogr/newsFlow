import React, { useMemo, useState } from 'react';
import { Check, ChevronDown, Newspaper, RefreshCw } from 'lucide-react';
import useLockBodyScroll from '../hooks/useLockBodyScroll';
import { updateUserSettings } from '../services/api';

const hasSelectableSubSources = (source) => Array.isArray(source.subSources) && source.subSources.length > 1;

const getSourceInitial = (name = '') => String(name || '?').trim().charAt(0).toUpperCase() || '?';

const ProviderIcon = ({ source, sizeClassName = 'h-8 w-8' }) => {
  const [failed, setFailed] = useState(false);
  const iconUrl = source?.iconUrl || '';

  if (!iconUrl || failed) {
    return (
      <span className={`inline-flex shrink-0 items-center justify-center rounded-xl bg-slate-100 text-xs font-semibold text-slate-600 ${sizeClassName}`}>
        {getSourceInitial(source?.name)}
      </span>
    );
  }

  return (
    <span className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white ${sizeClassName}`}>
      <img
        src={iconUrl}
        alt=""
        className="h-5 w-5 object-contain"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </span>
  );
};

const getSelectableIds = (sources = []) => {
  return sources.flatMap((source) => (
    hasSelectableSubSources(source)
      ? source.subSources.map((subSource) => subSource.id)
      : [source.id]
  ));
};

const getInitialSelectedIds = (sources = [], currentSettings = {}) => {
  const excludedSourceIds = currentSettings.excludedSourceIds || [];
  const excludedSubSourceIds = currentSettings.excludedSubSourceIds || [];

  return sources.flatMap((source) => {
    if (excludedSourceIds.includes(source.id)) {
      return [];
    }

    if (hasSelectableSubSources(source)) {
      return source.subSources
        .map((subSource) => subSource.id)
        .filter((subSourceId) => !excludedSubSourceIds.includes(subSourceId));
    }

    return [source.id];
  });
};

const SourceSetupWizard = ({ t, sources = [], currentSettings = {}, onComplete }) => {
  const allSelectableIds = useMemo(() => getSelectableIds(sources), [sources]);
  const initialSelectedIds = useMemo(() => getInitialSelectedIds(sources, currentSettings), [currentSettings, sources]);

  const [selectedIds, setSelectedIds] = useState(initialSelectedIds);
  const [expandedSourceIds, setExpandedSourceIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useLockBodyScroll();

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedCount = selectedIds.length;
  const allSelected = allSelectableIds.length > 0 && selectedCount === allSelectableIds.length;

  const toggleSelection = (selectionId) => {
    setSelectedIds((current) => (
      current.includes(selectionId)
        ? current.filter((id) => id !== selectionId)
        : [...current, selectionId]
    ));
  };

  const toggleSourceExpansion = (sourceId) => {
    setExpandedSourceIds((current) => (
      current.includes(sourceId)
        ? current.filter((id) => id !== sourceId)
        : [...current, sourceId]
    ));
  };

  const setSourceSelection = (source, selected) => {
    const sourceSelectionIds = hasSelectableSubSources(source)
      ? source.subSources.map((subSource) => subSource.id)
      : [source.id];
    const sourceSelectionIdSet = new Set(sourceSelectionIds);

    setSelectedIds((current) => {
      const withoutSource = current.filter((id) => !sourceSelectionIdSet.has(id));
      return selected ? [...withoutSource, ...sourceSelectionIds] : withoutSource;
    });
  };

  const handleSelectAll = () => {
    setSelectedIds(allSelectableIds);
  };

  const handleClear = () => {
    setSelectedIds([]);
  };

  const handleSave = async () => {
    if (selectedCount === 0) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const selectedIdValues = new Set(selectedIds);
      const excludedSourceIds = [];
      const excludedSubSourceIds = [];

      sources.forEach((source) => {
        if (hasSelectableSubSources(source)) {
          const selectedSubSourceIds = source.subSources
            .map((subSource) => subSource.id)
            .filter((subSourceId) => selectedIdValues.has(subSourceId));

          if (selectedSubSourceIds.length === 0) {
            excludedSourceIds.push(source.id);
            return;
          }

          source.subSources
            .map((subSource) => subSource.id)
            .filter((subSourceId) => !selectedIdValues.has(subSourceId))
            .forEach((subSourceId) => excludedSubSourceIds.push(subSourceId));
          return;
        }

        if (!selectedIdValues.has(source.id)) {
          excludedSourceIds.push(source.id);
        }
      });

      const response = await updateUserSettings({
        excludedSourceIds,
        excludedSubSourceIds,
        sourceSetupCompleted: true
      });
      onComplete(response.settings);
    } catch (requestError) {
      setError(requestError);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex bg-slate-950/45 backdrop-blur-sm sm:items-center sm:justify-center sm:px-4 sm:py-6">
      <div className="flex h-full w-full flex-col overflow-hidden bg-white shadow-2xl sm:max-h-full sm:max-w-2xl sm:rounded-[2rem] sm:border sm:border-slate-200">
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-5 sm:px-6">
          <div className="flex items-start gap-4">
            <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">
              <Newspaper className="h-6 w-6" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{t('sourceSetupEyebrow')}</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{t('sourceSetupTitle')}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{t('sourceSetupSubtitle')}</p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600">
              {t('sourceSetupSelectedCount', { count: selectedCount })}
            </span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={handleSelectAll} disabled={allSelected || saving} className="rounded-full px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50">
                {t('sourceSetupSelectAll')}
              </button>
              <button type="button" onClick={handleClear} disabled={selectedCount === 0 || saving} className="rounded-full px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50">
                {t('sourceSetupClear')}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {sources.map((source) => {
              if (hasSelectableSubSources(source)) {
                const sourceSelectionIds = source.subSources.map((subSource) => subSource.id);
                const selectedSubSourceCount = sourceSelectionIds.filter((subSourceId) => selectedIdSet.has(subSourceId)).length;
                const sourceFullySelected = selectedSubSourceCount === sourceSelectionIds.length;
                const expanded = expandedSourceIds.includes(source.id);

                return (
                  <div key={source.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3 px-1 pb-3">
                      <button
                        type="button"
                        onClick={() => toggleSourceExpansion(source.id)}
                        className="flex min-w-0 flex-1 items-start gap-2 rounded-xl text-left focus:outline-none focus:ring-2 focus:ring-sky-200"
                        aria-expanded={expanded}
                        aria-label={expanded ? t('sourceSetupCollapseSource', { name: source.name }) : t('sourceSetupExpandSource', { name: source.name })}
                      >
                        <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
                        <ProviderIcon source={source} />
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-slate-900">{source.name}</span>
                          <span className="mt-1 block text-xs text-slate-500">{t('sourceSetupSubSourceSelectedCount', { selected: selectedSubSourceCount, count: sourceSelectionIds.length })}</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setSourceSelection(source, !sourceFullySelected)}
                        className="rounded-full px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                      >
                        {sourceFullySelected ? t('sourceSetupClearSource') : t('sourceSetupSelectSource')}
                      </button>
                    </div>
                    {expanded ? (
                      <div className="space-y-2">
                        {source.subSources.map((subSource) => {
                          const selected = selectedIdSet.has(subSource.id);

                          return (
                            <button
                              key={subSource.id}
                              type="button"
                              onClick={() => toggleSelection(subSource.id)}
                              className={`flex w-full items-center justify-between gap-4 rounded-xl border px-3 py-2.5 text-left transition-colors ${selected ? 'border-sky-200 bg-sky-50 text-sky-950' : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'}`}
                            >
                              <span className="min-w-0">
                                <span className="flex min-w-0 items-center gap-2">
                                  <ProviderIcon source={{ ...source, iconUrl: subSource.iconUrl || source.iconUrl }} sizeClassName="h-7 w-7" />
                                  <span className="block truncate text-sm font-medium">{subSource.label || subSource.name}</span>
                                </span>
                                <span className="mt-0.5 block truncate text-xs text-slate-500">{source.name}</span>
                              </span>
                              <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${selected ? 'border-sky-600 bg-sky-600 text-white' : 'border-slate-300 bg-white text-transparent'}`}>
                                <Check className="h-4 w-4" aria-hidden="true" />
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              }

              const selected = selectedIdSet.has(source.id);
              return (
                <button
                  key={source.id}
                  type="button"
                  onClick={() => toggleSelection(source.id)}
                  className={`flex w-full items-center justify-between gap-4 rounded-2xl border px-4 py-3 text-left transition-colors ${selected ? 'border-sky-200 bg-sky-50 text-sky-950' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <ProviderIcon source={source} />
                    <span className="block truncate text-sm font-semibold">{source.name}</span>
                  </span>
                  <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${selected ? 'border-sky-600 bg-sky-600 text-white' : 'border-slate-300 bg-white text-transparent'}`}>
                    <Check className="h-4 w-4" aria-hidden="true" />
                  </span>
                </button>
              );
            })}
          </div>

          {selectedCount === 0 ? (
            <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {t('sourceSetupPickOne')}
            </p>
          ) : null}

          {error ? (
            <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error.message || t('genericError')}
            </p>
          ) : null}
        </div>

        <div className="border-t border-slate-200 px-5 py-5 sm:px-6">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || selectedCount === 0 || allSelectableIds.length === 0}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {saving ? t('saving') : t('sourceSetupContinue')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SourceSetupWizard;
