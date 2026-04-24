function parseCsvParam(value) {
  if (!value) {
    return [];
  }

  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseNewsQuery(query = {}) {
  return {
    search: query.search || '',
    sourceIds: parseCsvParam(query.sources),
    topics: parseCsvParam(query.topics),
    recentHours: query.recentHours ? Number(query.recentHours) : null,
    beforePubDate: query.beforePubDate || '',
    beforeId: query.beforeId || '',
    page: query.page ? Number(query.page) : 1,
    pageSize: query.pageSize ? Number(query.pageSize) : 12,
  };
}

module.exports = {
  parseCsvParam,
  parseNewsQuery,
};
