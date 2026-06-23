import en from './locales/en';
import it from './locales/it';

describe('i18n catalogs', () => {
  test('keep English and Italian translation keys aligned', () => {
    expect(Object.keys(it).sort()).toEqual(Object.keys(en).sort());
  });
});
