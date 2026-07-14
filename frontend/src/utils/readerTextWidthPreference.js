import { DEFAULT_READER_TEXT_WIDTH, normalizeReaderTextWidth } from '../config/readerTextWidth';

const READER_TEXT_WIDTH_STORAGE_KEY = 'news-flow-reader-text-width';

export function getStoredReaderTextWidthPreference(fallback = DEFAULT_READER_TEXT_WIDTH) {
  try {
    return normalizeReaderTextWidth(window.localStorage.getItem(READER_TEXT_WIDTH_STORAGE_KEY) || fallback);
  } catch {
    return normalizeReaderTextWidth(fallback);
  }
}

export function setStoredReaderTextWidthPreference(value) {
  const normalizedValue = normalizeReaderTextWidth(value);

  try {
    window.localStorage.setItem(READER_TEXT_WIDTH_STORAGE_KEY, normalizedValue);
  } catch {
    // ignore storage failures and keep runtime state only
  }

  return normalizedValue;
}
