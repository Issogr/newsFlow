import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pencil, Plus, Settings, Trash2, X } from 'lucide-react';
import {
  addUserSource,
  deleteUserSource,
  exportUserSettings,
  importUserSettings,
  updateUserSource,
  updateUserSettings
} from '../services/api';
import { clampSettingValue, getSettingsLimits } from '../config/settingsLimits';

const SettingsPanel = ({ t, currentUser, availableSources, onClose, onUserUpdate }) => {
  const [settings, setSettings] = useState(currentUser.settings);
  const [customSources, setCustomSources] = useState(currentUser.customSources || []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [sourceForm, setSourceForm] = useState({ url: '' });
  const [editingSourceId, setEditingSourceId] = useState('');
  const [editingSourceForm, setEditingSourceForm] = useState({ name: '', url: '', language: 'it' });
  const importInputRef = useRef(null);
  const settingsLimits = useMemo(() => getSettingsLimits(currentUser), [currentUser]);
  const excludedSourceCatalog = useMemo(() => {
    const customSourceIds = new Set(customSources.map((source) => source.id));
    return availableSources.filter((source) => !customSourceIds.has(source.id));
  }, [availableSources, customSources]);

  useEffect(() => {
    setSettings(currentUser.settings);
    setCustomSources(currentUser.customSources || []);
  }, [currentUser]);

  const syncUserState = useCallback((nextSettings, nextCustomSources) => {
    setSettings(nextSettings);
    setCustomSources(nextCustomSources);
    onUserUpdate({
      ...currentUser,
      settings: nextSettings,
      customSources: nextCustomSources
    });
  }, [currentUser, onUserUpdate]);

  const runSavingAction = useCallback(async (action) => {
    setSaving(true);
    setError(null);

    try {
      return await action();
    } catch (requestError) {
      setError(requestError);
      return null;
    } finally {
      setSaving(false);
    }
  }, []);

  const updateNumericSetting = useCallback((key, value, limits) => {
    setSettings((current) => ({
      ...current,
      [key]: clampSettingValue(value, limits)
    }));
  }, []);

  const toggleExcludedSource = (sourceId) => {
    setSettings((current) => {
      const exists = current.excludedSourceIds.includes(sourceId);
      return {
        ...current,
        excludedSourceIds: exists
          ? current.excludedSourceIds.filter((item) => item !== sourceId)
          : [...current.excludedSourceIds, sourceId]
      };
    });
  };

  const handleSave = async () => {
    await runSavingAction(async () => {
      const response = await updateUserSettings(settings);
      syncUserState(response.settings, customSources);
      onClose();
    });
  };

  const handleAddSource = async (event) => {
    event.preventDefault();

    await runSavingAction(async () => {
      const response = await addUserSource(sourceForm);
      const nextCustomSources = [response.source, ...customSources];
      setSourceForm({ url: '' });
      syncUserState(settings, nextCustomSources);
    });
  };

  const startEditSource = (source) => {
    setEditingSourceId(source.id);
    setEditingSourceForm({
      name: source.name,
      url: source.url,
      language: source.language || 'it'
    });
  };

  const cancelEditSource = () => {
    setEditingSourceId('');
    setEditingSourceForm({ name: '', url: '', language: 'it' });
  };

  const handleUpdateSource = async (sourceId) => {
    await runSavingAction(async () => {
      const response = await updateUserSource(sourceId, editingSourceForm);
      const nextCustomSources = customSources.map((source) => (
        source.id === sourceId ? response.source : source
      ));
      syncUserState(settings, nextCustomSources);
      cancelEditSource();
    });
  };

  const handleExport = async () => {
    await runSavingAction(async () => {
      const payload = await exportUserSettings();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `news-flow-settings-${currentUser.user.username}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    });
  };

  const handleImportClick = () => {
    importInputRef.current?.click();
  };

  const handleImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const payload = JSON.parse(text);

      await runSavingAction(async () => {
        const response = await importUserSettings(payload);
        syncUserState(response.settings, response.customSources);
      });
    } catch (requestError) {
      setError(requestError instanceof SyntaxError ? new Error('Invalid settings file format') : requestError);
    } finally {
      if (event.target) {
        event.target.value = '';
      }
    }
  };

  const handleDeleteSource = async (sourceId) => {
    await runSavingAction(async () => {
      await deleteUserSource(sourceId);
      const nextCustomSources = customSources.filter((source) => source.id !== sourceId);
      const nextSettings = {
        ...settings,
        excludedSourceIds: settings.excludedSourceIds.filter((item) => item !== sourceId)
      };
      syncUserState(nextSettings, nextCustomSources);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex bg-slate-950/35 px-4 py-6 backdrop-blur-sm">
      <div className="ml-auto flex h-full w-full max-w-2xl flex-col overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
          <div>
            <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              <Settings className="h-4 w-4" />
              {t('settings')}
            </p>
            <h2 className="mt-2 text-xl font-semibold text-slate-900">{currentUser.user.username}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-slate-500 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-8">
          <section className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleExport}
                disabled={saving}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
              >
                {t('exportSettings')}
              </button>
              <button
                type="button"
                onClick={handleImportClick}
                disabled={saving}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
              >
                {t('importSettings')}
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={handleImport}
              />
            </div>
            <p className="text-sm text-slate-500">{t('importSettingsHelp')}</p>
          </section>

          <section className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">{t('preferences')}</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">{t('defaultLanguageSetting')}</span>
                <select
                  value={settings.defaultLanguage}
                  onChange={(event) => setSettings((current) => ({ ...current, defaultLanguage: event.target.value }))}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                >
                  <option value="auto">{t('useBrowserLanguage')}</option>
                  <option value="it">IT</option>
                  <option value="en">EN</option>
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">{t('articleRetention')}</span>
                <input
                  type="number"
                  min={settingsLimits.articleRetentionHours.min}
                  max={settingsLimits.articleRetentionHours.max}
                  value={settings.articleRetentionHours}
                  onChange={(event) => updateNumericSetting('articleRetentionHours', event.target.value, settingsLimits.articleRetentionHours)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                />
              </label>

              <label className="block md:col-span-2">
                <span className="mb-2 block text-sm font-medium text-slate-700">{t('quickFilterHours')}</span>
                <input
                  type="number"
                  min={settingsLimits.recentHours.min}
                  max={settingsLimits.recentHours.max}
                  value={settings.recentHours}
                  onChange={(event) => updateNumericSetting('recentHours', event.target.value, settingsLimits.recentHours)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                />
              </label>
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">{t('excludedSources')}</h3>
            <p className="text-sm text-slate-500">{t('excludedSourcesHelp')}</p>
            <div className="flex flex-wrap gap-2">
              {excludedSourceCatalog.map((source) => {
                const isSelected = settings.excludedSourceIds.includes(source.id);
                return (
                  <button
                    key={source.id}
                    type="button"
                    onClick={() => toggleExcludedSource(source.id)}
                    className={`rounded-full px-3 py-1.5 text-sm transition-colors ${isSelected ? 'bg-rose-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                  >
                    {source.name}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">{t('customSources')}</h3>
            <p className="text-sm text-slate-500">{t('addSourceHelp')}</p>
            <form onSubmit={handleAddSource} className="grid gap-3 md:grid-cols-[1fr_auto]">
              <input
                placeholder={t('rssUrl')}
                value={sourceForm.url}
                onChange={(event) => setSourceForm({ url: event.target.value })}
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
                            onChange={(event) => setEditingSourceForm((current) => ({ ...current, name: event.target.value }))}
                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3"
                            placeholder={t('sourceName')}
                          />
                          <input
                            value={editingSourceForm.url}
                            onChange={(event) => setEditingSourceForm((current) => ({ ...current, url: event.target.value }))}
                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3"
                            placeholder={t('rssUrl')}
                          />
                          <div className="flex flex-wrap items-center gap-3">
                            <select
                              value={editingSourceForm.language}
                              onChange={(event) => setEditingSourceForm((current) => ({ ...current, language: event.target.value }))}
                              className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                            >
                              <option value="it">IT</option>
                              <option value="en">EN</option>
                              <option value="fr">FR</option>
                              <option value="es">ES</option>
                              <option value="de">DE</option>
                            </select>
                            <button type="button" onClick={() => handleUpdateSource(source.id)} disabled={saving} className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60">
                              {saving ? t('saveSourceDetecting') : t('saveSource')}
                            </button>
                            <button type="button" onClick={cancelEditSource} className="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
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
                            <button type="button" onClick={() => startEditSource(source)} className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
                              <Pencil className="h-4 w-4" />
                              {t('editSource')}
                            </button>
                            <button type="button" onClick={() => handleDeleteSource(source.id)} className="inline-flex items-center gap-2 rounded-full border border-red-200 px-3 py-2 text-sm text-red-700 hover:bg-red-50">
                              <Trash2 className="h-4 w-4" />
                              {t('remove')}
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

          {error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error.message}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end border-t border-slate-200 px-6 py-5">
          <button type="button" onClick={handleSave} disabled={saving} className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60">
            {saving ? t('saving') : t('saveSettings')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
