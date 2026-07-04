import { act, renderHook } from '@testing-library/react';
import useSettingsPanelState from './useSettingsPanelState';
import {
  addUserSource,
  createApiToken,
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

describe('useSettingsPanelState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('keeps unsaved settings local through a source add and parent rerender', async () => {
    const onUserUpdate = vi.fn();
    const source = {
      id: 'source-1',
      name: 'Example Feed',
      url: 'https://example.com/rss',
      language: 'en'
    };

    addUserSource.mockResolvedValue({ source });

    const { result, rerender } = renderHook(({ currentUser }) => useSettingsPanelState({
      currentUser,
      availableSources: [],
      onClose: vi.fn(),
      onUserUpdate
    }), { initialProps: { currentUser: baseCurrentUser } });

    act(() => {
      result.current.setSetting('defaultLanguage', 'it');
      result.current.setSourceForm({ url: source.url });
    });

    await act(async () => {
      await result.current.handleAddSource({ preventDefault: vi.fn() });
    });

    expect(result.current.settings.defaultLanguage).toBe('it');
    expect(result.current.customSources).toEqual([source]);
    expect(onUserUpdate).toHaveBeenLastCalledWith(expect.objectContaining({
      settings: expect.objectContaining({ defaultLanguage: 'en' }),
      customSources: [source]
    }));

    rerender({ currentUser: onUserUpdate.mock.calls.at(-1)[0] });

    expect(result.current.settings.defaultLanguage).toBe('it');
    expect(result.current.customSources).toEqual([source]);
  });

  test('keeps unsaved settings after parent rerenders from token changes', async () => {
    const onUserUpdate = vi.fn();
    createApiToken.mockResolvedValue({
      token: 'raw-token',
      tokenInfo: { tokenPrefix: 'raw-token', expiresAt: '2026-01-01T00:00:00.000Z' }
    });

    const { result, rerender } = renderHook(({ currentUser }) => useSettingsPanelState({
      currentUser,
      availableSources: [],
      onClose: vi.fn(),
      onUserUpdate
    }), { initialProps: { currentUser: baseCurrentUser } });

    act(() => {
      result.current.setSetting('defaultLanguage', 'it');
    });

    await act(async () => {
      await result.current.handleCreateApiToken();
    });

    rerender({ currentUser: onUserUpdate.mock.calls.at(-1)[0] });

    expect(result.current.settings.defaultLanguage).toBe('it');
    expect(result.current.apiToken).toEqual({ tokenPrefix: 'raw-token', expiresAt: '2026-01-01T00:00:00.000Z' });
    expect(result.current.newApiToken).toBe('raw-token');
  });

  test('does not overwrite same-user settings updates for untouched fields', async () => {
    const onClose = vi.fn();
    const onUserUpdate = vi.fn();
    const initialUser = {
      ...baseCurrentUser,
      settings: {
        ...baseCurrentUser.settings,
        lastSeenReleaseNotesVersion: '3.5.2'
      }
    };
    const updatedUser = {
      ...initialUser,
      settings: {
        ...initialUser.settings,
        lastSeenReleaseNotesVersion: '3.5.3'
      }
    };
    updateUserSettings.mockResolvedValue({
      settings: {
        ...updatedUser.settings,
        themeMode: 'dark'
      }
    });

    const { result, rerender } = renderHook(({ currentUser }) => useSettingsPanelState({
      currentUser,
      availableSources: [],
      onClose,
      onUserUpdate
    }), { initialProps: { currentUser: initialUser } });

    rerender({ currentUser: updatedUser });

    expect(result.current.settings.lastSeenReleaseNotesVersion).toBe('3.5.3');

    act(() => {
      result.current.setSetting('themeMode', 'dark');
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(updateUserSettings).toHaveBeenCalledWith({ themeMode: 'dark' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('surfaces source add failures near the custom source form', async () => {
    const requestError = new Error('The request timed out. Please try again in a few seconds.');
    addUserSource.mockRejectedValue(requestError);

    const { result } = renderHook(() => useSettingsPanelState({
      currentUser: baseCurrentUser,
      availableSources: [],
      onClose: vi.fn(),
      onUserUpdate: vi.fn()
    }));

    act(() => {
      result.current.setSourceForm({ url: 'https://example.com/rss' });
    });

    await act(async () => {
      await result.current.handleAddSource({ preventDefault: vi.fn() });
    });

    expect(result.current.sourceError).toBe(requestError);
    expect(result.current.customSources).toEqual([]);
  });

  test('keeps unsaved settings local when updating a source', async () => {
    const onUserUpdate = vi.fn();
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

    const { result } = renderHook(() => useSettingsPanelState({
      currentUser,
      availableSources: [],
      onClose: vi.fn(),
      onUserUpdate
    }));

    act(() => {
      result.current.setSetting('defaultLanguage', 'it');
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

    expect(result.current.settings.defaultLanguage).toBe('it');
    expect(result.current.customSources).toEqual([updatedSource]);
    expect(onUserUpdate).toHaveBeenLastCalledWith(expect.objectContaining({
      settings: expect.objectContaining({ defaultLanguage: 'en' }),
      customSources: [updatedSource]
    }));
  });

  test('cleans deleted source from the local draft without leaking other draft settings', async () => {
    const onUserUpdate = vi.fn();
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

    const { result } = renderHook(() => useSettingsPanelState({
      currentUser,
      availableSources: [],
      onClose: vi.fn(),
      onUserUpdate
    }));

    act(() => {
      result.current.setSetting('defaultLanguage', 'it');
    });

    await act(async () => {
      await result.current.handleDeleteSource('source-1');
    });

    expect(result.current.settings.defaultLanguage).toBe('it');
    expect(result.current.settings.excludedSourceIds).toEqual([]);
    expect(result.current.customSources).toEqual([]);
    expect(onUserUpdate).toHaveBeenLastCalledWith(expect.objectContaining({
      settings: expect.objectContaining({ defaultLanguage: 'en', excludedSourceIds: [] }),
      customSources: []
    }));
  });

  test('saves only changed settings to avoid stale full-snapshot overwrites', async () => {
    const onClose = vi.fn();
    const onUserUpdate = vi.fn();
    updateUserSettings.mockResolvedValue({
      settings: {
        ...baseCurrentUser.settings,
        defaultLanguage: 'it'
      }
    });

    const { result } = renderHook(() => useSettingsPanelState({
      currentUser: baseCurrentUser,
      availableSources: [],
      onClose,
      onUserUpdate
    }));

    act(() => {
      result.current.setSetting('defaultLanguage', 'it');
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(updateUserSettings).toHaveBeenCalledWith({ defaultLanguage: 'it' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
