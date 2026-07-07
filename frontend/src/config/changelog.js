export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.5.10',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '👉 Swipe left or right on mobile AI summaries to move between topics without closing the panel; the card follows your gesture while swiping.',
      '🌈 AI summary stories keep their rainbow ring after opening, with a small dot showing what is still new.',
      '🏷️ Topic circles on news cards now overlap neatly like multiple source circles.',
      '🔐 Password setup now shows clearer messages when the connection fails or takes too long, instead of blaming the link.',
      '🧭 Privacy, cookie, and docs pages open more reliably, and returning to the app checks your session again.',
      '📰 Custom feed icons are safer and can recover when a source updates its icon.'
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '👉 Scorri a sinistra o a destra sulle sintesi AI da mobile per passare tra i topic senza chiudere il pannello; la scheda segue il gesto durante lo swipe.',
      '🌈 Le storie con sintesi AI mantengono l\'anello arcobaleno anche dopo l\'apertura, con un piccolo punto per indicare quelle ancora nuove.',
      '🏷️ I cerchi dei topic nelle news card ora si sovrappongono in modo ordinato come quelli delle fonti multiple.',
      '🔐 Il setup della password ora mostra messaggi piu chiari quando la connessione fallisce o impiega troppo tempo, senza dare subito la colpa al link.',
      '🧭 Le pagine privacy, cookie e documentazione si aprono in modo piu affidabile, e tornando all\'app la sessione viene ricontrollata.',
      '📰 Le icone dei feed personalizzati sono piu sicure e possono riprendersi quando una fonte aggiorna la propria icona.'
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
