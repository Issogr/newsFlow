import en from './locales/en';
import it from './locales/it';
import { createTranslator } from './i18n';

describe('i18n catalogs', () => {
  test('keep English and Italian translation keys aligned', () => {
    expect(Object.keys(it).sort()).toEqual(Object.keys(en).sort());
  });

  test('pluralizes the custom source count', () => {
    expect(createTranslator('en')('sourceCount', { count: 1 })).toBe('1 source');
    expect(createTranslator('it')('sourceCount', { count: 2 })).toBe('2 fonti');
  });
});
