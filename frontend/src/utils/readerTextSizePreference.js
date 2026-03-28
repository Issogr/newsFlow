import { DEFAULT_READER_TEXT_SIZE, normalizeReaderTextSize } from '../config/readerTextSize';

export const READER_TEXT_SIZE_STORAGE_KEY = 'news-flow-reader-text-size';

export function getStoredReaderTextSizePreference(fallback = DEFAULT_READER_TEXT_SIZE) {
  try {
    return normalizeReaderTextSize(window.localStorage.getItem(READER_TEXT_SIZE_STORAGE_KEY) || fallback);
  } catch {
    return normalizeReaderTextSize(fallback);
  }
}

export function setStoredReaderTextSizePreference(value) {
  const normalizedValue = normalizeReaderTextSize(value);

  try {
    window.localStorage.setItem(READER_TEXT_SIZE_STORAGE_KEY, normalizedValue);
  } catch {
    // ignore storage failures and keep runtime state only
  }

  return normalizedValue;
}
