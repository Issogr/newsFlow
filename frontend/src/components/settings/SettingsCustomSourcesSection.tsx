import { useState, type FormEvent } from 'react';
import { Check, Search } from 'lucide-react';
import InlineAlert from '../InlineAlert';
import useLatestRequest from '../../hooks/useLatestRequest';
import { discoverRssFeeds, isRequestCanceled } from '../../services/api';
import { getFriendlyApiErrorMessage } from '../../utils/apiError';
import type { DiscoveredFeed, NewsSource, Translator } from '../../types';

const fieldClassName = 'w-full rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-3 text-slate-800 outline-none transition-[border-color,background-color,box-shadow] placeholder:text-slate-400 focus:border-sky-300 focus:bg-white focus:ring-2 focus:ring-sky-100';
const SettingsCustomSourcesSection = ({
  t,
  saving,
  sourceError,
  customSources,
  maxSourceCount,
  onAddDiscoveredSources
}: {
  t: Translator;
  saving: boolean;
  sourceError: unknown;
  customSources: NewsSource[];
  maxSourceCount?: number;
  onAddDiscoveredSources: (urls: string[]) => Promise<string[]>;
}) => {
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [discoveredFeeds, setDiscoveredFeeds] = useState<DiscoveredFeed[] | null>(null);
  const [selectedFeedUrls, setSelectedFeedUrls] = useState<string[]>([]);
  const [discoveringFeeds, setDiscoveringFeeds] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<unknown>(null);
  const { startLatestRequest, resetLatestRequest } = useLatestRequest();
  const sourceLimitReached = Number.isFinite(maxSourceCount) && customSources.length >= (maxSourceCount ?? Infinity);
  const remainingSourceSlots = Number.isFinite(maxSourceCount)
    ? Math.max(0, (maxSourceCount ?? 0) - customSources.length)
    : Infinity;
  const discoveryStatus = discoveringFeeds
    ? t('findingRssFeeds')
    : discoveredFeeds === null
      ? ''
      : discoveredFeeds.length > 0
        ? t('rssFeedsFound', { count: discoveredFeeds.length })
        : t('noRssFeedsFound');
  const resetFeedDiscovery = () => {
    resetLatestRequest();
    setWebsiteUrl('');
    setDiscoveredFeeds(null);
    setSelectedFeedUrls([]);
    setDiscoveringFeeds(false);
    setDiscoveryError(null);
  };
  const handleDiscoverFeeds = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const url = websiteUrl.trim();
    if (!url) {
      return;
    }

    const request = startLatestRequest();
    setDiscoveringFeeds(true);
    setDiscoveredFeeds(null);
    setSelectedFeedUrls([]);
    setDiscoveryError(null);

    try {
      const response = await discoverRssFeeds(url, { signal: request.signal });
      if (request.isLatest()) {
        setDiscoveredFeeds(response.feeds || []);
      }
    } catch (error) {
      if (request.isLatest() && !isRequestCanceled(error)) {
        setDiscoveryError(error);
      }
    } finally {
      if (request.isLatest()) {
        setDiscoveringFeeds(false);
      }
    }
  };
  const toggleDiscoveredFeed = (feedUrl: string) => {
    setSelectedFeedUrls((current) => current.includes(feedUrl)
      ? current.filter((url) => url !== feedUrl)
      : current.length < remainingSourceSlots ? [...current, feedUrl] : current);
  };
  const addSelectedFeeds = async () => {
    const selectedUrls = [...selectedFeedUrls];
    const addedUrls = await onAddDiscoveredSources(selectedUrls);
    if (addedUrls.length === selectedUrls.length) {
      resetFeedDiscovery();
      return;
    }

    const addedUrlSet = new Set(addedUrls);
    setSelectedFeedUrls((current) => current.filter((url) => !addedUrlSet.has(url)));
    setDiscoveredFeeds((current) => current?.filter((feed) => !addedUrlSet.has(feed.url)) || null);
  };

  return (
    <section className="pb-1">
      <div>
        <div className="space-y-4">
          <form onSubmit={handleDiscoverFeeds} className="space-y-3">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">{t('websiteUrl')}</span>
              <input
                type="url"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                placeholder="https://example.com"
                value={websiteUrl}
                onChange={(event) => {
                  setWebsiteUrl(event.target.value);
                  setDiscoveredFeeds(null);
                  setSelectedFeedUrls([]);
                  setDiscoveryError(null);
                }}
                disabled={saving || discoveringFeeds || sourceLimitReached}
                className={fieldClassName}
                required
              />
            </label>
            <p className="text-sm text-slate-500">{t('rssDiscoveryHelp')}</p>
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={saving || discoveringFeeds || sourceLimitReached || !websiteUrl.trim()} className="inline-flex items-center justify-center gap-2 rounded-xl border border-sky-200 bg-white px-4 py-2 text-sm font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-60">
                <Search className="h-4 w-4" aria-hidden="true" />
                {discoveringFeeds ? t('findingRssFeeds') : t('findRssFeeds')}
              </button>
              <button type="button" onClick={resetFeedDiscovery} disabled={saving || (!websiteUrl && discoveredFeeds === null && !discoveryError && !discoveringFeeds)} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60">
                {t('clearSearch')}
              </button>
            </div>
          </form>

          {discoveryError ? (
            <InlineAlert as="p">
              {getFriendlyApiErrorMessage(discoveryError, t)}
            </InlineAlert>
          ) : null}

          {discoveryStatus ? (
            <div aria-busy={discoveringFeeds}>
              <p role="status" aria-live="polite" className="text-sm font-medium text-slate-700">
                {discoveryStatus}
              </p>
              {discoveredFeeds?.length ? (
                <div className="mt-2 grid gap-2">
                  {discoveredFeeds.map((feed) => {
                    const title = feed.title || t('rssFeedResult');
                    const selected = selectedFeedUrls.includes(feed.url);
                    const alreadyAdded = customSources.some((source) => source.url === feed.url);
                    const selectionLimitReached = !selected && selectedFeedUrls.length >= remainingSourceSlots;
                    return (
                      <button
                        key={feed.url}
                        type="button"
                        onClick={() => toggleDiscoveredFeed(feed.url)}
                        disabled={saving || alreadyAdded || selectionLimitReached}
                        aria-pressed={selected}
                        aria-label={t(selected ? 'deselectRssFeed' : 'selectRssFeed', { title })}
                        className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${selected ? 'border-sky-200 bg-sky-50' : 'border-slate-200 bg-white hover:border-sky-300 hover:bg-sky-50'}`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-slate-800">{title}</span>
                          <span className="mt-0.5 block break-all text-xs text-slate-500">{feed.url}</span>
                          {alreadyAdded ? <span className="mt-1 block text-xs font-medium text-slate-500">{t('rssFeedAlreadyAdded')}</span> : null}
                        </span>
                        <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${selected ? 'bg-sky-600 text-white' : 'bg-slate-200 text-transparent'}`} aria-hidden="true">
                          <Check className="h-3.5 w-3.5" />
                        </span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={addSelectedFeeds}
                    disabled={saving || selectedFeedUrls.length === 0}
                    className="mt-1 inline-flex w-fit items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saving ? t('addingSelectedFeeds') : t('addSelectedFeeds', { count: selectedFeedUrls.length })}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        {Number.isFinite(maxSourceCount) && (
          <p className="mt-2 text-xs text-slate-500">{t('customSourceLimit', { count: maxSourceCount })}</p>
        )}
        {sourceError ? (
          <InlineAlert as="p" className="mt-3">
            {getFriendlyApiErrorMessage(sourceError, t)}
          </InlineAlert>
        ) : null}
      </div>
    </section>
  );
};

export default SettingsCustomSourcesSection;
