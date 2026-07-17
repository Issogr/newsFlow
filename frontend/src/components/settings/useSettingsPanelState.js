import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addUserSource,
  createApiToken,
  deleteUserSource,
  exportUserSettings,
  importUserSettings,
  revokeApiToken,
  updateUserSource,
  updateUserSettings
} from '../../services/api';
import {
  getStoredReaderTextSizePreference,
  getStoredReaderTextWidthPreference,
  setStoredReaderTextSizePreference,
  setStoredReaderTextWidthPreference
} from '../../utils/readerPreferences';

const createInitialSourceForm = () => ({ url: '' });
const createInitialEditingSourceForm = () => ({ name: '', url: '', language: 'it' });
const getCurrentUserIdentity = (currentUser) => currentUser?.user?.id || currentUser?.user?.username || currentUser?.id || '';
const getInitialSettings = (currentUser) => ({
  ...currentUser.settings,
  readerTextSize: getStoredReaderTextSizePreference(currentUser?.settings?.readerTextSize),
  readerTextWidth: getStoredReaderTextWidthPreference(currentUser?.settings?.readerTextWidth)
});

const areSettingValuesEqual = (left, right) => {
  if (Array.isArray(left) || Array.isArray(right)) {
    return JSON.stringify(left || []) === JSON.stringify(right || []);
  }

  return left === right;
};

const createSettingsPatch = (nextSettings, currentUser, dirtyKeys) => {
  const persistedSettings = getInitialSettings(currentUser);

  return dirtyKeys.reduce((patch, key) => {
    if (!areSettingValuesEqual(nextSettings[key], persistedSettings[key])) {
      patch[key] = nextSettings[key];
    }

    return patch;
  }, {});
};

const useSettingsPanelState = ({ currentUser, availableSources, onUserUpdate }) => {
  const [settings, setSettings] = useState(() => getInitialSettings(currentUser));
  const [customSources, setCustomSources] = useState(currentUser.customSources || []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [sourceError, setSourceError] = useState(null);
  const [apiToken, setApiToken] = useState(currentUser.apiToken || null);
  const [newApiToken, setNewApiToken] = useState('');
  const [sourceForm, setSourceForm] = useState(createInitialSourceForm);
  const [editingSourceId, setEditingSourceId] = useState('');
  const [editingSourceForm, setEditingSourceForm] = useState(createInitialEditingSourceForm);
  const importInputRef = useRef(null);
  const userIdentityRef = useRef(getCurrentUserIdentity(currentUser));
  const currentUserRef = useRef(currentUser);
  const dirtySettingKeysRef = useRef(new Set());
  const savingActionsRef = useRef(0);
  currentUserRef.current = currentUser;
  const settingsLimits = {
    apiTokenTtlDays: Number.isFinite(currentUser?.limits?.apiTokenTtlDays) ? currentUser.limits.apiTokenTtlDays : 30
  };

  const excludedSourceCatalog = useMemo(() => {
    const customSourceIds = new Set(customSources.map((source) => source.id));
    return availableSources.filter((source) => !customSourceIds.has(source.id));
  }, [availableSources, customSources]);

  const subSourceIdsBySourceId = useMemo(() => {
    return new Map(excludedSourceCatalog
      .filter((source) => Array.isArray(source.subSources) && source.subSources.length > 1)
      .map((source) => [source.id, new Set(source.subSources.map((subSource) => subSource.id))]));
  }, [excludedSourceCatalog]);

  useEffect(() => {
    const nextUserIdentity = getCurrentUserIdentity(currentUser);
    if (userIdentityRef.current !== nextUserIdentity) {
      userIdentityRef.current = nextUserIdentity;
      dirtySettingKeysRef.current.clear();
      setSettings(getInitialSettings(currentUser));
      setNewApiToken('');
      setSourceError(null);
      setSourceForm(createInitialSourceForm());
      setEditingSourceId('');
      setEditingSourceForm(createInitialEditingSourceForm());
    } else {
      setSettings((current) => {
        const persistedSettings = getInitialSettings(currentUser);
        const nextSettings = { ...current };
        let changed = false;

        Object.entries(persistedSettings).forEach(([key, value]) => {
          if (dirtySettingKeysRef.current.has(key) && areSettingValuesEqual(current[key], value)) {
            dirtySettingKeysRef.current.delete(key);
          } else if (!dirtySettingKeysRef.current.has(key) && !areSettingValuesEqual(current[key], value)) {
            nextSettings[key] = value;
            changed = true;
          }
        });

        return changed ? nextSettings : current;
      });
    }

    setCustomSources(currentUser.customSources || []);
    setApiToken(currentUser.apiToken || null);
  }, [currentUser]);

  const syncPersistedUserState = useCallback((nextSettings, nextCustomSources) => {
    dirtySettingKeysRef.current.clear();
    setSettings(nextSettings);
    setCustomSources(nextCustomSources);
    onUserUpdate({
      ...currentUserRef.current,
      settings: nextSettings,
      customSources: nextCustomSources
    });
  }, [onUserUpdate]);

  const syncCustomSourcesState = useCallback((nextCustomSources, nextSettings = null) => {
    setCustomSources(nextCustomSources);
    onUserUpdate({
      ...currentUserRef.current,
      ...(nextSettings ? { settings: nextSettings } : {}),
      customSources: nextCustomSources
    });
  }, [onUserUpdate]);

  const runSavingAction = useCallback(async (action, options = {}) => {
    savingActionsRef.current += 1;
    setSaving(true);
    setError(null);

    try {
      return await action();
    } catch (requestError) {
      if (options.globalError !== false) {
        setError(requestError);
      }
      options.onError?.(requestError);
      return null;
    } finally {
      savingActionsRef.current -= 1;
      if (savingActionsRef.current === 0) {
        setSaving(false);
      }
    }
  }, []);

  const markSettingDirty = useCallback((key, value) => {
    const persistedValue = getInitialSettings(currentUserRef.current)[key];
    if (areSettingValuesEqual(value, persistedValue)) {
      dirtySettingKeysRef.current.delete(key);
    } else {
      dirtySettingKeysRef.current.add(key);
    }
  }, []);

  const setSetting = useCallback((key, value) => {
    markSettingDirty(key, value);
    setSettings((current) => ({ ...current, [key]: value }));
  }, [markSettingDirty]);

  const toggleExcludedSource = useCallback((sourceId) => {
    const excludedSourceIds = settings.excludedSourceIds || [];
    const excludedSubSourceIds = settings.excludedSubSourceIds || [];
    const subSourceIds = subSourceIdsBySourceId.get(sourceId);
    const isHidden = excludedSourceIds.includes(sourceId)
      || (subSourceIds && [...subSourceIds].every((id) => excludedSubSourceIds.includes(id)));
    const nextExcludedSourceIds = isHidden
      ? excludedSourceIds.filter((item) => item !== sourceId)
      : [...excludedSourceIds, sourceId];
    const nextExcludedSubSourceIds = excludedSubSourceIds.filter((item) => !subSourceIds?.has(item));

    markSettingDirty('excludedSourceIds', nextExcludedSourceIds);
    markSettingDirty('excludedSubSourceIds', nextExcludedSubSourceIds);
    setSettings({
      ...settings,
      excludedSourceIds: nextExcludedSourceIds,
      excludedSubSourceIds: nextExcludedSubSourceIds
    });
  }, [markSettingDirty, settings, subSourceIdsBySourceId]);

  const toggleExcludedSubFeed = useCallback((subSourceId) => {
    const parentSource = [...subSourceIdsBySourceId].find(([, subSourceIds]) => subSourceIds.has(subSourceId));
    const excludedSubSourceIds = settings.excludedSubSourceIds || [];
    const exists = excludedSubSourceIds.includes(subSourceId);
    let nextExcludedSubSourceIds = exists
      ? excludedSubSourceIds.filter((item) => item !== subSourceId)
      : [...excludedSubSourceIds, subSourceId];
    let nextExcludedSourceIds = settings.excludedSourceIds || [];

    if (parentSource?.[1] && [...parentSource[1]].every((id) => nextExcludedSubSourceIds.includes(id))) {
      nextExcludedSourceIds = [...new Set([...nextExcludedSourceIds, parentSource[0]])];
      nextExcludedSubSourceIds = nextExcludedSubSourceIds.filter((item) => !parentSource[1].has(item));
    }

    markSettingDirty('excludedSourceIds', nextExcludedSourceIds);
    markSettingDirty('excludedSubSourceIds', nextExcludedSubSourceIds);
    setSettings({
      ...settings,
      excludedSourceIds: nextExcludedSourceIds,
      excludedSubSourceIds: nextExcludedSubSourceIds
    });
  }, [markSettingDirty, settings, subSourceIdsBySourceId]);

  const editingSource = customSources.find((source) => source.id === editingSourceId);
  const hasSourceFormChanges = Boolean(sourceForm.url.trim());
  const hasEditingSourceChanges = Boolean(editingSource) && (
    editingSourceForm.name !== editingSource.name
    || editingSourceForm.url !== editingSource.url
    || editingSourceForm.language !== (editingSource.language || 'it')
  );

  const handleSave = useCallback(async () => {
    const dirtySettingKeys = [...dirtySettingKeysRef.current];
    const settingsPatch = createSettingsPatch(settings, currentUserRef.current, dirtySettingKeys);
    if (Object.keys(settingsPatch).length === 0 && !hasSourceFormChanges && !hasEditingSourceChanges) {
      dirtySettingKeysRef.current.clear();
      return true;
    }

    setSourceError(null);
    const result = await runSavingAction(async () => {
      let nextCustomSources = customSources;
      let nextSettings = getInitialSettings(currentUserRef.current);

      if (hasSourceFormChanges) {
        const response = await addUserSource(sourceForm);
        nextCustomSources = [response.source, ...nextCustomSources];
        setSourceForm(createInitialSourceForm());
        syncCustomSourcesState(nextCustomSources);
      }

      if (hasEditingSourceChanges) {
        const response = await updateUserSource(editingSourceId, editingSourceForm);
        nextCustomSources = nextCustomSources.map((source) => (
          source.id === editingSourceId ? response.source : source
        ));
        setEditingSourceId('');
        setEditingSourceForm(createInitialEditingSourceForm());
        syncCustomSourcesState(nextCustomSources);
      }

      if (Object.keys(settingsPatch).length > 0) {
        const response = await updateUserSettings(settingsPatch);
        const persistedPatch = Object.keys(settingsPatch).reduce((patch, key) => ({
          ...patch,
          [key]: response.settings[key]
        }), {});
        nextSettings = { ...getInitialSettings(currentUserRef.current), ...persistedPatch };
      }

      return { nextCustomSources, nextSettings };
    });
    if (!result) {
      return false;
    }

    const nextSettings = Object.keys(settingsPatch).length > 0
      ? result.nextSettings
      : getInitialSettings(currentUserRef.current);
    setStoredReaderTextSizePreference(nextSettings.readerTextSize);
    setStoredReaderTextWidthPreference(nextSettings.readerTextWidth);
    syncPersistedUserState(nextSettings, result.nextCustomSources);
    return true;
  }, [customSources, editingSourceForm, editingSourceId, hasEditingSourceChanges, hasSourceFormChanges, runSavingAction, settings, sourceForm, syncCustomSourcesState, syncPersistedUserState]);

  const handleCreateApiToken = useCallback(async () => {
    await runSavingAction(async () => {
      const response = await createApiToken();
      setApiToken(response.tokenInfo || null);
      setNewApiToken(response.token || '');
      onUserUpdate({
        ...currentUserRef.current,
        apiToken: response.tokenInfo || null
      });
    });
  }, [onUserUpdate, runSavingAction]);

  const handleRevokeApiToken = useCallback(async () => {
    await runSavingAction(async () => {
      await revokeApiToken();
      setApiToken(null);
      setNewApiToken('');
      onUserUpdate({
        ...currentUserRef.current,
        apiToken: null
      });
    });
  }, [onUserUpdate, runSavingAction]);

  const handleExport = useCallback(async () => {
    await runSavingAction(async () => {
      const payload = await exportUserSettings();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      try {
        link.href = url;
        link.download = `news-flow-settings-${currentUser.user.username}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } finally {
        window.URL.revokeObjectURL(url);
      }
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
        setStoredReaderTextSizePreference(response.settings.readerTextSize);
        setStoredReaderTextWidthPreference(response.settings.readerTextWidth);
        syncPersistedUserState(response.settings, response.customSources);
      });
    } catch (requestError) {
      setError(requestError instanceof SyntaxError ? new Error('Invalid settings file format') : requestError);
    } finally {
      if (event.target) {
        event.target.value = '';
      }
    }
  }, [runSavingAction, syncPersistedUserState]);

  const handleAddSource = useCallback(async (event) => {
    event.preventDefault();
    setSourceError(null);

    return runSavingAction(async () => {
      const response = await addUserSource(sourceForm);
      const nextCustomSources = [response.source, ...customSources];
      setSourceForm(createInitialSourceForm());
      syncCustomSourcesState(nextCustomSources);
      return true;
    }, { globalError: false, onError: setSourceError });
  }, [customSources, runSavingAction, sourceForm, syncCustomSourcesState]);

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
    setSourceError(null);

    await runSavingAction(async () => {
      const response = await updateUserSource(sourceId, editingSourceForm);
      const nextCustomSources = customSources.map((source) => (
        source.id === sourceId ? response.source : source
      ));
      syncCustomSourcesState(nextCustomSources);
      cancelEditSource();
    }, { globalError: false, onError: setSourceError });
  }, [cancelEditSource, customSources, editingSourceForm, runSavingAction, syncCustomSourcesState]);

  const handleDeleteSource = useCallback(async (sourceId) => {
    await runSavingAction(async () => {
      await deleteUserSource(sourceId);
      const nextCustomSources = customSources.filter((source) => source.id !== sourceId);
      const nextSettings = {
        ...settings,
        excludedSourceIds: (settings.excludedSourceIds || []).filter((item) => item !== sourceId)
      };
      const persistedSettings = currentUserRef.current?.settings || {};
      const nextPersistedSettings = {
        ...persistedSettings,
        excludedSourceIds: (persistedSettings.excludedSourceIds || []).filter((item) => item !== sourceId)
      };
      setSettings(nextSettings);
      syncCustomSourcesState(nextCustomSources, nextPersistedSettings);
    });
  }, [customSources, runSavingAction, settings, syncCustomSourcesState]);

  const hasUnsavedChanges = Object.keys(createSettingsPatch(
    settings,
    currentUser,
    [...dirtySettingKeysRef.current]
  )).length > 0 || hasSourceFormChanges || hasEditingSourceChanges;

  return {
    saving,
    hasUnsavedChanges,
    error,
    sourceError,
    settings,
    apiToken,
    newApiToken,
    customSources,
    sourceForm,
    editingSourceId,
    editingSourceForm,
    importInputRef,
    settingsLimits,
    excludedSourceCatalog,
    setSourceForm,
    setEditingSourceForm,
    setSetting,
    toggleExcludedSource,
    toggleExcludedSubFeed,
    handleSave,
    handleExport,
    handleImportClick,
    handleImport,
    handleCreateApiToken,
    handleRevokeApiToken,
    handleAddSource,
    startEditSource,
    cancelEditSource,
    handleUpdateSource,
    handleDeleteSource
  };
};

export default useSettingsPanelState;
