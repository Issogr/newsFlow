function buildUserContext(userId, settings = {}) {
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

module.exports = {
  buildUserContext,
};
