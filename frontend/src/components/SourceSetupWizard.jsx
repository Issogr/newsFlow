import React, { useMemo, useState } from 'react';
import { Check, ChevronDown, Newspaper, RefreshCw } from 'lucide-react';
import SourceIcon from './SourceIcon';
import useLockBodyScroll from '../hooks/useLockBodyScroll';
import { updateUserSettings } from '../services/api';

const hasSelectableSubSources = (source) => Array.isArray(source.subSources) && source.subSources.length > 1;

const getSelectableIds = (sources = []) => {
  return sources.flatMap((source) => (
    hasSelectableSubSources(source)
      ? source.subSources.map((subSource) => subSource.id)
      : [source.id]
  ));
};

const getInitialSelectedIds = (sources = [], currentSettings = {}) => {
  if (currentSettings.sourceSetupCompleted === false) {
    return [];
  }

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

const LANGUAGE_ORDER = ['it', 'en'];

function getLanguageSectionLabel(language, t) {
  switch (language) {
    case 'it':
      return t('sourceSetupLanguageItalian');
    case 'en':
      return t('sourceSetupLanguageEnglish');
    default:
      return t('sourceSetupLanguageOther');
  }
}

function groupSourcesByLanguage(sources = []) {
  const groups = sources.reduce((languageGroups, source) => {
    const language = String(source?.language || '').trim().toLowerCase() || 'other';
    const group = languageGroups.get(language) || [];
    group.push(source);
    languageGroups.set(language, group);
    return languageGroups;
  }, new Map());

  return [...groups.entries()].sort(([leftLanguage], [rightLanguage]) => {
    const leftIndex = LANGUAGE_ORDER.indexOf(leftLanguage);
    const rightIndex = LANGUAGE_ORDER.indexOf(rightLanguage);

    if (leftIndex !== -1 || rightIndex !== -1) {
      return (leftIndex === -1 ? LANGUAGE_ORDER.length : leftIndex) - (rightIndex === -1 ? LANGUAGE_ORDER.length : rightIndex);
    }

    return leftLanguage.localeCompare(rightLanguage);
  });
}

const SourceSetupWizard = ({ t, sources = [], currentSettings = {}, onComplete }) => {
  const allSelectableIds = useMemo(() => getSelectableIds(sources), [sources]);
  const initialSelectedIds = useMemo(() => getInitialSelectedIds(sources, currentSettings), [currentSettings, sources]);
  const sourceGroupsByLanguage = useMemo(() => groupSourcesByLanguage(sources), [sources]);
  const isExistingSourceReview = currentSettings.sourceSetupCompleted === false && (currentSettings.excludedSourceIds || []).length > 0;

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
              {isExistingSourceReview ? (
                <p className="mt-3 rounded-2xl border border-amber-300 bg-amber-100 px-4 py-3 text-sm font-medium leading-6 text-amber-950 shadow-sm">
                  {t('sourceSetupExistingUserNote')}
                </p>
              ) : null}
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

          <div className="space-y-5">
            {sourceGroupsByLanguage.map(([language, languageSources]) => (
              <section key={language} aria-labelledby={`source-language-${language}`}>
                <h3 id={`source-language-${language}`} className="mb-2 px-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  {getLanguageSectionLabel(language, t)}
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {languageSources.map((source) => {
              if (hasSelectableSubSources(source)) {
                const sourceSelectionIds = source.subSources.map((subSource) => subSource.id);
                const selectedSubSourceCount = sourceSelectionIds.filter((subSourceId) => selectedIdSet.has(subSourceId)).length;
                const sourceFullySelected = selectedSubSourceCount === sourceSelectionIds.length;
                const sourcePartiallySelected = selectedSubSourceCount > 0 && !sourceFullySelected;
                const expanded = expandedSourceIds.includes(source.id);

                return (
                  <div
                    key={source.id}
                    className={`relative rounded-3xl border p-3 shadow-sm transition-all ${
                      sourceFullySelected || sourcePartiallySelected
                        ? 'border-sky-200 bg-sky-50/80 shadow-sky-100'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-md'
                    }`}
                  >
                    <span className={`absolute right-3 top-3 inline-flex h-6 w-6 items-center justify-center rounded-full border text-white shadow-sm ${sourceFullySelected || sourcePartiallySelected ? 'border-sky-600 bg-sky-600' : 'border-slate-200 bg-white text-transparent'}`} aria-hidden="true">
                      <Check className="h-4 w-4" />
                    </span>
                    <div className="flex items-start gap-3 pr-8">
                      <button
                        type="button"
                        onClick={() => toggleSourceExpansion(source.id)}
                        className="flex min-w-0 flex-1 items-start gap-3 rounded-2xl text-left focus:outline-none focus:ring-2 focus:ring-sky-200"
                        aria-expanded={expanded}
                        aria-label={expanded ? t('sourceSetupCollapseSource', { name: source.name }) : t('sourceSetupExpandSource', { name: source.name })}
                      >
                        <SourceIcon source={source} className="h-10 w-10 rounded-2xl shadow-sm" imageClassName="h-5 w-5" />
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-slate-900">{source.name}</span>
                          <span className="mt-1 block text-xs text-slate-500">{t('sourceSetupSubSourceSelectedCount', { selected: selectedSubSourceCount, count: sourceSelectionIds.length })}</span>
                        </span>
                        <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSourceSelection(source, !sourceFullySelected)}
                      className={`mt-3 inline-flex rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${sourceFullySelected ? 'bg-white text-slate-600 hover:bg-slate-100' : 'bg-sky-100 text-sky-800 hover:bg-sky-200'}`}
                    >
                      {sourceFullySelected ? t('sourceSetupClearSource') : t('sourceSetupSelectSource')}
                    </button>
                    {expanded ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {source.subSources.map((subSource) => {
                          const selected = selectedIdSet.has(subSource.id);

                          return (
                            <button
                              key={subSource.id}
                              type="button"
                              onClick={() => toggleSelection(subSource.id)}
                              className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-2 text-left transition-colors ${selected ? 'border-sky-300 bg-white text-sky-950 shadow-sm' : 'border-slate-200 bg-white/70 text-slate-600 hover:bg-white'}`}
                            >
                              <SourceIcon source={{ ...source, iconUrl: subSource.iconUrl || source.iconUrl }} className="h-6 w-6" imageClassName="h-4 w-4" />
                              <span className="block truncate text-xs font-semibold">{subSource.label || subSource.name}</span>
                              <span className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${selected ? 'bg-sky-600 text-white' : 'bg-slate-200 text-transparent'}`}>
                                <Check className="h-3 w-3" aria-hidden="true" />
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
                  className={`relative flex min-h-[5.5rem] w-full items-start gap-3 rounded-3xl border p-4 text-left shadow-sm transition-all ${selected ? 'border-sky-200 bg-sky-50/80 text-sky-950 shadow-sky-100' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:shadow-md'}`}
                >
                  <SourceIcon source={source} className="h-10 w-10 rounded-2xl shadow-sm" imageClassName="h-5 w-5" />
                  <span className="min-w-0 pr-7">
                    <span className="block truncate text-sm font-semibold text-slate-900">{source.name}</span>
                    <span className="mt-1 block text-xs font-medium text-slate-500">{selected ? t('sourceSetupSelected') : t('sourceSetupNotSelected')}</span>
                  </span>
                  <span className={`absolute right-3 top-3 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border shadow-sm ${selected ? 'border-sky-600 bg-sky-600 text-white' : 'border-slate-200 bg-white text-transparent'}`}>
                    <Check className="h-4 w-4" aria-hidden="true" />
                  </span>
                </button>
              );
                  })}
                </div>
              </section>
            ))}
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
