// Explicit, live-model evaluation; never loaded by Vitest or the application.
import generator from '../services/aiSummaryGenerator';

const cases = [
  {
    name: 'preserves a postponed vote', supported: true,
    evidence: 'The council postponed its vote on a proposed EUR 10 million fund. No funding was approved.',
    en: 'The council postponed a vote on a proposed fund of ten million euros; no funding was approved [1].',
    it: 'Il consiglio ha rinviato il voto su un fondo proposto da dieci milioni di euro; nessun finanziamento è stato approvato [1].'
  },
  {
    name: 'rejects invented approval and amount', supported: false,
    evidence: 'The council postponed its vote on a proposed EUR 10 million fund. No funding was approved.',
    en: 'The council approved ten billion euros in funding and passed the new law unanimously [1].',
    it: 'Il consiglio ha approvato dieci miliardi di euro di finanziamenti e la nuova legge all’unanimità [1].'
  },
  {
    name: 'preserves attribution and uncertainty', supported: true,
    evidence: 'According to the preliminary university study, the treatment may reduce symptoms. The researchers say larger trials are needed.',
    en: 'A preliminary university study suggests the treatment may reduce symptoms, but researchers say larger trials are needed [1].',
    it: 'Uno studio universitario preliminare suggerisce che il trattamento potrebbe ridurre i sintomi, ma i ricercatori chiedono studi più ampi [1].'
  },
  {
    name: 'rejects loss of uncertainty', supported: false,
    evidence: 'According to the preliminary university study, the treatment may reduce symptoms. The researchers say larger trials are needed.',
    en: 'The university has proved that the treatment cures the disease and no further trials are needed [1].',
    it: 'L’università ha dimostrato che il trattamento cura la malattia e non servono ulteriori studi [1].'
  },
  {
    name: 'rejects contradictory historical claims', supported: false,
    evidence: 'The four highest-ranked teams reached the semi-finals. The same event occurred in 1970 and 1990.',
    en: 'For the first time in history, the four highest-ranked teams reached the semi-finals, an event that also occurred in 1970 and 1990 [1].',
    it: 'Per la prima volta nella storia le quattro squadre meglio classificate sono in semifinale, un evento già avvenuto nel 1970 e nel 1990 [1].'
  },
  {
    name: 'rejects geographic scope drift in translation', supported: false,
    evidence: 'New York state enacted a one-year moratorium on new data centers. Other US states are not covered.',
    en: 'New York state enacted a one-year moratorium on new data centers; it does not cover other US states [1].',
    it: 'Gli Stati Uniti hanno introdotto una moratoria nazionale di un anno sui nuovi data center, valida in tutti gli stati [1].'
  },
  {
    name: 'rejects both locales in English', supported: false,
    evidence: 'The council postponed its vote on a proposed EUR 10 million fund. No funding was approved.',
    en: 'The council postponed a vote on a proposed fund of ten million euros; no funding was approved [1].',
    it: 'The vote on the proposed ten-million-euro fund was postponed by the council, without approving funding [1].'
  }
];

async function main() {
  if (process.argv.includes('--help')) {
    console.log('Set OPENROUTER_API_KEY, then run npm run eval:summaries. Makes 7 live grounding requests using OPENROUTER_SUMMARY_MODEL and exits nonzero for incorrect verdicts. Does not write the news database.');
    return;
  }
  const config = generator._getConfig();
  if (!config.apiKey) throw new Error('OPENROUTER_API_KEY is required for the live evaluation');
  let failures = 0;
  for (const fixture of cases) {
    const input = generator._buildInput({ key: 'evaluation' }, [{
      id: fixture.name, title: 'Source report', description: fixture.evidence, source: 'Evaluation source',
      content: '', url: 'https://example.com/evidence', pubDate: '2026-07-14T12:00:00.000Z', topics: []
    }]);
    const summary = { summaryTextByLocale: { en: fixture.en, it: fixture.it } };
    generator._validateGeneratedSummary(summary, 1);
    const { supported } = await generator._verifySummaryGrounding(config, input, summary);
    const passed = supported === fixture.supported;
    failures += Number(!passed);
    console.log(`${passed ? 'PASS' : 'FAIL'} ${fixture.name}: expected ${fixture.supported ? 'accept' : 'reject'}, got ${supported ? 'accept' : 'reject'}`);
  }
  console.log(`${cases.length - failures}/${cases.length} expected verdicts matched (${config.model}).`);
  process.exitCode = failures ? 1 : 0;
}

if (require.main === module) {
  main().catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
