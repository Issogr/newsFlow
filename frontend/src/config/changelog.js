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
      '🧱 Feed and reader fetches are now much stricter, so oversized or suspicious external responses get blocked earlier instead of dragging the app down.',
      '📚 Loading older news now behaves more reliably even when live updates are arriving at the same time.',
      '🔴 If you keep auto refresh off, the refresh button can now warn you properly again when fresh news is waiting.',
      '📌 Search and filters now stay handy while you scroll.',
      '🖼️ Articles without photos now get a cleaner neutral fallback cover instead of feeling visually unfinished.',
      '📤 News cards and reader mode can now share the original article link, including the native share sheet on mobile when available.',
      '📱 Card actions are more compact on mobile, so Reader, Share, and Open fit better without crowding the layout.',
      '📚 Reader mode is calmer now too, with a lighter sticky top bar and simpler article details near the top of the story.',
      '🔠 You can now choose small, medium, or large reader text size, and News Flow remembers the choice for the next time you open reader mode.'
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
      '🧱 I recuperi esterni di feed e articoli sono ora molto piu rigidi, cosi risposte sospette o troppo grandi vengono bloccate prima di rallentare l\'app.',
      '📚 Il caricamento delle notizie piu vecchie ora si comporta in modo piu affidabile anche mentre arrivano aggiornamenti live.',
      '🔴 Se tieni l\'auto refresh disattivato, il pulsante di aggiornamento torna ora a segnalare correttamente quando ci sono nuove notizie in attesa.',
      '📌 Ricerca e filtri ora restano comodi anche durante lo scroll.',
      '🖼️ Gli articoli senza foto hanno ora una cover generica piu pulita e neutra, cosi la card non resta spoglia.',
      '📤 Le news card e la modalita lettura possono ora condividere il link originale dell\'articolo, usando anche la condivisione nativa su mobile quando disponibile.',
      '📱 Le azioni delle card sono piu compatte su mobile, cosi Reader, Share e Apri articolo occupano meno spazio senza affollare il layout.',
      '📚 Anche la modalita lettura e ora piu calma, con una barra sticky piu leggera e dettagli articolo piu essenziali in testa al contenuto.',
      '🔠 Ora puoi scegliere testo piccolo, medio o grande nella modalita lettura, e News Flow si ricorda la preferenza anche alla prossima apertura.'
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
