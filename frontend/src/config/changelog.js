export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.5.9',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '⚡ Reduced AI provider usage with smarter local topic skips, larger topic batches, and smaller balanced summary/podcast prompts.',
      '🔄 Made manual refreshes smoother by avoiding immediate reloads of unchanged thematic summaries.',
      '🧠 Regenerated stale thematic summaries when later articles change the selected source set for the same window.',
      '🎙️ Saved podcast scripts before audio generation so new briefings can appear while TTS audio finishes in the background.',
      '💾 Enabled private browser caching for podcast audio to reduce repeated media downloads.',
      '🏷️ Added low, medium, and high clickbait labels beside article dates.'
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '⚡ Ridotto l\'uso del provider AI con skip locali dei topic, batch piu grandi e prompt di sintesi/podcast piu piccoli e bilanciati.',
      '🔄 Resi piu fluidi gli aggiornamenti manuali evitando il ricaricamento immediato delle sintesi tematiche non cambiate.',
      '🧠 Rigenerate le sintesi tematiche obsolete quando articoli successivi cambiano le fonti selezionate per la stessa finestra.',
      '🎙️ Salvati gli script dei podcast prima dell\'audio, cosi i nuovi briefing possono comparire mentre il TTS termina in background.',
      '💾 Abilitata la cache privata del browser per l\'audio dei podcast, riducendo i download multimediali ripetuti.',
      '🏷️ Aggiunte etichette clickbait basso, medio e alto accanto alle date degli articoli.'
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
