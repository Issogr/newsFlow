export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.5.11',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '🧹 Article retention now follows the app-wide server setting; the redundant per-user retention and latest-hours controls were removed.',
      '📱 News cards, loading states, search, popups, and floating navigation now share a colorful responsive design, including an edge-to-edge mobile feed, reduced-motion animations, and liquid back-to-top control.',
      '⚙️ Settings, Feedback, Reader, and AI summaries now use flatter, clearer layouts with opaque reading surfaces and fewer nested containers.',
      '🎛️ Settings now use an explicit Save action, warn before discarding changes, present sources positively, and keep API and data tools under Advanced.',
      '♿ Refined shapes, dark-mode contrast, Source Setup and Admin layouts accompany consistent modal focus, dismissal, and mobile safe-area behavior.',
      '📡 Shared custom RSS feeds now reach every owner, while deleted or changed sources can no longer reappear after an older refresh finishes.',
      '🔐 Logout, password reset, and session expiry now close existing live-update connections, and active browser sessions renew reliably.',
      '🔖 Read-later source and topic counts now include saved articles only, and deleted custom-source filters clear automatically.',
      '📨 Feedback delivery now stops cleanly before the browser request times out instead of leaving an uncertain submission running.'
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '🧹 La retention degli articoli ora segue l\'impostazione server globale; i controlli ridondanti per retention utente e ultime ore sono stati rimossi.',
      '📱 Schede, caricamento, ricerca, popup e navigazione fluttuante ora condividono un design vivace e responsive, con feed mobile da bordo a bordo, animazioni a movimento ridotto e ritorno in cima con effetto liquido.',
      '⚙️ Impostazioni, Feedback, Lettore e riepiloghi AI ora usano layout piu piatti e chiari, superfici di lettura opache e meno contenitori annidati.',
      '🎛️ Le impostazioni ora usano un salvataggio esplicito, avvisano prima di scartare le modifiche, mostrano le fonti in modo positivo e raccolgono API e dati nelle opzioni avanzate.',
      '♿ Forme, contrasto scuro, Scelta fonti e Admin sono stati rifiniti insieme a focus, chiusura e aree sicure mobile coerenti per tutti i pannelli.',
      '📡 I feed RSS personalizzati condivisi ora raggiungono ogni proprietario, mentre le fonti eliminate o modificate non possono piu riapparire al termine di un vecchio aggiornamento.',
      '🔐 Logout, reimpostazione password e scadenza sessione ora chiudono le connessioni degli aggiornamenti live, e le sessioni browser attive si rinnovano correttamente.',
      '🔖 I conteggi di fonti e topic in Leggi dopo ora includono solo gli articoli salvati, e i filtri delle fonti personalizzate eliminate vengono rimossi automaticamente.',
      '📨 L\'invio dei feedback ora si interrompe correttamente prima del timeout del browser, senza lasciare una richiesta dall\'esito incerto ancora in esecuzione.'
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
