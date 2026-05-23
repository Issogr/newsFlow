export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.5.0',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '🎧 A new podcast briefing appears first in the topic story rail, generated from the same scheduled summary articles.',
      '🌍 Podcast scripts are available in English and Italian based on your app language.',
      '🔊 Italian audio playback is included when podcast TTS generation is available, using the Gemini TTS default configuration.',
      '🧹 AI summaries and podcast briefings now skip promotional shopping deals and affiliate-style sale posts.',
      '🕒 Podcast and summary titles no longer invent morning, noon, or evening labels from the coverage window.',
      '📖 Dense summaries and podcast scripts are split into more readable paragraphs.',
      '🛒 Promotional product price-drop sentences are removed from generated summaries and podcast scripts.',
      '⚡ Podcast audio now streams through the browser instead of loading the full file first.',
      '🎙️ Podcast generation now validates scripts and audio, caps TTS input size, and retries failed audio without regenerating scripts.',
      '🔗 Gemini podcast audio is now generated in natural chunks and stitched into one WAV file to avoid truncated narration with shorter pauses.',
      '🧩 AI story grouping checks more nearby candidates, retries recent misses, and records match evidence while keeping model input small.',
      '📰 Thematic summaries now wait for topic classification, validate citations, and show an explicit empty-window message when no topic news is available.',
      '🛡️ Feed pagination, session handling, and settings drafts are more reliable.'
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '🎧 Un nuovo briefing podcast appare per primo nella barra delle storie per topic, generato dagli stessi articoli delle sintesi programmate.',
      '🌍 I testi podcast sono disponibili in inglese e italiano in base alla lingua dell\'app.',
      '🔊 La riproduzione audio in italiano e inclusa quando la generazione TTS del podcast e disponibile, con la configurazione predefinita Gemini TTS.',
      '🧹 Le sintesi AI e i briefing podcast ora saltano offerte promozionali e articoli di vendita in stile affiliate.',
      '🕒 I titoli di podcast e sintesi non inventano piu etichette come mattina, mezzogiorno o sera dalla finestra coperta.',
      '📖 Sintesi e testi podcast densi vengono divisi in paragrafi piu leggibili.',
      '🛒 Le frasi promozionali su cali di prezzo dei prodotti vengono rimosse da sintesi e podcast.',
      '⚡ L\'audio podcast ora viene riprodotto in streaming dal browser invece di caricare prima tutto il file.',
      '🎙️ La generazione podcast ora valida testi e audio, limita la dimensione input TTS e ritenta l\'audio fallito senza rigenerare i testi.',
      '🔗 L\'audio podcast Gemini ora viene generato in segmenti naturali e unito in un unico WAV per evitare narrazioni troncate con pause piu brevi.',
      '🧩 Il raggruppamento AI delle storie controlla piu candidati vicini, ritenta i match recenti mancati e conserva le prove del match mantenendo piccolo l\'input del modello.',
      '📰 Le sintesi tematiche ora aspettano la classificazione dei topic, validano le citazioni e mostrano un messaggio esplicito quando non ci sono notizie per la finestra.',
      '🛡️ Paginazione del feed, sessioni e bozze delle impostazioni sono piu affidabili.'
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
