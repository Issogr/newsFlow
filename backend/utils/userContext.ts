import type { UserSettings } from './types';

function buildUserContext(userId: string | null | undefined, settings: UserSettings = {}) {
  if (!userId) {
    return {
      userId: null,
      excludedSourceIds: [],
      excludedSubSourceIds: [],
    };
  }

  return {
    userId,
    excludedSourceIds: Array.isArray(settings.excludedSourceIds) ? settings.excludedSourceIds : [],
    excludedSubSourceIds: Array.isArray(settings.excludedSubSourceIds) ? settings.excludedSubSourceIds : [],
  };
}

export = {
  buildUserContext,
};
