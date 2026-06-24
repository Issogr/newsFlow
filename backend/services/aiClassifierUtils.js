function chunkItems(items = [], size = 1) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function isTimeoutError(error) {
  const name = String(error?.name || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return name.includes('timeout') || message.includes('aborted due to timeout') || message.includes('timeout');
}

function getClassifierEntryId(entry = {}) {
  return String(entry.id || entry.articleId || entry.article_id || '').trim();
}

function getClassifierEntryRef(entry = {}) {
  const rawRef = entry.ref ?? entry.articleRef ?? entry.article_ref ?? entry.index;
  return String(rawRef || '').trim();
}

function resolveClassifierEntryId(entry = {}, allowedIds = new Set(), refToArticleId = null) {
  const id = getClassifierEntryId(entry);
  if (id && allowedIds.has(id)) {
    return id;
  }

  const ref = getClassifierEntryRef(entry);
  const mappedId = refToArticleId?.get(ref);
  return mappedId && allowedIds.has(mappedId) ? mappedId : '';
}

function summarizeResponseShape(response = {}, options = {}) {
  const choice = response.choices?.[0] || {};
  const message = choice.message || {};
  const messageKeys = Object.keys(message).sort().join(',') || 'none';
  const contentType = Array.isArray(message.content) ? 'array' : typeof message.content;
  const finishReason = choice.finishReason || choice.finish_reason || 'unknown';
  const baseSummary = `finishReason=${finishReason}, messageKeys=${messageKeys}, contentType=${contentType}`;

  if (!options.includeReasoningStats) {
    return baseSummary;
  }

  const reasoningChars = String(message.reasoning || '').length;
  const refusalChars = String(message.refusal || '').length;
  return `${baseSummary}, reasoningChars=${reasoningChars}, refusalChars=${refusalChars}`;
}

module.exports = {
  chunkItems,
  isTimeoutError,
  resolveClassifierEntryId,
  summarizeResponseShape,
};
