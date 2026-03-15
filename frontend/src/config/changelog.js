export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.2.3',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'Here is a quick overview of the latest changes in News Flow.',
    items: [
      '✨ Settings are cleaner and easier to use, with clearer sections, better icons, full-screen mobile view, and proper background scroll locking.',
      '🔄 Refresh is easier to understand: new articles stay in sync with what you already loaded, and the refresh button now shows a simple dot when updates are waiting.',
      '👤 The top bar is simpler, with a clearer user menu and a more understandable auto-refresh status.',
      '🧩 Filters are easier to scan, with better chip styling, topic icons, and clearer separation between sources and topics.',
      '📰 News cards are easier to read, with a cleaner layout, localized topic labels, shared topic icons, and a simpler Open article action.'
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Ecco una panoramica rapida delle ultime novita di News Flow.',
    items: [
      '✨ Le impostazioni sono piu chiare e facili da usare, con sezioni meglio organizzate, icone migliori, vista full screen su mobile e corretto blocco dello scroll di sfondo.',
      '🔄 Il refresh e piu facile da capire: le nuove notizie restano allineate a cio che hai gia caricato e il pulsante mostra ora un semplice punto quando ci sono aggiornamenti.',
      '👤 La barra superiore e piu semplice, con un menu utente piu chiaro e uno stato auto refresh piu comprensibile.',
      '🧩 I filtri sono piu facili da leggere, con chip migliori, icone per i topic e una separazione piu chiara tra fonti e topic.',
      '📰 Le news card sono piu leggibili, con layout piu pulito, topic localizzati, icone condivise per i topic e un pulsante Apri articolo piu semplice.'
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
