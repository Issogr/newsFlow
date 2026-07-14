export const READER_TEXT_WIDTH_ORDER = ['default', 'wide', 'widest'];
export const DEFAULT_READER_TEXT_WIDTH = 'default';

export function normalizeReaderTextWidth(value) {
  return READER_TEXT_WIDTH_ORDER.includes(value) ? value : DEFAULT_READER_TEXT_WIDTH;
}

export const READER_TEXT_WIDTH_LABELS = {
  default: 'readerTextWidthDefault',
  wide: 'readerTextWidthWide',
  widest: 'readerTextWidthWidest'
};

export const READER_TEXT_WIDTH_CLASS_NAMES = {
  default: 'max-w-[64ch]',
  wide: 'max-w-[72ch]',
  widest: 'max-w-[80ch]'
};
