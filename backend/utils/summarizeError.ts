function summarizeErrorMessage(error: unknown, maxLength = 220) {
  const rawMessage = error instanceof Error
    ? error.message
    : error && typeof error === 'object' && 'message' in error
      ? error.message
      : 'Unknown error';
  const message = String(rawMessage)
    .replace(/\s+/g, ' ')
    .trim();

  if (message.length <= maxLength) {
    return message;
  }

  return `${message.slice(0, Math.max(0, maxLength - 3))}...`;
}

export = summarizeErrorMessage;
