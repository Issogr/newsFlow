export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.2.13.2',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '🎨 Topic colors now use a softer pastel palette while staying distinct enough to recognize each category at a glance.',
      '✨ A new pill above the feed shows how many fresh articles are waiting, without auto-loading them into the list.',
      '✨ The header stays cleaner while news loads: the app logo no longer shows the extra spinning reload badge.',
      '🔄 Feed updates are now fully manual: use the top refresh button when you want to fetch fresh articles.',
      '✨ AI topic labels can still appear automatically after classification finishes, without fetching RSS sources again.',
      '✨ AI topic updates now keep the extra articles you already loaded with Load more.',
      '🔗 External article links are handled more strictly, avoiding misleading internal app links from malformed feeds.',
      '⚡ The public news API is lighter by default, with source and topic filter metadata available only when requested.',
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '🎨 I colori degli argomenti ora usano una palette pastello piu morbida, restando abbastanza distinti da riconoscere subito ogni categoria.',
      '✨ Un nuovo pill sopra il feed mostra quante notizie fresche ti aspettano, senza caricarle automaticamente nella lista.',
      '✨ L intestazione resta piu pulita durante il caricamento: il logo dell app non mostra piu il piccolo badge di aggiornamento in rotazione.',
      '🔄 Gli aggiornamenti del feed ora sono completamente manuali: usa il pulsante in alto quando vuoi recuperare nuove notizie.',
      '✨ Le etichette AI degli argomenti possono comunque comparire automaticamente dopo la classificazione, senza recuperare di nuovo le fonti RSS.',
      '✨ Gli aggiornamenti degli argomenti AI mantengono le notizie extra gia caricate con Carica altro.',
      '🔗 I link esterni degli articoli sono gestiti in modo piu rigoroso, evitando collegamenti interni fuorvianti da feed non corretti.',
      '⚡ L API pubblica delle notizie e piu leggera di default, con metadati per fonti e argomenti disponibili solo su richiesta.',
    ]
  }
};

export function getCurrentChangelog(locale = 'en') {
  const localizedEntry = CURRENT_CHANGELOG_ENTRY[locale] || CURRENT_CHANGELOG_ENTRY.en;

  return {
    version: CURRENT_CHANGELOG_ENTRY.version,
    ...localizedEntry
  };
}
