export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.2.13.2',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '🔄 Feed refreshes are calmer when live updates are paused, so the loading state clears correctly after fresh articles arrive.',
      '🔗 External article links are handled more strictly, avoiding misleading internal app links from malformed feeds.',
      '⚡ The public news API is lighter by default, with source and topic filter metadata available only when requested.',
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '🔄 Gli aggiornamenti del feed sono piu fluidi quando gli aggiornamenti live sono in pausa, con il caricamento che si chiude correttamente dopo l arrivo delle notizie fresche.',
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
