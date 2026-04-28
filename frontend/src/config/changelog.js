export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.2.13.2',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '📖 Reader mode now includes a retry button beside the text-size controls, and GitHub project links now use the GitHub icon instead of a generic link icon.',
      '🎨 The interface feels calmer and clearer, with softer topic colors, a new pill that counts waiting articles, and a cleaner header without the spinning logo reload badge.',
      '🔄 Feed fetching is now fully manual from the top refresh button, while AI topic labels can still appear automatically afterward without re-fetching RSS sources and without collapsing the extra items you loaded with Load more.',
      '🔗 External article links are handled more strictly, avoiding misleading internal app links from malformed feeds.',
      '⚡ The public news API is lighter by default, with source and topic filter metadata available only when requested.',
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '📖 La modalita lettura ora include un pulsante per riprovare accanto ai controlli della dimensione del testo, e i link di progetto verso GitHub ora usano l icona GitHub invece di una generica icona link.',
      '🎨 L interfaccia e piu calma e chiara, con colori argomento piu morbidi, un nuovo pill che conta le notizie in attesa e un intestazione piu pulita senza il badge di aggiornamento in rotazione sul logo.',
      '🔄 Il recupero del feed ora e completamente manuale dal pulsante di aggiornamento in alto, mentre le etichette AI degli argomenti possono comunque comparire automaticamente dopo la classificazione senza recuperare di nuovo le fonti RSS e senza perdere le notizie extra gia caricate con Carica altro.',
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
