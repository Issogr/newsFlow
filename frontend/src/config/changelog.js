export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.5.5',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '🎙️ Keep the podcast panel to one morning and one evening entry, showing failed generations in the affected slot instead of backfilling duplicates.',
      '🔊 Let longer Italian podcast scripts generate audio when Gemini TTS needs more stitched chunks.'
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '🎙️ Mantiene nel pannello podcast una voce del mattino e una della sera, mostrando gli errori nello slot corretto invece di riempirlo con duplicati.',
      '🔊 Permette di generare l\'audio dei podcast italiani piu lunghi quando Gemini TTS richiede piu segmenti uniti.'
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
