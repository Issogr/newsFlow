export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.2.9',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'Here is a quick overview of the latest changes in News Flow.',
    items: [
      '🎛️ In reader mode, the text-size control now sits next to Share on the left side of the top bar, so the header actions feel more grouped and easier to use.',
      '👆 On news cards, you can now open reader mode faster with a double click on desktop or a double tap on mobile directly on the image or title.',
      '⚙️ Auto refresh and card images now use cleaner On/Off pills in Settings, so those quick preferences feel more aligned with the rest of the interface.',
      '⏱️ Scheduled news checks are now slower by default, moving from 5 minutes to 15 minutes to stay fresh without being too aggressive with upstream sources.',
      '⚡ The frontend now runs on a newer Vite-based stack behind the scenes, making the app easier to maintain and update safely over time.',
      '🛠️ Reader mode, settings, feedback, and session handling also received internal cleanup to keep a few key parts of the app more consistent and reliable.',
      '🔐 News Flow now has a clearer public API area for external news access, while the app keeps its private internal routes separated behind the scenes.',
      '🪪 From Settings you can now generate a personal API token with automatic expiration, making external read-only integrations easier to manage safely.',
      '📘 A new `/api` page now documents how public news access works in both anonymous and authenticated modes.',
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Ecco una panoramica rapida delle ultime novita di News Flow.',
    items: [
      '🎛️ In modalita lettura, il controllo della dimensione del testo ora sta accanto a Share sul lato sinistro della barra in alto, cosi le azioni del reader risultano piu raccolte e comode da usare.',
      '👆 Nelle news card ora puoi aprire piu in fretta la modalita lettura con un doppio click su desktop o un doppio tap su mobile direttamente su immagine o titolo.',
      '⚙️ Auto refresh e immagini card ora usano pill On/Off piu pulite nelle impostazioni, cosi queste preferenze rapide risultano piu coerenti con il resto dell\'interfaccia.',
      '⏱️ I controlli automatici delle notizie ora sono piu lenti di default: si passa da 5 minuti a 15 minuti per restare aggiornati senza essere troppo aggressivi verso le fonti.',
      '⚡ Il frontend ora gira su una base piu moderna con Vite dietro le quinte, cosi manutenzione e aggiornamenti futuri risultano piu semplici e sicuri.',
      '🛠️ Anche modalita lettura, impostazioni, feedback e gestione sessioni hanno ricevuto una pulizia interna per restare piu coerenti e affidabili nei punti chiave dell\'app.',
      '🔐 News Flow ora ha un\'area API pubblica piu chiara per l\'accesso esterno alle notizie, mentre l\'app mantiene separati dietro le quinte i suoi percorsi interni privati.',
      '🪪 Dalle Impostazioni puoi ora generare un token API personale con scadenza automatica, cosi le integrazioni esterne in sola lettura sono piu semplici da gestire in sicurezza.',
      '📘 Una nuova pagina `/api` spiega come funziona l\'accesso pubblico alle notizie sia in modalita anonima sia autenticata.',
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
