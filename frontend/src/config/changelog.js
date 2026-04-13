export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.2.9.3',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'Here is a quick overview of the latest changes in News Flow.',
    items: [
      '🍪 Sessions now stay in a safer server-managed cookie instead of browser storage, so signing in is more resilient against token theft from the page context.',
      '🔑 Password setup links now keep their secret token in the URL fragment instead of the query string, reducing accidental leakage through logs and shared links.',
      '🛡️ Login, registration, and password setup now have stricter request throttling, making repeated auth attempts harder to abuse.',
      '🧹 Sensitive auth values are now redacted from server logs, and the admin bootstrap flow no longer prints the full setup link on startup.',
      '🔐 The app now blocks inline scripts through a tighter security policy, improving protection if unsafe browser-side content is ever introduced later.',
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Ecco una panoramica rapida delle ultime novita di News Flow.',
    items: [
      '🍪 Le sessioni ora restano in un cookie gestito dal server invece che nello storage del browser, cosi l\'accesso e piu protetto contro il furto di token dal contesto pagina.',
      '🔑 I link per impostare la password ora tengono il token segreto nel frammento dell\'URL invece che nella query, riducendo le perdite accidentali nei log e nei link condivisi.',
      '🛡️ Login, registrazione e impostazione password ora hanno limiti piu stretti sulle richieste, cosi gli abusi ripetuti contro l\'autenticazione diventano piu difficili.',
      '🧹 I valori sensibili legati all\'autenticazione ora vengono mascherati nei log del server e il bootstrap admin non stampa piu il link completo all\'avvio.',
      '🔐 L\'app ora blocca gli script inline con una policy di sicurezza piu stretta, migliorando la protezione se in futuro dovesse comparire contenuto browser-side non sicuro.',
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
