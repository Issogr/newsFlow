import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addUserSource,
  deleteUserSource,
  exportUserSettings,
  importUserSettings,
  updateUserSource,
  updateUserSettings
} from '../../services/api';
import { clampSettingValue, getSettingsLimits } from '../../config/settingsLimits';

const createInitialSourceForm = () => ({ url: '' });
const createInitialEditingSourceForm = () => ({ name: '', url: '', language: 'it' });

const useSettingsPanelState = ({ currentUser, availableSources, onClose, onUserUpdate }) => {
  const [settings, setSettings] = useState(currentUser.settings);
  const [customSources, setCustomSources] = useState(currentUser.customSources || []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [sourceForm, setSourceForm] = useState(createInitialSourceForm);
  const [editingSourceId, setEditingSourceId] = useState('');
  const [editingSourceForm, setEditingSourceForm] = useState(createInitialEditingSourceForm);
  const importInputRef = useRef(null);
  const settingsLimits = useMemo(() => getSettingsLimits(currentUser), [currentUser]);

  const excludedSourceCatalog = useMemo(() => {
    const customSourceIds = new Set(customSources.map((source) => source.id));
    return availableSources.filter((source) => !customSourceIds.has(source.id));
  }, [availableSources, customSources]);

  const excludedSubFeedCatalog = useMemo(() => {
    return excludedSourceCatalog
      .filter((source) => Array.isArray(source.subSources) && source.subSources.length > 1)
      .map((source) => ({
        id: source.id,
        name: source.name,
        subSources: source.subSources
      }));
  }, [excludedSourceCatalog]);

  const subSourceIdsBySourceId = useMemo(() => {
    return new Map(excludedSubFeedCatalog.map((source) => [
      source.id,
      new Set(source.subSources.map((subSource) => subSource.id))
    ]));
  }, [excludedSubFeedCatalog]);

  useEffect(() => {
    setSettings(currentUser.settings);
    setCustomSources(currentUser.customSources || []);
    setSourceForm(createInitialSourceForm());
    setEditingSourceId('');
    setEditingSourceForm(createInitialEditingSourceForm());
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

  const setDefaultLanguage = useCallback((value) => {
    setSettings((current) => ({
      ...current,
      defaultLanguage: value
    }));
  }, []);

  const setAutoRefreshEnabled = useCallback((value) => {
    setSettings((current) => ({
      ...current,
      autoRefreshEnabled: Boolean(value)
    }));
  }, []);

  const setReaderPanelPosition = useCallback((value) => {
    setSettings((current) => ({
      ...current,
      readerPanelPosition: value
    }));
  }, []);

  const toggleExcludedSource = useCallback((sourceId) => {
    setSettings((current) => {
      const excludedSourceIds = current.excludedSourceIds || [];
      const excludedSubSourceIds = current.excludedSubSourceIds || [];
      const exists = excludedSourceIds.includes(sourceId);

      return {
        ...current,
        excludedSourceIds: exists
          ? excludedSourceIds.filter((item) => item !== sourceId)
          : [...excludedSourceIds, sourceId],
        excludedSubSourceIds: exists
          ? excludedSubSourceIds
          : excludedSubSourceIds.filter((item) => !subSourceIdsBySourceId.get(sourceId)?.has(item))
      };
    });
  }, [subSourceIdsBySourceId]);

  const toggleExcludedSubFeed = useCallback((subSourceId) => {
    setSettings((current) => {
      const excludedSubSourceIds = current.excludedSubSourceIds || [];
      const exists = excludedSubSourceIds.includes(subSourceId);

      return {
        ...current,
        excludedSubSourceIds: exists
          ? excludedSubSourceIds.filter((item) => item !== subSourceId)
          : [...excludedSubSourceIds, subSourceId]
      };
    });
  }, []);

  const handleSave = useCallback(async () => {
    await runSavingAction(async () => {
      const response = await updateUserSettings(settings);
      syncUserState(response.settings, customSources);
      onClose();
    });
  }, [customSources, onClose, runSavingAction, settings, syncUserState]);

  const handleExport = useCallback(async () => {
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
  }, [currentUser.user.username, runSavingAction]);

  const handleImportClick = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const handleImport = useCallback(async (event) => {
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
  }, [runSavingAction, syncUserState]);

  const handleAddSource = useCallback(async (event) => {
    event.preventDefault();

    await runSavingAction(async () => {
      const response = await addUserSource(sourceForm);
      const nextCustomSources = [response.source, ...customSources];
      setSourceForm(createInitialSourceForm());
      syncUserState(settings, nextCustomSources);
    });
  }, [customSources, runSavingAction, settings, sourceForm, syncUserState]);

  const startEditSource = useCallback((source) => {
    setEditingSourceId(source.id);
    setEditingSourceForm({
      name: source.name,
      url: source.url,
      language: source.language || 'it'
    });
  }, []);

  const cancelEditSource = useCallback(() => {
    setEditingSourceId('');
    setEditingSourceForm(createInitialEditingSourceForm());
  }, []);

  const handleUpdateSource = useCallback(async (sourceId) => {
    await runSavingAction(async () => {
      const response = await updateUserSource(sourceId, editingSourceForm);
      const nextCustomSources = customSources.map((source) => (
        source.id === sourceId ? response.source : source
      ));
      syncUserState(settings, nextCustomSources);
      cancelEditSource();
    });
  }, [cancelEditSource, customSources, editingSourceForm, runSavingAction, settings, syncUserState]);

  const handleDeleteSource = useCallback(async (sourceId) => {
    await runSavingAction(async () => {
      await deleteUserSource(sourceId);
      const nextCustomSources = customSources.filter((source) => source.id !== sourceId);
      const nextSettings = {
        ...settings,
        excludedSourceIds: (settings.excludedSourceIds || []).filter((item) => item !== sourceId)
      };
      syncUserState(nextSettings, nextCustomSources);
    });
  }, [customSources, runSavingAction, settings, syncUserState]);

  return {
    saving,
    error,
    settings,
    customSources,
    sourceForm,
    editingSourceId,
    editingSourceForm,
    importInputRef,
    settingsLimits,
    excludedSourceCatalog,
    excludedSubFeedCatalog,
    setSourceForm,
    setEditingSourceForm,
    setDefaultLanguage,
    setAutoRefreshEnabled,
    setReaderPanelPosition,
    updateNumericSetting,
    toggleExcludedSource,
    toggleExcludedSubFeed,
    handleSave,
    handleExport,
    handleImportClick,
    handleImport,
    handleAddSource,
    startEditSource,
    cancelEditSource,
    handleUpdateSource,
    handleDeleteSource
  };
};

export default useSettingsPanelState;
