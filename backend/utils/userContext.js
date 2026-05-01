function buildUserContext(userId, settings = {}) {
  if (!userId) {
    return {
      userId: null,
      articleRetentionHours: null,
      excludedSourceIds: [],
      excludedSubSourceIds: [],
    };
  }

  return {
    userId,
    articleRetentionHours: settings.articleRetentionHours,
    excludedSourceIds: Array.isArray(settings.excludedSourceIds) ? settings.excludedSourceIds : [],
    excludedSubSourceIds: Array.isArray(settings.excludedSubSourceIds) ? settings.excludedSubSourceIds : [],
    settings,
  };
}

module.exports = {
  buildUserContext,
};
