export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.2.8',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'Here is a quick overview of the latest changes in News Flow.',
    items: [
      '🔗 When sharing falls back to clipboard copy on desktop, you now get a small confirmation pill instead of guessing what happened.',
      '🪟 The confirmation now grows directly out of the Share button and slides to the left, so it feels attached to the action instead of appearing as a separate toast.',
      '📰 News cards now place Share in a floating top-right action, while Reader mode and Open article fill the footer row more cleanly.',
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Ecco una panoramica rapida delle ultime novita di News Flow.',
    items: [
      '🔗 Quando la condivisione su desktop usa la copia negli appunti come fallback, ora compare una piccola pill di conferma invece di lasciare il risultato implicito.',
      '🪟 La conferma ora nasce direttamente dal pulsante Share e si apre verso sinistra, cosi resta visivamente collegata all\'azione invece di sembrare un toast separato.',
      '📰 Le news card ora spostano Share in un\'azione flottante in alto a destra, mentre Reader mode e Open article riempiono meglio la riga dei pulsanti in basso.',
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
