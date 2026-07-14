import { act, renderHook } from '@testing-library/react';
import useSettingsPanelState from './useSettingsPanelState';
import {
  addUserSource,
  deleteUserSource,
  updateUserSource,
  updateUserSettings
} from '../../services/api';
import { createTestCurrentUser } from '../../test-utils/currentUser';

vi.mock('../../services/api', () => ({
  addUserSource: vi.fn(),
  createApiToken: vi.fn(),
  deleteUserSource: vi.fn(),
  exportUserSettings: vi.fn(),
  importUserSettings: vi.fn(),
  revokeApiToken: vi.fn(),
  updateUserSource: vi.fn(),
  updateUserSettings: vi.fn()
}));

const baseCurrentUser = createTestCurrentUser({ user: { id: 'user-1', username: 'alice' } });

const renderSettingsHook = (overrides = {}) => {
  const onUserUpdate = overrides.onUserUpdate || vi.fn();
  const result = renderHook(() => useSettingsPanelState({
    currentUser: overrides.currentUser || baseCurrentUser,
    availableSources: overrides.availableSources || [],
    onUserUpdate
  }));

  return { ...result, onUserUpdate };
};

describe('useSettingsPanelState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  test('keeps a changed setting local until save', async () => {
    const nextSettings = { ...baseCurrentUser.settings, defaultLanguage: 'it' };
    updateUserSettings.mockResolvedValue({ settings: nextSettings });
    const { result, onUserUpdate } = renderSettingsHook();

    act(() => {
      result.current.setSetting('defaultLanguage', 'it');
    });

    expect(updateUserSettings).not.toHaveBeenCalled();
    expect(result.current.settings.defaultLanguage).toBe('it');
    expect(result.current.hasUnsavedChanges).toBe(true);

    await act(async () => {
      await result.current.handleSave();
    });

    expect(updateUserSettings).toHaveBeenCalledWith({ defaultLanguage: 'it' });
    expect(result.current.settings).toEqual(nextSettings);
    expect(result.current.hasUnsavedChanges).toBe(false);
    expect(onUserUpdate).toHaveBeenCalledWith(expect.objectContaining({ settings: nextSettings }));
  });

  test('persists reader text width locally after save', async () => {
    const nextSettings = { ...baseCurrentUser.settings, readerTextWidth: 'wide' };
    updateUserSettings.mockResolvedValue({ settings: nextSettings });
    const { result } = renderSettingsHook();

    act(() => {
      result.current.setSetting('readerTextWidth', 'wide');
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(updateUserSettings).toHaveBeenCalledWith({ readerTextWidth: 'wide' });
    expect(window.localStorage.getItem('news-flow-reader-text-width')).toBe('wide');
  });

  test('keeps the draft when saving fails', async () => {
    const requestError = new Error('Unable to save');
    updateUserSettings.mockRejectedValue(requestError);
    const { result } = renderSettingsHook();

    act(() => {
      result.current.setSetting('themeMode', 'dark');
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(result.current.settings.themeMode).toBe('dark');
    expect(result.current.hasUnsavedChanges).toBe(true);
    expect(result.current.error).toBe(requestError);
  });

  test('does not save a setting changed back to its persisted value', async () => {
    const { result } = renderSettingsHook();

    act(() => {
      result.current.setSetting('defaultLanguage', 'it');
      result.current.setSetting('defaultLanguage', 'en');
    });

    expect(result.current.hasUnsavedChanges).toBe(false);

    await act(async () => {
      await result.current.handleSave();
    });

    expect(updateUserSettings).not.toHaveBeenCalled();
  });

  test('preserves a draft while merging newer parent settings', async () => {
    const onUserUpdate = vi.fn();
    const { result, rerender } = renderHook(({ currentUser }) => useSettingsPanelState({
      currentUser,
      availableSources: [],
      onUserUpdate
    }), { initialProps: { currentUser: baseCurrentUser } });
    act(() => {
      result.current.setSetting('themeMode', 'dark');
    });

    const externallyUpdatedUser = {
      ...baseCurrentUser,
      settings: {
        ...baseCurrentUser.settings,
        lastSeenReleaseNotesVersion: '3.5.11'
      }
    };
    rerender({ currentUser: externallyUpdatedUser });

    expect(result.current.settings).toEqual({
      ...externallyUpdatedUser.settings,
      themeMode: 'dark'
    });

    updateUserSettings.mockResolvedValue({
      settings: { ...baseCurrentUser.settings, themeMode: 'dark' }
    });
    await act(async () => {
      await result.current.handleSave();
    });

    expect(result.current.settings).toEqual({
      ...externallyUpdatedUser.settings,
      themeMode: 'dark'
    });
    expect(onUserUpdate).toHaveBeenCalledWith(expect.objectContaining({
      settings: expect.objectContaining({
        themeMode: 'dark',
        lastSeenReleaseNotesVersion: '3.5.11'
      })
    }));
  });

  test('keeps newer parent settings after saving only a custom source', async () => {
    let resolveAddSource;
    const source = {
      id: 'source-1',
      name: 'Example Feed',
      url: 'https://example.com/feed.xml',
      language: 'en'
    };
    addUserSource.mockImplementationOnce(() => new Promise((resolve) => { resolveAddSource = resolve; }));
    const onUserUpdate = vi.fn();
    const { result, rerender } = renderHook(({ currentUser }) => useSettingsPanelState({
      currentUser,
      availableSources: [],
      onUserUpdate
    }), { initialProps: { currentUser: baseCurrentUser } });
    let save;

    act(() => {
      result.current.setSourceForm({ url: source.url });
    });
    act(() => {
      save = result.current.handleSave();
    });

    const externallyUpdatedUser = {
      ...baseCurrentUser,
      settings: {
        ...baseCurrentUser.settings,
        lastSeenReleaseNotesVersion: '3.5.11'
      }
    };
    rerender({ currentUser: externallyUpdatedUser });

    await act(async () => {
      resolveAddSource({ source });
      await save;
    });

    expect(result.current.settings.lastSeenReleaseNotesVersion).toBe('3.5.11');
    expect(onUserUpdate).toHaveBeenLastCalledWith(expect.objectContaining({
      settings: expect.objectContaining({ lastSeenReleaseNotesVersion: '3.5.11' }),
      customSources: [source]
    }));
  });

  test('persists positive source visibility through exclusion settings', async () => {
    const source = {
      id: 'source-1',
      name: 'Example',
      subSources: [{ id: 'sub-1' }, { id: 'sub-2' }]
    };
    const currentUser = {
      ...baseCurrentUser,
      settings: {
        ...baseCurrentUser.settings,
        excludedSourceIds: [],
        excludedSubSourceIds: ['sub-1']
      }
    };
    const nextSettings = {
      ...currentUser.settings,
      excludedSourceIds: ['source-1'],
      excludedSubSourceIds: []
    };
    const { result } = renderSettingsHook({ currentUser, availableSources: [source] });

    act(() => {
      result.current.toggleExcludedSource(source.id);
    });

    expect(updateUserSettings).not.toHaveBeenCalled();
    expect(result.current.hasUnsavedChanges).toBe(true);

    updateUserSettings.mockResolvedValue({ settings: nextSettings });
    await act(async () => {
      await result.current.handleSave();
    });

    expect(updateUserSettings).toHaveBeenCalledWith({
      excludedSourceIds: ['source-1'],
      excludedSubSourceIds: []
    });
    expect(result.current.settings).toEqual(nextSettings);
  });

  test('hides a parent source when its final visible sub-feed is hidden', async () => {
    const source = {
      id: 'source-1',
      name: 'Example',
      subSources: [{ id: 'sub-1' }, { id: 'sub-2' }]
    };
    const currentUser = {
      ...baseCurrentUser,
      settings: {
        ...baseCurrentUser.settings,
        excludedSourceIds: [],
        excludedSubSourceIds: ['sub-1']
      }
    };
    const nextSettings = {
      ...currentUser.settings,
      excludedSourceIds: ['source-1'],
      excludedSubSourceIds: []
    };
    const { result } = renderSettingsHook({ currentUser, availableSources: [source] });

    act(() => {
      result.current.toggleExcludedSubFeed('sub-2');
    });

    expect(updateUserSettings).not.toHaveBeenCalled();

    updateUserSettings.mockResolvedValue({ settings: nextSettings });
    await act(async () => {
      await result.current.handleSave();
    });

    expect(updateUserSettings).toHaveBeenCalledWith({
      excludedSourceIds: ['source-1'],
      excludedSubSourceIds: []
    });
    expect(result.current.settings).toEqual(nextSettings);
  });

  test('surfaces source add failures near the custom source form', async () => {
    const requestError = new Error('The request timed out. Please try again in a few seconds.');
    addUserSource.mockRejectedValue(requestError);
    const { result } = renderSettingsHook();

    act(() => {
      result.current.setSourceForm({ url: 'https://example.com/rss' });
    });

    await act(async () => {
      await result.current.handleAddSource({ preventDefault: vi.fn() });
    });

    expect(result.current.sourceError).toBe(requestError);
    expect(result.current.customSources).toEqual([]);
  });

  test('updates a custom source immediately', async () => {
    const currentUser = {
      ...baseCurrentUser,
      customSources: [{
        id: 'source-1',
        name: 'Old Feed',
        url: 'https://example.com/rss',
        language: 'en'
      }]
    };
    const updatedSource = {
      id: 'source-1',
      name: 'Updated Feed',
      url: 'https://example.com/new-rss',
      language: 'it'
    };
    updateUserSource.mockResolvedValue({ source: updatedSource });
    const { result, onUserUpdate } = renderSettingsHook({ currentUser });

    act(() => {
      result.current.setSetting('themeMode', 'dark');
      result.current.startEditSource(currentUser.customSources[0]);
      result.current.setEditingSourceForm({
        name: updatedSource.name,
        url: updatedSource.url,
        language: updatedSource.language
      });
    });

    await act(async () => {
      await result.current.handleUpdateSource(updatedSource.id);
    });

    expect(result.current.customSources).toEqual([updatedSource]);
    expect(result.current.settings.themeMode).toBe('dark');
    expect(result.current.hasUnsavedChanges).toBe(true);
    expect(onUserUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ customSources: [updatedSource] }));
  });

  test('cleans a deleted custom source from persisted exclusions', async () => {
    const currentUser = {
      ...baseCurrentUser,
      settings: {
        ...baseCurrentUser.settings,
        excludedSourceIds: ['source-1']
      },
      customSources: [{
        id: 'source-1',
        name: 'Old Feed',
        url: 'https://example.com/rss',
        language: 'en'
      }]
    };
    deleteUserSource.mockResolvedValue({ success: true });
    const { result, onUserUpdate } = renderSettingsHook({ currentUser });

    await act(async () => {
      await result.current.handleDeleteSource('source-1');
    });

    expect(result.current.settings.excludedSourceIds).toEqual([]);
    expect(result.current.customSources).toEqual([]);
    expect(onUserUpdate).toHaveBeenLastCalledWith(expect.objectContaining({
      settings: expect.objectContaining({ excludedSourceIds: [] }),
      customSources: []
    }));
  });
});
