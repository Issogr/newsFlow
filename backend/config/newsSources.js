const SOURCE_ICONS = {
  ansa: 'https://www.ansa.it/favicon.ico',
  bbc: 'https://www.bbc.co.uk/favicon.ico',
  fanpage: 'https://www.fanpage.it/favicon.ico',
  guardian: 'https://www.theguardian.com/favicon.ico',
  ilfattoquotidiano: 'https://www.ilfattoquotidiano.it/favicon.ico',
  ilpost: 'https://www.ilpost.it/favicon.ico',
  open: 'https://www.open.online/favicon.ico',
  sole24ore: 'https://www.ilsole24ore.com/favicon.ico',
  theverge: 'https://www.theverge.com/favicon.ico',
  wired: 'https://www.wired.it/favicon.ico'
};

module.exports = [
  { id: 'ansa_home', name: 'ANSA - Home', groupId: 'ansa', groupName: 'ANSA', subSource: 'Home', url: 'https://www.ansa.it/sito/ansait_rss.xml', iconUrl: SOURCE_ICONS.ansa, type: 'rss', language: 'it' },
  { id: 'ansa_mondo', name: 'ANSA - Mondo', groupId: 'ansa', groupName: 'ANSA', subSource: 'Mondo', url: 'https://www.ansa.it/sito/notizie/mondo/mondo_rss.xml', iconUrl: SOURCE_ICONS.ansa, type: 'rss', language: 'it' },
  { id: 'ansa_politica', name: 'ANSA - Politica', groupId: 'ansa', groupName: 'ANSA', subSource: 'Politica', url: 'https://www.ansa.it/sito/notizie/politica/politica_rss.xml', iconUrl: SOURCE_ICONS.ansa, type: 'rss', language: 'it' },
  { id: 'ansa_cultura', name: 'ANSA - Cultura', groupId: 'ansa', groupName: 'ANSA', subSource: 'Cultura', url: 'https://www.ansa.it/sito/notizie/cultura/cultura_rss.xml', iconUrl: SOURCE_ICONS.ansa, type: 'rss', language: 'it' },
  { id: 'ansa_scienza', name: 'ANSA - Scienza', groupId: 'ansa', groupName: 'ANSA', subSource: 'Scienza', url: 'https://www.ansa.it/canale_scienza_tecnica/notizie/scienzaetecnica_rss.xml', iconUrl: SOURCE_ICONS.ansa, type: 'rss', language: 'it' },
  { id: 'ansa_sport', name: 'ANSA - Sport', groupId: 'ansa', groupName: 'ANSA', subSource: 'Sport', url: 'https://www.ansa.it/sito/notizie/sport/sport_rss.xml', iconUrl: SOURCE_ICONS.ansa, type: 'rss', language: 'it' },
  { id: 'sole24ore_economia', name: 'Il Sole 24 Ore - Economia', groupId: 'sole24ore', groupName: 'Il Sole 24 Ore', subSource: 'Economia', url: 'https://www.ilsole24ore.com/rss/economia.xml', iconUrl: SOURCE_ICONS.sole24ore, type: 'rss', language: 'it' },
  { id: 'sole24ore_finanza', name: 'Il Sole 24 Ore - Finanza e Mercati', groupId: 'sole24ore', groupName: 'Il Sole 24 Ore', subSource: 'Finanza e Mercati', url: 'https://www.ilsole24ore.com/rss/finanza.xml', iconUrl: SOURCE_ICONS.sole24ore, type: 'rss', language: 'it' },
  { id: 'ilpost', name: 'Il Post', url: 'https://www.ilpost.it/feed', iconUrl: SOURCE_ICONS.ilpost, type: 'rss', language: 'it' },
  { id: 'open', name: 'Open', url: 'https://www.open.online/feed/', iconUrl: SOURCE_ICONS.open, type: 'rss', language: 'it' },
  { id: 'ilfattoquotidiano', name: 'Il Fatto Quotidiano', url: 'https://www.ilfattoquotidiano.it/feed/', iconUrl: SOURCE_ICONS.ilfattoquotidiano, type: 'rss', language: 'it' },
  { id: 'fanpage', name: 'Fanpage', url: 'https://www.fanpage.it/feed/', iconUrl: SOURCE_ICONS.fanpage, type: 'rss', language: 'it' },
  { id: 'wired_italia', name: 'Wired Italia', url: 'https://www.wired.it/feed/rss', iconUrl: SOURCE_ICONS.wired, type: 'rss', language: 'it' },
  { id: 'bbc_home', name: 'BBC News - Home', groupId: 'bbc', groupName: 'BBC News', subSource: 'Home', url: 'https://feeds.bbci.co.uk/news/rss.xml', iconUrl: SOURCE_ICONS.bbc, type: 'rss', language: 'en' },
  { id: 'bbc_world', name: 'BBC News - World', groupId: 'bbc', groupName: 'BBC News', subSource: 'World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', iconUrl: SOURCE_ICONS.bbc, type: 'rss', language: 'en' },
  { id: 'bbc_business', name: 'BBC News - Business', groupId: 'bbc', groupName: 'BBC News', subSource: 'Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml', iconUrl: SOURCE_ICONS.bbc, type: 'rss', language: 'en' },
  { id: 'bbc_technology', name: 'BBC News - Technology', groupId: 'bbc', groupName: 'BBC News', subSource: 'Technology', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', iconUrl: SOURCE_ICONS.bbc, type: 'rss', language: 'en' },
  { id: 'bbc_science', name: 'BBC News - Science & Environment', groupId: 'bbc', groupName: 'BBC News', subSource: 'Science & Environment', url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml', iconUrl: SOURCE_ICONS.bbc, type: 'rss', language: 'en' },
  { id: 'theverge', name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', iconUrl: SOURCE_ICONS.theverge, type: 'rss', language: 'en' },
  { id: 'guardian_world', name: 'The Guardian - World', groupId: 'guardian', groupName: 'The Guardian', subSource: 'World', url: 'https://www.theguardian.com/world/rss', iconUrl: SOURCE_ICONS.guardian, type: 'rss', language: 'en' },
  { id: 'guardian_business', name: 'The Guardian - Business', groupId: 'guardian', groupName: 'The Guardian', subSource: 'Business', url: 'https://www.theguardian.com/business/rss', iconUrl: SOURCE_ICONS.guardian, type: 'rss', language: 'en' },
  { id: 'guardian_technology', name: 'The Guardian - Technology', groupId: 'guardian', groupName: 'The Guardian', subSource: 'Technology', url: 'https://www.theguardian.com/technology/rss', iconUrl: SOURCE_ICONS.guardian, type: 'rss', language: 'en' }
];
