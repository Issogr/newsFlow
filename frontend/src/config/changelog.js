export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.2.6',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'Here is a quick overview of the latest changes in News Flow.',
    items: [
      '🔐 New accounts now require a real password, with stronger validation on both the frontend and backend.',
      '🧳 Settings export and import now preserve the card image preference correctly during account migrations.',
      '🛡️ News Flow now creates a reserved admin account automatically and logs a one-time setup link when admin access has not been configured yet.',
      '🔗 The admin can now generate one-time password setup links for users, making password resets safer and easier to manage.',
      '📊 The admin account now opens directly into a dedicated dashboard with account management tools instead of the normal news home.',
      '🟢 The admin dashboard now shows online users plus each account\'s last login and latest activity.',
      '🧱 Feed and reader fetches are now much stricter, so oversized or suspicious external responses get blocked earlier instead of dragging the app down.',
      '📚 Loading older news now behaves more reliably even when live updates are arriving at the same time.',
      '⚡ Realtime updates and password checks were tuned to stay lighter during long sessions and busy usage.',
      '🔴 If you keep auto refresh off, the refresh button can now warn you properly again when fresh news is waiting.'
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Ecco una panoramica rapida delle ultime novita di News Flow.',
    items: [
      '🔐 I nuovi account richiedono ora una password reale, con validazione piu solida sia nel frontend sia nel backend.',
      '🧳 L\'esportazione e importazione delle impostazioni ora conserva correttamente la preferenza delle immagini nelle card durante le migrazioni account.',
      '🛡️ News Flow crea ora automaticamente l\'account admin riservato e scrive nei log un link monouso di configurazione quando l\'accesso admin non e ancora impostato.',
      '🔗 L\'admin puo ora generare link monouso per permettere agli utenti di configurare una nuova password in modo piu sicuro e semplice.',
      '📊 L\'account admin si apre ora direttamente in una dashboard dedicata alla gestione account invece della normale home con le notizie.',
      '🟢 La dashboard admin ora mostra gli utenti online, l\'ultimo accesso e l\'ultima attivita di ogni account.',
      '🧱 I recuperi esterni di feed e articoli sono ora molto piu rigidi, cosi risposte sospette o troppo grandi vengono bloccate prima di rallentare l\'app.',
      '📚 Il caricamento delle notizie piu vecchie ora si comporta in modo piu affidabile anche mentre arrivano aggiornamenti live.',
      '⚡ Gli aggiornamenti realtime e i controlli sulle password sono stati alleggeriti per reggere meglio sessioni lunghe e utilizzo intenso.',
      '🔴 Se tieni l\'auto refresh disattivato, il pulsante di aggiornamento torna ora a segnalare correttamente quando ci sono nuove notizie in attesa.'
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
