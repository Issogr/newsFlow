export const READER_TEXT_SIZE_ORDER = ['small', 'medium', 'large'];
export const DEFAULT_READER_TEXT_SIZE = 'medium';

export function normalizeReaderTextSize(value) {
  return READER_TEXT_SIZE_ORDER.includes(value) ? value : DEFAULT_READER_TEXT_SIZE;
}

export const READER_TEXT_SIZE_LABELS = {
  small: 'readerTextSizeSmall',
  medium: 'readerTextSizeMedium',
  large: 'readerTextSizeLarge'
};

export const READER_TEXT_SIZE_STYLES = {
  small: {
    paragraph: 'text-[1rem] leading-7 text-stone-800',
    blockquote: 'border-l-4 border-stone-300 bg-stone-50/80 pl-5 pr-2 italic text-[0.98rem] leading-7 text-stone-700',
    preformatted: 'overflow-x-auto rounded-2xl bg-stone-900 px-4 py-4 text-[0.85rem] leading-6 text-stone-100',
    list: 'text-[0.96rem] leading-7 text-stone-800',
    headingLevel1: 'text-xl md:text-2xl',
    headingLevel3: 'text-lg md:text-xl',
    headingOther: 'text-base'
  },
  medium: {
    paragraph: 'text-[1.08rem] leading-8 text-stone-800',
    blockquote: 'border-l-4 border-stone-300 bg-stone-50/80 pl-5 pr-2 italic text-stone-700',
    preformatted: 'overflow-x-auto rounded-2xl bg-stone-900 px-4 py-4 text-sm leading-7 text-stone-100',
    list: 'text-[1.04rem] leading-8 text-stone-800',
    headingLevel1: 'text-2xl md:text-3xl',
    headingLevel3: 'text-xl md:text-2xl',
    headingOther: 'text-lg'
  },
  large: {
    paragraph: 'text-[1.18rem] leading-9 text-stone-800',
    blockquote: 'border-l-4 border-stone-300 bg-stone-50/80 pl-5 pr-2 italic text-[1.08rem] leading-8 text-stone-700',
    preformatted: 'overflow-x-auto rounded-2xl bg-stone-900 px-4 py-4 text-[1rem] leading-7 text-stone-100',
    list: 'text-[1.12rem] leading-9 text-stone-800',
    headingLevel1: 'text-[1.8rem] md:text-[2.25rem]',
    headingLevel3: 'text-[1.35rem] md:text-[1.65rem]',
    headingOther: 'text-xl'
  }
};
