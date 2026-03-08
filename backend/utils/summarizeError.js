function summarizeErrorMessage(error, maxLength = 220) {
  const message = String(error?.message || 'Unknown error')
    .replace(/\s+/g, ' ')
    .trim();

  if (message.length <= maxLength) {
    return message;
  }

  return `${message.slice(0, Math.max(0, maxLength - 3))}...`;
}

module.exports = summarizeErrorMessage;
