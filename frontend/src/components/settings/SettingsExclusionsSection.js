import React from 'react';

const SettingsExclusionsSection = ({
  t,
  settings,
  excludedSourceCatalog,
  excludedSubFeedCatalog,
  onToggleSource,
  onToggleSubFeed
}) => {
  return (
    <>
      <section className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">{t('excludedSources')}</h3>
        <p className="text-sm text-slate-500">{t('excludedSourcesHelp')}</p>
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
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">{t('excludedSubFeeds')}</h3>
        <p className="text-sm text-slate-500">{t('excludedSubFeedsHelp')}</p>
        {excludedSubFeedCatalog.length === 0 ? (
          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">{t('noExcludedSubFeeds')}</div>
        ) : (
          <div className="space-y-3">
            {excludedSubFeedCatalog.map((source) => {
              const isParentExcluded = (settings.excludedSourceIds || []).includes(source.id);

              return (
                <div key={source.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
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
      </section>
    </>
  );
};

export default SettingsExclusionsSection;
