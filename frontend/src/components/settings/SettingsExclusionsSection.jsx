import { useRef, useState } from 'react';
import { Check, ChevronDown, Eye } from 'lucide-react';
import SettingsSectionCard from './SettingsSectionCard';
import SourceIcon from '../SourceIcon';

const SettingsExclusionsSection = ({
  t,
  saving,
  settings,
  excludedSourceCatalog,
  onToggleSource,
  onToggleSubFeed
}) => {
  const [expandedSourceIds, setExpandedSourceIds] = useState([]);
  const sourceButtonRefs = useRef(new Map());
  const excludedSourceIds = settings.excludedSourceIds || [];
  const excludedSubSourceIds = settings.excludedSubSourceIds || [];
  const isSourceShown = (source) => !excludedSourceIds.includes(source.id)
    && (!Array.isArray(source.subSources)
      || source.subSources.length <= 1
      || source.subSources.some((subSource) => !excludedSubSourceIds.includes(subSource.id)));
  const shownSourcesCount = excludedSourceCatalog.filter(isSourceShown).length;

  const toggleExpanded = (sourceId) => {
    setExpandedSourceIds((current) => current.includes(sourceId)
      ? current.filter((id) => id !== sourceId)
      : [...current, sourceId]);
  };

  return (
    <SettingsSectionCard
      icon={Eye}
      title={t('sourcesShown')}
      badge={t('sourcesShownCount', { shown: shownSourcesCount, count: excludedSourceCatalog.length })}
      iconToneClassName="text-sky-600"
    >
      <div className="divide-y divide-slate-200">
        {excludedSourceCatalog.map((source) => {
          const isShown = isSourceShown(source);
          const hasSubSources = Array.isArray(source.subSources) && source.subSources.length > 1;
          const isExpanded = isShown && expandedSourceIds.includes(source.id);

          return (
            <div key={source.id} className="py-3 first:pt-0 last:pb-0">
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
              </div>

              {isExpanded ? (
                <div className="mt-3 flex flex-wrap gap-2 pl-3">
                  {source.subSources.map((subSource) => {
                    const isSubSourceShown = !excludedSubSourceIds.includes(subSource.id);
                    const subSourceName = subSource.label || subSource.name;
                    const visibleSubSourceCount = source.subSources.filter((item) => !excludedSubSourceIds.includes(item.id)).length;

                    return (
                      <button
                        key={subSource.id}
                        type="button"
                        disabled={saving}
                        onClick={() => {
                          if (isSubSourceShown && visibleSubSourceCount === 1) {
                            sourceButtonRefs.current.get(source.id)?.focus();
                          }
                          onToggleSubFeed(subSource.id);
                        }}
                        aria-pressed={isSubSourceShown}
                        className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-2 text-sm transition-colors disabled:opacity-60 ${isSubSourceShown ? 'border-sky-200 bg-white text-sky-950' : 'border-slate-200 bg-slate-100 text-slate-500'}`}
                      >
                        <SourceIcon source={{ ...source, iconUrl: subSource.iconUrl || source.iconUrl }} className="h-6 w-6" />
                        <span className="truncate">{subSourceName}</span>
                        <Check className={`h-3.5 w-3.5 shrink-0 ${isSubSourceShown ? 'text-sky-600' : 'text-transparent'}`} aria-hidden="true" />
                      </button>
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
