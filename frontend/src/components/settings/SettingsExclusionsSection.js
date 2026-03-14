import React from 'react';
import { Ban, FilterX } from 'lucide-react';
import SettingsSectionCard from './SettingsSectionCard';

const SettingsExclusionsSection = ({
  t,
  settings,
  excludedSourceCatalog,
  excludedSubFeedCatalog,
  onToggleSource,
  onToggleSubFeed
}) => {
  const excludedSourcesCount = (settings.excludedSourceIds || []).length;
  const excludedSubFeedsCount = (settings.excludedSubSourceIds || []).length;

  return (
    <SettingsSectionCard
      icon={FilterX}
      title={t('excludedSources')}
      description={t('excludedSourcesHelp')}
    >
      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-slate-800">{t('excludedSources')}</p>
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
            {excludedSourcesCount}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {excludedSourceCatalog.map((source) => {
            const isSelected = (settings.excludedSourceIds || []).includes(source.id);
            return (
              <button
                key={source.id}
                type="button"
                onClick={() => onToggleSource(source.id)}
                className={`rounded-full px-3 py-1.5 text-sm transition-colors ${isSelected ? 'bg-rose-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
              >
                {source.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-t border-slate-200 pt-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <Ban className="mt-0.5 h-4 w-4 text-slate-400" />
            <div>
              <p className="text-sm font-medium text-slate-800">{t('excludedSubFeeds')}</p>
              <p className="mt-1 text-sm text-slate-500">{t('excludedSubFeedsHelp')}</p>
            </div>
          </div>
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
            {excludedSubFeedsCount}
          </span>
        </div>

        {excludedSubFeedCatalog.length === 0 ? (
          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">{t('noExcludedSubFeeds')}</div>
        ) : (
          <div className="space-y-3">
            {excludedSubFeedCatalog.map((source) => {
              const isParentExcluded = (settings.excludedSourceIds || []).includes(source.id);

              return (
                <div key={source.id} className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-sm font-medium text-slate-800">{source.name}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {source.subSources.map((subSource) => {
                      const isSelected = (settings.excludedSubSourceIds || []).includes(subSource.id);

                      return (
                        <button
                          key={subSource.id}
                          type="button"
                          disabled={isParentExcluded}
                          onClick={() => onToggleSubFeed(subSource.id)}
                          className={`rounded-full px-3 py-1.5 text-sm transition-colors ${isSelected ? 'bg-amber-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-200'} disabled:cursor-not-allowed disabled:opacity-50`}
                        >
                          {subSource.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </SettingsSectionCard>
  );
};

export default SettingsExclusionsSection;
