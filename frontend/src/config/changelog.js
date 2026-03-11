export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.2.1',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'Here is a quick overview of the latest changes in News Flow.',
    items: [
      '🔄 Simpler refresh flow: the old notification center is gone, replaced by a clearer refresh button with live-update status and new-article count.',
      '👤 Cleaner top bar and user menu: connection status and language switcher moved into the user menu, with a better mobile layout.',
      '📚 Reader mode is more flexible: you can now choose the reader panel position on desktop (left, center, or right).',
      '📰 News cards are cleaner: less visual noise, with timestamps moved into a more readable position.',
      '🛠️ Filters now start collapsed by default for a tidier first load.',
      '🚫 Similar-article merging is temporarily disabled to reduce false positives.',
      '✅ Real-time new-article counting is now more reliable and less prone to inflated totals.',
      '🎉 Added a localized What\'s new popup after updates, with changelog access from settings.'
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Ecco una panoramica rapida delle ultime novita di News Flow.',
    items: [
      '🔄 Refresh piu semplice: il vecchio centro notifiche e stato rimosso e sostituito da un pulsante di refresh piu chiaro, con stato live e conteggio dei nuovi articoli.',
      '👤 Top bar e menu utente piu puliti: stato connessione e selettore lingua sono stati spostati nel menu utente, con un layout mobile migliore.',
      '📚 Modalita lettura piu flessibile: ora puoi scegliere la posizione del pannello su desktop (sinistra, centro o destra).',
      '📰 Card notizie piu pulite: meno elementi visivi superflui e timestamp spostato in una posizione piu leggibile.',
      '🛠️ I filtri ora partono chiusi di default per una prima apertura piu ordinata.',
      '🚫 Il merge degli articoli simili e temporaneamente disattivato per ridurre i falsi positivi.',
      '✅ Il conteggio real-time dei nuovi articoli e ora piu affidabile e meno soggetto a numeri gonfiati.',
      '🎉 Aggiunto un popup localizzato con le novita dopo gli aggiornamenti, riapribile dalle impostazioni.'
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
