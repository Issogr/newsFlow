import { DEFAULT_READER_TEXT_SIZE, normalizeReaderTextSize } from '../config/readerTextSize';
import { DEFAULT_READER_TEXT_WIDTH, normalizeReaderTextWidth } from '../config/readerTextWidth';

const READER_TEXT_SIZE_STORAGE_KEY = 'news-flow-reader-text-size';
const READER_TEXT_WIDTH_STORAGE_KEY = 'news-flow-reader-text-width';

function getStoredPreference<T extends string>(key: string, fallback: unknown, normalize: (value: unknown) => T): T {
  try {
    return normalize(window.localStorage.getItem(key) || fallback);
  } catch {
    return normalize(fallback);
  }
}

function setStoredPreference<T extends string>(key: string, value: unknown, normalize: (value: unknown) => T): T {
  const normalizedValue = normalize(value);

  try {
    window.localStorage.setItem(key, normalizedValue);
  } catch {
    // ignore storage failures and keep runtime state only
  }

  return normalizedValue;
}

export const getStoredReaderTextSizePreference = (fallback = DEFAULT_READER_TEXT_SIZE) => (
  getStoredPreference(READER_TEXT_SIZE_STORAGE_KEY, fallback, normalizeReaderTextSize)
);

export const setStoredReaderTextSizePreference = (value: unknown) => (
  setStoredPreference(READER_TEXT_SIZE_STORAGE_KEY, value, normalizeReaderTextSize)
);

export const getStoredReaderTextWidthPreference = (fallback = DEFAULT_READER_TEXT_WIDTH) => (
  getStoredPreference(READER_TEXT_WIDTH_STORAGE_KEY, fallback, normalizeReaderTextWidth)
);

export const setStoredReaderTextWidthPreference = (value: unknown) => (
  setStoredPreference(READER_TEXT_WIDTH_STORAGE_KEY, value, normalizeReaderTextWidth)
);
