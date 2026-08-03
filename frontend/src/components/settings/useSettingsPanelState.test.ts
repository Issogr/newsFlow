import { act, renderHook } from '@testing-library/react';
import useSettingsPanelState from './useSettingsPanelState';
import {
  addUserSource as addUserSourceImplementation,
  createApiToken as createApiTokenImplementation,
  deleteUserSource as deleteUserSourceImplementation,
  revokeApiToken as revokeApiTokenImplementation,
  updateUserSource as updateUserSourceImplementation,
  updateUserSettings as updateUserSettingsImplementation
} from '../../services/api';
import { createTestCurrentUser } from '../../test-utils/currentUser';
import type { CurrentUser, NewsSource, UserSettings } from '../../types';

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

const addUserSource = vi.mocked(addUserSourceImplementation);
const createApiToken = vi.mocked(createApiTokenImplementation);
const deleteUserSource = vi.mocked(deleteUserSourceImplementation);
const revokeApiToken = vi.mocked(revokeApiTokenImplementation);
const updateUserSource = vi.mocked(updateUserSourceImplementation);
const updateUserSettings = vi.mocked(updateUserSettingsImplementation);

const baseCurrentUser = createTestCurrentUser({ user: { id: 'user-1', username: 'alice' } });

const renderSettingsHook = (overrides: { patchSession?: (patch: Partial<CurrentUser>) => void; currentUser?: CurrentUser; availableSources?: NewsSource[] } = {}) => {
  const patchSession = overrides.patchSession || vi.fn<(patch: Partial<CurrentUser>) => void>();
  const result = renderHook(() => useSettingsPanelState({
    currentUser: overrides.currentUser || baseCurrentUser,
    availableSources: overrides.availableSources || [],
    patchSession
  }));

  return { ...result, patchSession };
};

describe('useSettingsPanelState', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test('keeps a changed setting local until save', async () => {
    const nextSettings: UserSettings = { ...baseCurrentUser.settings, defaultLanguage: 'it' };
    updateUserSettings.mockResolvedValue({ settings: nextSettings });
    const { result, patchSession } = renderSettingsHook();

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
    expect(patchSession).toHaveBeenCalledWith(expect.objectContaining({ settings: nextSettings }));
  });

  test('persists reader text width locally after save', async () => {
    const nextSettings: UserSettings = { ...baseCurrentUser.settings, readerTextWidth: 'wide' };
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
    const patchSession = vi.fn();
    const { result, rerender } = renderHook(({ currentUser }) => useSettingsPanelState({
      currentUser,
      availableSources: [],
      patchSession
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
    expect(patchSession).toHaveBeenCalledWith(expect.objectContaining({
      settings: expect.objectContaining({
        themeMode: 'dark',
        lastSeenReleaseNotesVersion: '3.5.11'
      })
    }));
  });

  test('keeps newer parent settings after saving only a custom source', async () => {
    let resolveAddSource!: (value: { source: NewsSource }) => void;
    const source: NewsSource = {
      id: 'source-1',
      name: 'Example Feed',
      url: 'https://example.com/feed.xml',
      language: 'en'
    };
    addUserSource.mockImplementationOnce(() => new Promise((resolve) => { resolveAddSource = resolve; }));
    const patchSession = vi.fn();
    const { result, rerender } = renderHook(({ currentUser }) => useSettingsPanelState({
      currentUser,
      availableSources: [],
      patchSession
    }), { initialProps: { currentUser: baseCurrentUser } });
    let save!: Promise<string[]>;
    act(() => {
      save = result.current.handleAddDiscoveredSources([source.url!]);
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
    expect(patchSession).toHaveBeenLastCalledWith({ customSources: [source] });
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

  test('keeps successful discovered feeds when a later selected feed fails', async () => {
    const firstSource = {
      id: 'source-1',
      name: 'First feed',
      url: 'https://example.com/first.xml',
      language: 'en'
    };
    const requestError = new Error('Second feed failed validation');
    addUserSource
      .mockResolvedValueOnce({ source: firstSource })
      .mockRejectedValueOnce(requestError);
    const { result, patchSession } = renderSettingsHook();
    let addedUrls: string[] = [];

    await act(async () => {
      addedUrls = await result.current.handleAddDiscoveredSources([
        firstSource.url,
        'https://example.com/second.xml'
      ]);
    });

    expect(addedUrls).toEqual([firstSource.url]);
    expect(result.current.customSources).toEqual([firstSource]);
    expect(result.current.sourceError).toBe(requestError);
    expect(patchSession).toHaveBeenLastCalledWith({ customSources: [firstSource] });
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
    const { result, patchSession } = renderSettingsHook({ currentUser });

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
    expect(patchSession).toHaveBeenLastCalledWith({ customSources: [updatedSource] });
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
    const { result, patchSession } = renderSettingsHook({ currentUser });

    await act(async () => {
      await result.current.handleDeleteSource('source-1');
    });

    expect(result.current.settings.excludedSourceIds).toEqual([]);
    expect(result.current.customSources).toEqual([]);
    expect(patchSession).toHaveBeenLastCalledWith(expect.objectContaining({
      settings: expect.objectContaining({ excludedSourceIds: [] }),
      customSources: []
    }));
  });

  test('patches only API token session state when creating and revoking a token', async () => {
    const tokenInfo = { id: 'token-1', expiresAt: '2026-09-01T00:00:00.000Z' };
    createApiToken.mockResolvedValue({ token: 'raw-token', tokenInfo });
    revokeApiToken.mockResolvedValue({ success: true });
    const { result, patchSession } = renderSettingsHook();

    await act(async () => {
      await result.current.handleCreateApiToken();
    });

    expect(result.current.apiToken).toEqual(tokenInfo);
    expect(result.current.newApiToken).toBe('raw-token');
    expect(patchSession).toHaveBeenLastCalledWith({ apiToken: tokenInfo });

    await act(async () => {
      await result.current.handleRevokeApiToken();
    });

    expect(result.current.apiToken).toBeNull();
    expect(result.current.newApiToken).toBe('');
    expect(patchSession).toHaveBeenLastCalledWith({ apiToken: null });
  });
});
