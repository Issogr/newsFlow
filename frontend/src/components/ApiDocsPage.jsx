import { Fragment } from 'react';
import StaticInfoPageFrame, { StaticInfoSection } from './StaticInfoPageFrame';

function renderTextWithInlineCode(text) {
  const content = String(text || '');
  const segments = content.split(/(`[^`]+`)/g).filter(Boolean);

  return segments.map((segment, index) => {
    if (segment.startsWith('`') && segment.endsWith('`')) {
      return (
        <code
          key={`${segment}-${index}`}
          className="rounded-md bg-slate-200 px-1.5 py-0.5 font-mono text-[0.92em] text-slate-900"
        >
          {segment.slice(1, -1)}
        </code>
      );
    }

    return <Fragment key={`${segment}-${index}`}>{segment}</Fragment>;
  });
}

const docsContent = {
  en: {
    eyebrow: 'Public API',
    title: 'External News API',
    intro: 'This page documents the public read-only API. Internal app APIs remain private to the News Flow web app and are not part of the public integration surface.',
    sections: [
      {
        title: 'Endpoints',
        items: [
          '`GET /api/public/news` returns cached news items.',
          'Anonymous requests return only platform default-source news.',
          'Authenticated requests with a valid API token return news filtered by that user settings and custom sources.'
        ]
      },
      {
        title: 'Authentication',
        items: [
          'Anonymous mode requires no token.',
          'Authenticated mode uses `Authorization: Bearer <api-token>`.',
          'API tokens are generated from Settings and always expire after 30 days.'
        ]
      },
      {
        title: 'External behavior limits',
        items: [
          'The public API serves database-cached content only.',
          'Public API requests never trigger new RSS fetches or reader-page fetches.',
          'Write, admin, feedback, reader, and settings endpoints are not part of the public API surface.',
          'Rate limits apply only to the public API: anonymous access is stricter, while authenticated token access has a higher allowance.'
        ]
      },
      {
        title: 'Response shape',
        items: [
          'Responses include `items`, `meta`, and `access`; `filters` is returned only when `includeFilters=true` is passed.',
          '`access.mode` is `anonymous` or `token`.',
          'Errors use the standard `{ error: { message, code } }` format.'
        ]
      }
    ],
    exampleTitle: 'Example',
    exampleRequest: 'curl https://your-host/api/public/news',
    exampleAuthRequest: 'curl -H "Authorization: Bearer nfapi_..." https://your-host/api/public/news?sources=ansa&topics=Politics',
  },
  it: {
    eyebrow: 'API pubblica',
    title: 'API esterna delle notizie',
    intro: 'Questa pagina documenta l\'API pubblica in sola lettura. Le API interne dell\'app restano private per la web app News Flow e non fanno parte della superficie pubblica per integrazioni esterne.',
    sections: [
      {
        title: 'Endpoint',
        items: [
          '`GET /api/public/news` restituisce notizie gia presenti in cache nel database.',
          'Le richieste anonime restituiscono solo notizie dalle fonti predefinite della piattaforma.',
          'Le richieste autenticate con un token API valido restituiscono notizie filtrate secondo impostazioni e fonti personalizzate dell\'utente.'
        ]
      },
      {
        title: 'Autenticazione',
        items: [
          'La modalita anonima non richiede token.',
          'La modalita autenticata usa `Authorization: Bearer <api-token>`.',
          'I token API si generano dalle Impostazioni e scadono sempre dopo 30 giorni.'
        ]
      },
      {
        title: 'Limiti del comportamento esterno',
        items: [
          'L\'API pubblica serve solo contenuti gia presenti nel database.',
          'Le richieste pubbliche non attivano nuovi fetch RSS o fetch della pagina reader.',
          'Endpoint di scrittura, admin, feedback, reader e impostazioni non fanno parte della superficie pubblica dell\'API.',
          'I limiti di richiesta si applicano solo all\'API pubblica: l\'accesso anonimo e piu restrittivo, mentre l\'accesso con token autenticato ha una soglia piu alta.'
        ]
      },
      {
        title: 'Formato risposta',
        items: [
          'Le risposte includono `items`, `meta` e `access`; `filters` viene restituito solo passando `includeFilters=true`.',
          '`access.mode` vale `anonymous` oppure `token`.',
          'Gli errori usano il formato standard `{ error: { message, code } }`.'
        ]
      }
    ],
    exampleTitle: 'Esempio',
    exampleRequest: 'curl https://your-host/api/public/news',
    exampleAuthRequest: 'curl -H "Authorization: Bearer nfapi_..." https://your-host/api/public/news?sources=ansa&topics=Politics',
  }
};

const ApiDocsPage = ({ locale }) => {
  const content = docsContent[locale] || docsContent.en;

  return (
    <StaticInfoPageFrame content={content}>
      {content.sections.map((section) => (
        <StaticInfoSection key={section.title}>
          <h2 className="text-lg font-semibold text-slate-900">{section.title}</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            {section.items.map((item) => (
              <li key={item} className="leading-6">{renderTextWithInlineCode(item)}</li>
            ))}
          </ul>
        </StaticInfoSection>
      ))}

      <StaticInfoSection>
        <h2 className="text-lg font-semibold text-slate-900">{content.exampleTitle}</h2>
        <pre className="mt-3 overflow-x-auto rounded-2xl bg-slate-950 px-4 py-3 text-sm text-slate-100"><code>{content.exampleRequest}</code></pre>
        <pre className="mt-3 overflow-x-auto rounded-2xl bg-slate-950 px-4 py-3 text-sm text-slate-100"><code>{content.exampleAuthRequest}</code></pre>
      </StaticInfoSection>
    </StaticInfoPageFrame>
  );
};

export default ApiDocsPage;
