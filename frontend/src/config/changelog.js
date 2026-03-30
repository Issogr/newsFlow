export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.2.7',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'Here is a quick overview of the latest changes in News Flow.',
    items: [
      '🌙 You can now switch the app theme from Settings and choose between light, dark, or your device preference.',
      '💬 You can now send feedback directly from the user menu, with a dedicated form for bugs, ideas, and rough edges.',
      '🏷️ Feedback can now be classified as a bug report, general feedback, or an improvement idea, and your username is included automatically with each submission.',
      '📸 Feedback reports can include an optional screenshot or short video with an inline preview before sending, and oversized uploads now surface a clear size error instead of a generic failure.',
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Ecco una panoramica rapida delle ultime novita di News Flow.',
    items: [
      '🌙 Ora puoi cambiare il tema dell\'app dalle Impostazioni e scegliere tra chiaro, scuro o preferenza del dispositivo.',
      '💬 Ora puoi inviare feedback direttamente dal menu utente, con un form dedicato per bug, idee e piccoli problemi trovati nell\'app.',
      '🏷️ I feedback possono ora essere classificati come bug, feedback generale o idea di miglioramento, e lo username viene incluso automaticamente in ogni invio.',
      '📸 Le segnalazioni possono includere uno screenshot o un breve video con anteprima prima dell\'invio, e gli upload troppo grandi mostrano ora un errore chiaro invece di un fallimento generico.',
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
