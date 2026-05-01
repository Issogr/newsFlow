const {
  extractRegistrableDomain,
  getCanonicalSourceId,
  getCanonicalSourceName,
  getConfiguredSourceGroups,
  getSourceAliases,
  getSourceVariantLabel
} = require('./sourceCatalog');

describe('sourceCatalog domain grouping', () => {
  test('extracts registrable domains from feed URLs', () => {
    expect(extractRegistrableDomain('https://feeds.abcnews.com/abcnews/usheadlines')).toBe('abcnews.com');
    expect(extractRegistrableDomain('https://www.bbc.co.uk/news/rss.xml')).toBe('bbc.co.uk');
    expect(extractRegistrableDomain('https://www.ilsole24ore.com/rss/home.xml')).toBe('ilsole24ore.com');
  });

  test('groups configured ABC feeds by registrable domain', () => {
    const abcGroup = getConfiguredSourceGroups().find((group) => group.id === 'abcnews.com');

    expect(abcGroup).toMatchObject({
      id: 'abcnews.com',
      name: 'ABC News',
      iconUrl: 'https://abcnews.go.com/favicon.ico'
    });
    expect(abcGroup.subSources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'abc-us', label: 'US Headlines', iconUrl: 'https://abcnews.go.com/favicon.ico' }),
      expect.objectContaining({ id: 'abc-world', label: 'World' }),
      expect.objectContaining({ id: 'abc-politics', label: 'Politics' })
    ]));
  });

  test('canonicalizes configured source ids and legacy aliases to the domain group', () => {
    expect(getCanonicalSourceId('abc-us', 'ABC News US Headlines')).toBe('abcnews.com');
    expect(getCanonicalSourceName('abc-us', 'ABC News US Headlines')).toBe('ABC News');
    expect(getSourceVariantLabel('abc-world', 'ABC News World')).toBe('World');

    expect(getSourceAliases('ansa.it').ids).toEqual(expect.arrayContaining(['ansa.it', 'ansa', 'ansa_home', 'ansa_mondo']));
  });
});
