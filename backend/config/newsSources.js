const SOURCE_ICONS = {
  abc: 'https://abcnews.go.com/favicon.ico',
  ansa: 'https://www.ansa.it/favicon.ico',
  genova24: 'https://www.genova24.it/favicon.ico',
  imperiapost: 'https://imperiapost.it/wp-content/uploads/2016/11/logo-imperiapost.jpg',
  ivgsavona: 'https://www.ivg.it/favicon.ico',
  repubblica: 'https://www.repubblica.it/favicon.ico',
  sole24ore: 'https://www.ilsole24ore.com/favicon.ico'
};

module.exports = [
  { id: 'repubblica', name: 'La Repubblica', url: 'https://www.repubblica.it/rss/homepage/rss2.0.xml', iconUrl: SOURCE_ICONS.repubblica, type: 'rss', language: 'it' },
  { id: 'ansa_home', name: 'ANSA - Home', groupId: 'ansa', groupName: 'ANSA', subSource: 'Home', url: 'https://www.ansa.it/sito/ansait_rss.xml', iconUrl: SOURCE_ICONS.ansa, type: 'rss', language: 'it' },
  { id: 'ansa_mondo', name: 'ANSA - Mondo', groupId: 'ansa', groupName: 'ANSA', subSource: 'Mondo', url: 'https://www.ansa.it/sito/notizie/mondo/mondo_rss.xml', iconUrl: SOURCE_ICONS.ansa, type: 'rss', language: 'it' },
  { id: 'ansa_politica', name: 'ANSA - Politica', groupId: 'ansa', groupName: 'ANSA', subSource: 'Politica', url: 'https://www.ansa.it/sito/notizie/politica/politica_rss.xml', iconUrl: SOURCE_ICONS.ansa, type: 'rss', language: 'it' },
  { id: 'ansa_cultura', name: 'ANSA - Cultura', groupId: 'ansa', groupName: 'ANSA', subSource: 'Cultura', url: 'https://www.ansa.it/sito/notizie/cultura/cultura_rss.xml', iconUrl: SOURCE_ICONS.ansa, type: 'rss', language: 'it' },
  { id: 'ansa_scienza', name: 'ANSA - Scienza', groupId: 'ansa', groupName: 'ANSA', subSource: 'Scienza', url: 'https://www.ansa.it/canale_scienza_tecnica/notizie/scienzaetecnica_rss.xml', iconUrl: SOURCE_ICONS.ansa, type: 'rss', language: 'it' },
  { id: 'ansa_sport', name: 'ANSA - Sport', groupId: 'ansa', groupName: 'ANSA', subSource: 'Sport', url: 'https://www.ansa.it/sito/notizie/sport/sport_rss.xml', iconUrl: SOURCE_ICONS.ansa, type: 'rss', language: 'it' },
  { id: 'sole24ore_economia', name: 'Il Sole 24 Ore - Economia', groupId: 'sole24ore', groupName: 'Il Sole 24 Ore', subSource: 'Economia', url: 'https://www.ilsole24ore.com/rss/economia.xml', iconUrl: SOURCE_ICONS.sole24ore, type: 'rss', language: 'it' },
  { id: 'sole24ore_finanza', name: 'Il Sole 24 Ore - Finanza e Mercati', groupId: 'sole24ore', groupName: 'Il Sole 24 Ore', subSource: 'Finanza e Mercati', url: 'https://www.ilsole24ore.com/rss/finanza.xml', iconUrl: SOURCE_ICONS.sole24ore, type: 'rss', language: 'it' },
  { id: 'sole24ore_italia', name: 'Il Sole 24 Ore - Italia', groupId: 'sole24ore', groupName: 'Il Sole 24 Ore', subSource: 'Italia', url: 'https://www.ilsole24ore.com/rss/italia.xml', iconUrl: SOURCE_ICONS.sole24ore, type: 'rss', language: 'it' },
  { id: 'sole24ore_mondo', name: 'Il Sole 24 Ore - Mondo', groupId: 'sole24ore', groupName: 'Il Sole 24 Ore', subSource: 'Mondo', url: 'https://www.ilsole24ore.com/rss/mondo.xml', iconUrl: SOURCE_ICONS.sole24ore, type: 'rss', language: 'it' },
  { id: 'genova24', name: 'Genova24', url: 'https://www.genova24.it/feed', iconUrl: SOURCE_ICONS.genova24, type: 'rss', language: 'it' },
  { id: 'ivgsavona', name: 'IVG Savona', url: 'https://www.ivg.it/?feed=news-news24', iconUrl: SOURCE_ICONS.ivgsavona, type: 'rss', language: 'it' },
  { id: 'imperiapost', name: 'ImperiaPost', url: 'https://www.imperiapost.it/feed', iconUrl: SOURCE_ICONS.imperiapost, type: 'rss', language: 'it' },
  { id: 'abc-us', name: 'ABC News US Headlines', url: 'http://feeds.abcnews.com/abcnews/usheadlines', iconUrl: SOURCE_ICONS.abc, type: 'rss', language: 'en' },
  { id: 'abc-world', name: 'ABC News World', url: 'http://feeds.abcnews.com/abcnews/internationalheadlines', iconUrl: SOURCE_ICONS.abc, type: 'rss', language: 'en' },
  { id: 'abc-politics', name: 'ABC News Politics', url: 'http://feeds.abcnews.com/abcnews/politicsheadlines', iconUrl: SOURCE_ICONS.abc, type: 'rss', language: 'en' }
];
