function toValidDate(value, fallback = new Date()) {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value || fallback);
  return Number.isNaN(parsed.getTime()) ? new Date(fallback) : parsed;
}

function getCurrentPublicationDay(referenceDate = new Date()) {
  const reference = toValidDate(referenceDate);
  return new Date(Date.UTC(
    reference.getUTCFullYear(),
    reference.getUTCMonth(),
    reference.getUTCDate(),
    0,
    0,
    0,
    0
  ));
}

function normalizePublicationDate(value, referenceDate = new Date()) {
  const reference = toValidDate(referenceDate);
  const parsed = toValidDate(value, reference);

  if (parsed.getTime() > reference.getTime()) {
    return getCurrentPublicationDay(reference).toISOString();
  }

  return parsed.toISOString();
}

module.exports = {
  getCurrentPublicationDay,
  normalizePublicationDate
};
