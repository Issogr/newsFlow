import React, { useMemo } from 'react';
import BrandMark from './BrandMark';

const policyContent = {
  cookie: {
    eyebrow: 'Legal',
    title: 'Cookie Policy',
    intro: 'This website uses only first-party technical cookies that are strictly necessary for login, authentication, and secure access to reserved areas. No analytics, marketing, or profiling cookies are used.',
    sections: [
      {
        title: '1. Assumptions',
        paragraphs: [
          'This policy assumes that the website uses only first-party technical cookies for account login and authenticated session management, and that no analytics, advertising, profiling, or similar tracking technologies are active.',
          'Replace placeholders such as [Company Name], [Address], and [Email Address] with the controller actual details before publishing.',
        ],
      },
      {
        title: '2. What cookies are used',
        paragraphs: [
          'The website uses only technical cookies that are strictly necessary to provide the service requested by the user.',
        ],
        bullets: [
          'Session cookies, used to keep the user authenticated during navigation and use of protected areas.',
          'Authentication cookies, used to recognize the logged-in user and maintain secure access to the account.',
        ],
      },
      {
        title: '3. Purpose of the cookies',
        bullets: [
          'allow users to log in;',
          'maintain the authenticated session;',
          'protect access to restricted areas;',
          'ensure the secure and proper functioning of the service.',
        ],
      },
      {
        title: '4. Duration',
        paragraphs: [
          'Technical cookies used for authentication may be session cookies, deleted automatically when the browser is closed, or limited persistent cookies retained only for the period strictly necessary to manage secure access and session continuity.',
          'In the current project configuration, the authenticated session cookie is configured with a default maximum duration of 30 days, based on the `SESSION_TTL_DAYS` setting. This period should remain proportionate to the authentication purpose and can be reduced if a shorter retention period is preferred.',
        ],
      },
      {
        title: '5. Legal basis',
        paragraphs: [
          'These cookies do not require user consent because they are strictly necessary to provide a service explicitly requested by the user.',
        ],
        bullets: [
          'performance of a requested service under the ePrivacy rules applicable to strictly necessary technical cookies;',
          'Article 6(1)(b) GDPR, where the related personal data processing is necessary for the performance of a contract or pre-contractual measures requested by the user;',
          'Article 6(1)(f) GDPR, where relevant for service and account security.',
        ],
      },
      {
        title: '6. Why consent is not required',
        paragraphs: [
          'Under applicable EU and Italian rules, including the ePrivacy framework and the guidance of the Italian Data Protection Authority, cookies that are strictly necessary to provide a service expressly requested by the user may be used without prior consent.',
          'Because this website uses only technical cookies for login, authentication, and secure access, no cookie consent banner is required.',
        ],
      },
      {
        title: '7. How users can manage or disable cookies',
        paragraphs: [
          'Users can manage or disable cookies through their browser settings. Browser controls usually allow users to view stored cookies, delete cookies, block all cookies, or block cookies only for selected websites.',
          'Disabling technical cookies may make it impossible to log in or use authenticated areas of the website correctly.',
          'Browser settings are generally available in the Settings, Privacy, or Security sections of the browser. Users may consult the support pages of Google Chrome, Mozilla Firefox, Microsoft Edge, Safari, or their preferred browser provider for detailed instructions.',
        ],
      },
      {
        title: '8. Contact',
        paragraphs: [
          '[Company Name / Data Controller]',
          '[Address]',
          '[Email Address]',
        ],
      },
    ],
  },
  privacy: {
    eyebrow: 'Legal',
    title: 'Privacy Policy',
    intro: 'This section covers the processing of personal data related to login, authentication, and access to the service. It assumes that the website uses only technical cookies strictly necessary for these functions.',
    sections: [
      {
        title: '1. Data Controller',
        paragraphs: [
          '[Company Name]',
          '[Registered Address]',
          '[Contact Email]',
          'If applicable: Data Protection Officer (DPO): [Name / Email]',
        ],
      },
      {
        title: '2. Personal data processed in connection with login and authentication',
        bullets: [
          'email address or username;',
          'hashed or otherwise securely protected authentication credentials;',
          'user ID or internal account identifier;',
          'login and session information;',
          'technical security data related to authentication events.',
        ],
        paragraphs: [
          'The website does not use this data for profiling or marketing purposes.',
        ],
      },
      {
        title: '3. Purpose of processing',
        bullets: [
          'creating and managing user accounts;',
          'authenticating users;',
          'enabling secure access to reserved areas;',
          'maintaining session continuity;',
          'preventing unauthorized access and protecting the service.',
        ],
      },
      {
        title: '4. Legal basis',
        bullets: [
          'Article 6(1)(b) GDPR: processing necessary for the performance of a contract or to take steps at the request of the data subject before entering into a contract;',
          'Article 6(1)(f) GDPR: where applicable, legitimate interest in ensuring IT security, account protection, and service integrity.',
        ],
        paragraphs: [
          'Technical cookies strictly necessary for login and authentication do not require consent.',
        ],
      },
      {
        title: '5. Methods of processing',
        paragraphs: [
          'Personal data is processed with electronic and organizational measures designed to ensure confidentiality, integrity, availability, and security, in accordance with the principles of lawfulness, fairness, transparency, minimization, and storage limitation.',
        ],
        bullets: [
          'access control limited to authorized personnel;',
          'secure transmission protocols;',
          'password hashing or equivalent secure credential protection;',
          'session management through secure technical cookies;',
          'logging and monitoring limited to security and operational needs.',
        ],
      },
      {
        title: '6. Data retention',
        paragraphs: [
          'Account data is retained for as long as the account remains active and, thereafter, for the period necessary to comply with legal obligations or to protect the controller rights.',
          'Authentication and session data is retained only for the time strictly necessary to manage secure login and access. In the current project configuration, the session cookie lifetime is set to a default maximum of 30 days unless the controller changes the `SESSION_TTL_DAYS` value.',
        ],
        bullets: [
          'account data: until account deletion and for any additional period required by law;',
          'session and authentication data: for the duration of the session or for a limited period strictly necessary for security;',
          'security logs: retained for [Retention Period], unless a longer period is required by law or justified by documented security needs.',
        ],
      },
      {
        title: '7. Nature of provision of data',
        paragraphs: [
          'Providing login-related data is necessary to create an account, log in, and access reserved functionalities. If the user does not provide the required data, those services may not be available.',
        ],
      },
      {
        title: '8. Recipients of data',
        paragraphs: [
          'Personal data may be processed by authorized internal personnel and, where necessary, by technical service providers acting as processors for hosting, maintenance, or security support.',
          'Data is not used for advertising, tracking, or profiling purposes.',
        ],
      },
      {
        title: '9. Data transfers',
        paragraphs: [
          'If personal data is transferred outside the European Economic Area, the transfer must take place in compliance with the GDPR through an appropriate legal mechanism, such as an adequacy decision or standard contractual clauses.',
          'If no such transfer takes place, state explicitly: No personal data is transferred outside the European Economic Area.',
        ],
      },
      {
        title: '10. Data subject rights',
        bullets: [
          'obtain confirmation as to whether personal data is being processed;',
          'access personal data;',
          'request rectification of inaccurate data;',
          'request erasure, where applicable;',
          'request restriction of processing, where applicable;',
          'object to processing based on legitimate interest, where applicable;',
          'receive data in a portable format, where applicable;',
          'lodge a complaint with the competent supervisory authority.',
        ],
        paragraphs: [
          'For users in Italy, the competent authority is the Garante per la protezione dei dati personali.',
          'Requests may be sent to: [Email Address for Privacy Requests].',
        ],
      },
      {
        title: '11. Security of authentication data',
        bullets: [
          'secure cookies with HttpOnly, Secure, and SameSite attributes;',
          'password storage using strong one-way hashing;',
          'session expiration and renewal controls;',
          'protection against unauthorized access.',
        ],
      },
      {
        title: '12. Updates to this policy',
        paragraphs: [
          'This Privacy Policy may be updated from time to time to reflect legal, technical, or organizational changes. Users should review it periodically.',
        ],
      },
    ],
  },
};

const LegalPolicyPage = ({ policy = 'privacy' }) => {
  const content = useMemo(() => policyContent[policy] || policyContent.privacy, [policy]);

  return (
    <div className="min-h-screen bg-white text-slate-900 sm:bg-slate-100 sm:px-4 sm:py-10">
      <div className="min-h-screen w-full bg-white px-5 py-8 sm:mx-auto sm:min-h-0 sm:max-w-4xl sm:rounded-[2rem] sm:border sm:border-slate-200 sm:p-8 sm:shadow-xl">
        <div className="mb-8 flex items-center gap-4">
          <BrandMark className="h-12 w-12" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-600">{content.eyebrow}</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">{content.title}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{content.intro}</p>
          </div>
        </div>

        <div className="space-y-6">
          {content.sections.map((section) => (
            <section key={section.title} className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-5">
              <h2 className="text-lg font-semibold text-slate-900">{section.title}</h2>
              {section.paragraphs?.map((paragraph) => (
                <p key={paragraph} className="mt-3 text-sm leading-6 text-slate-700">{paragraph}</p>
              ))}
              {section.bullets?.length ? (
                <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
                  {section.bullets.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}

          <section className="rounded-[1.5rem] border border-emerald-200 bg-emerald-50 p-5">
            <h2 className="text-lg font-semibold text-emerald-900">Short Notice</h2>
            <p className="mt-3 text-sm leading-6 text-emerald-800">
              This website uses only technical cookies strictly necessary for login, authentication, and secure access to reserved areas. No profiling or marketing cookies are used.
            </p>
          </section>

          <section className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-5">
            <h2 className="text-lg font-semibold text-slate-900">Technical Requirements For Developers</h2>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
              <li>Use only cookies strictly necessary for login and authenticated session management.</li>
              <li>Do not set analytics, profiling, advertising, or other unnecessary cookies.</li>
              <li>Use first-party cookies only for authentication and session purposes.</li>
              <li>Set appropriate security flags on authentication cookies: HttpOnly, Secure when served over HTTPS, and SameSite=Strict or SameSite=Lax according to the login flow.</li>
              <li>Use a duration appropriate to the authentication purpose.</li>
              <li>Prefer session cookies unless a limited persistent duration is strictly necessary.</li>
              <li>Do not store tracking identifiers in authentication cookies.</li>
              <li>Do not reuse authentication cookies for profiling or analytics.</li>
              <li>Ensure credentials are protected with secure hashing, not plaintext or reversible encryption.</li>
              <li>Ensure transport security with HTTPS.</li>
              <li>Minimize authentication-related logging and avoid storing raw credentials or session secrets in logs.</li>
              <li>Make sure disabling technical cookies prevents login functionality only, without introducing unrelated tracking behavior.</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
};

export default LegalPolicyPage;
