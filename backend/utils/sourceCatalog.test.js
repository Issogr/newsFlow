const {
  extractRegistrableDomain,
  getCanonicalSourceId,
  getCanonicalSourceName,
  getConfiguredSourceGroups,
  getSourceAliases,
  getSourceVariantLabel
} = require('./sourceCatalog');
const configuredSources = require('../config/newsSources');

describe('sourceCatalog domain grouping', () => {
  test('extracts registrable domains from feed URLs', () => {
    expect(extractRegistrableDomain('https://feeds.bbci.co.uk/news/rss.xml')).toBe('bbci.co.uk');
    expect(extractRegistrableDomain('https://www.bbc.co.uk/news/rss.xml')).toBe('bbc.co.uk');
    expect(extractRegistrableDomain('https://www.ilsole24ore.com/rss/home.xml')).toBe('ilsole24ore.com');
  });

  test('groups configured BBC feeds by registrable domain', () => {
    const bbcGroup = getConfiguredSourceGroups().find((group) => group.id === 'bbci.co.uk');

    expect(bbcGroup).toMatchObject({
      id: 'bbci.co.uk',
      name: 'BBC News',
      iconUrl: 'https://www.bbc.co.uk/favicon.ico'
    });
    expect(bbcGroup.subSources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'bbc_home', label: 'Home', iconUrl: 'https://www.bbc.co.uk/favicon.ico' }),
      expect.objectContaining({ id: 'bbc_world', label: 'World' }),
      expect.objectContaining({ id: 'bbc_technology', label: 'Technology' })
    ]));
  });

  test('canonicalizes configured source ids and legacy aliases to the domain group', () => {
    expect(getCanonicalSourceId('bbc_home', 'BBC News - Home')).toBe('bbci.co.uk');
    expect(getCanonicalSourceName('bbc_home', 'BBC News - Home')).toBe('BBC News');
    expect(getSourceVariantLabel('bbc_world', 'BBC News - World')).toBe('World');

    expect(getSourceAliases('ansa.it').ids).toEqual(expect.arrayContaining(['ansa.it', 'ansa', 'ansa_home', 'ansa_mondo']));
  });

  test('uses the Il Post feed URL that serves RSS without a 403', () => {
    expect(configuredSources.find((source) => source.id === 'ilpost')?.url).toBe('https://www.ilpost.it/feed');
  });
});
