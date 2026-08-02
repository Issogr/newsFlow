export const READER_TEXT_WIDTH_ORDER = ['default', 'wide', 'widest'] as const;
export type ReaderTextWidth = typeof READER_TEXT_WIDTH_ORDER[number];
export const DEFAULT_READER_TEXT_WIDTH: ReaderTextWidth = 'default';

export function normalizeReaderTextWidth(value: unknown): ReaderTextWidth {
  return READER_TEXT_WIDTH_ORDER.includes(value as ReaderTextWidth) ? value as ReaderTextWidth : DEFAULT_READER_TEXT_WIDTH;
}

export const READER_TEXT_WIDTH_LABELS = {
  default: 'readerTextWidthDefault',
  wide: 'readerTextWidthWide',
  widest: 'readerTextWidthWidest'
};

export const READER_TEXT_WIDTH_CLASS_NAMES: Record<ReaderTextWidth, string> = {
  default: 'max-w-[64ch]',
  wide: 'max-w-[72ch]',
  widest: 'max-w-[80ch]'
};
