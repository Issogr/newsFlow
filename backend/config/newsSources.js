module.exports = [
  { id: 'repubblica', name: 'La Repubblica', url: 'https://www.repubblica.it/rss/homepage/rss2.0.xml', type: 'rss', language: 'it' },
  {
    id: 'ansa',
    name: 'Ansa',
    urls: [
      'https://www.ansa.it/sito/ansait_rss.xml',
      'https://www.ansa.it/sito/notizie/cronaca/cronaca_rss.xml',
      'https://www.ansa.it/sito/notizie/politica/politica_rss.xml',
      'https://www.ansa.it/sito/notizie/mondo/mondo_rss.xml',
      'https://www.ansa.it/sito/notizie/topnews/topnews_rss.xml'
    ],
    type: 'multi-rss',
    language: 'it'
  },
  {
    id: 'sole24ore',
    name: 'Il Sole 24 Ore',
    urls: [
      'https://www.ilsole24ore.com/rss/italia.xml',
      'https://www.ilsole24ore.com/rss/mondo.xml',
      'https://www.ilsole24ore.com/rss/finanza.xml',
      'https://www.ilsole24ore.com/rss/economia.xml'
    ],
    type: 'multi-rss',
    language: 'it'
  },
  { id: 'genova24', name: 'Genova24', url: 'https://www.genova24.it/feed', type: 'rss', language: 'it' },
  { id: 'ivgsavona', name: 'IVG Savona', url: 'https://www.ivg.it/?feed=news-news24', type: 'rss', language: 'it' },
  { id: 'savonanews', name: 'Savona News', url: 'https://www.savonanews.it/rss.xml', type: 'rss', language: 'it' },
  { id: 'imperiapost', name: 'ImperiaPost', url: 'https://www.imperiapost.it/feed', type: 'rss', language: 'it' },
  { id: 'bbc', name: 'BBC News', url: 'http://feeds.bbci.co.uk/news/world/rss.xml', type: 'rss', language: 'en' },
  { id: 'guardian', name: 'The Guardian', url: 'https://www.theguardian.com/world/rss', type: 'rss', language: 'en' },
  { id: 'lemonde', name: 'Le Monde', url: 'https://www.lemonde.fr/rss/une.xml', type: 'rss', language: 'fr' }
];
