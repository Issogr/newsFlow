import { readStoredLocale, resolvePreferredLocale } from './i18n';

describe('i18n storage migration', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test('migrates the legacy locale key to the newsflow key', () => {
    window.localStorage.setItem('news-aggregator-locale', 'it');

    expect(readStoredLocale()).toBe('it');
    expect(window.localStorage.getItem('newsflow-locale')).toBe('it');
    expect(window.localStorage.getItem('news-aggregator-locale')).toBeNull();
  });

  test('prefers the migrated stored locale when no explicit preference is set', () => {
    window.localStorage.setItem('news-aggregator-locale', 'it');

    expect(resolvePreferredLocale('auto')).toBe('it');
  });
});
