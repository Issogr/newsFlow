# Changelog

## 3.2.12

- hardened the BFF boundary by stripping raw backend credentials from browser-facing app and Socket.IO proxy paths, requiring a valid BFF session before proxying authenticated app traffic, and clearing local BFF sessions even when upstream logout fails
- added browser security headers to the BFF-served frontend and switched BFF/backend Docker dependency installs to lockfile-based `npm ci`, with the BFF container now running as an unprivileged user
- tightened outbound URL safety for RSS/reader fetches by blocking additional special-use IPv4 ranges, carrier-grade NAT, multicast/reserved ranges, and IPv4-mapped IPv6 private targets
- fixed page-based feed pagination so `page > 1` uses the expected offset when cursor pagination is not active
- changed RSS ingestion to use bounded concurrency instead of firing every configured and user feed request at once
- made schema startup distinguish fresh databases from unversioned legacy databases so missing migration metadata no longer silently marks an older schema as current
- reduced frontend scroll-time state churn, fixed canceled load-more requests leaving pagination controls stuck, removed unused realtime notification and reader-refresh UI state, and surfaced clipboard-share failures cleanly
- consolidated duplicated source/topic filter rendering and backend news-query parsing to reduce drift between desktop/mobile and internal/public API paths
- fixed Docker Compose startup for the non-root BFF container by repairing ownership on the persistent BFF session-data volume before the service starts
- aligned README/runtime metadata with the current required Compose secrets, tag-only container release workflow, and Node engine requirements

## 3.2.11

- moved the share button into the image container for non-compact NewsCard layouts so the title and content below it no longer need asymmetric right padding reserved for a floating control
- removed the SOURCES section from the NewsCard content area and repositioned source pills as an absolute overlay at the bottom of the article image, backed by a bottom-to-transparent gradient so pills remain readable across varying image content
- cleaned up the unused `Rss` import from NewsCard after removing the sources heading
- removed topic icon pills from the NewsCard content area to further declutter the card surface
- added a mobile-only floating bottom navigation pill for Sources, Topics, recent-time filtering, and Search, replacing the sticky desktop filter panel on small screens while preserving the existing desktop/tablet controls
- added mobile filter bubbles above the bottom navigation for source and topic selection, a smoother animated search expansion with an icon-only close control, and scroll-direction behavior so the mobile nav hides on downward scroll and returns on upward scroll
- made the top navigation sticky and compact on scroll, with matching desktop filter-panel offsets so the sticky filter controls stay below the shrinking header
- aligned the mobile bottom navigation surface with the sticky header treatment by using a translucent blurred white pill, softer border, and calmer shadow
- replaced the legacy desktop filter pill with flat labeled top-navigation controls beside refresh, matching the mobile four-action Sources, Topics, recent-time, and Search flow with source/topic bubbles
- aligned the desktop refresh and user-menu buttons with the same flat labeled top-navigation style used by the filter controls

## 3.2.10.4

- replaced the forced post-login release-notes modal with a lightweight top-center update notice that lets users keep working and open the full changelog on demand, while still persisting `lastSeenReleaseNotesVersion` only after they actually dismiss the full release-notes view
- added a 30-second auto-dismiss flow for the new update notice, including a right-to-left shrinking progress bar and explicit close control so unseen updates can be quietly deferred for the current session without losing the next-login reminder
- added minimal public API usage reporting for admins, including per-user authenticated request totals plus a global anonymous-request counter, so external API adoption is visible without introducing full analytics
- stopped storing API-token creation and usage IP addresses, cleared any previously stored token IP metadata during migration, and kept only the usage timestamps and counters needed for lightweight operational visibility

## 3.2.10.3

- refined several legal and admin surfaces on mobile so the privacy policy, cookie policy, API docs, and admin dashboard now use edge-to-edge full-screen layouts instead of rendering inside padded desktop-style cards
- aligned the auth and settings legal-document links with the same pill treatment used elsewhere in Settings, simplified the settings primary action label to `Save`, and limited the account-creation password guidance to registration mode instead of showing it on sign-in
- replaced the generic fallback news cover with a resized optimized `WebP` asset, cutting the placeholder image transfer cost substantially while preserving the existing card fallback behavior

## 3.2.10.2

- replaced the BFF in-memory session mapping with a persistent SQLite-backed `express-session` store so authenticated browser sessions survive browser close/reopen flows and BFF restarts instead of being dropped when ephemeral proxy state disappears
- hardened the BFF and backend secret model by requiring non-default production secrets and separating browser-session signing from BFF-to-backend trust, while keeping the runtime setup simple enough that changing either secret only forces users to sign in again

## 3.2.10.1

- switched authenticated browser sessions to sliding expiry on both the BFF and backend session records, preventing active sessions from expiring unexpectedly mid-use and renewing their lifetime on continued authenticated traffic
- fixed the frontend auth-expiry path so a `401` from authenticated app APIs immediately clears stale logged-in UI state instead of letting actions fail repeatedly before the user is kicked out
- kept the default authenticated session lifetime at 30 days while updating Docker defaults and legal/runtime documentation so the documented retention window still matches the actual app behavior

## 3.2.10

- moved browser sessions from JavaScript-managed bearer tokens to secure HTTP-only cookies, reducing the impact of future frontend token theft and aligning HTTP and WebSocket authentication on the same server-managed session path
- stopped exposing password setup secrets in query strings and startup logs by switching setup links to fragment tokens, redacting sensitive request values from logs, and removing the logged admin bootstrap link
- added dedicated rate limiting for login, registration, and password setup flows so auth endpoints are harder to brute-force than the general internal API surface
- tightened the Content Security Policy by removing inline script execution while preserving the existing app shell and deployment behavior
- added dedicated `/privacy-policy` and `/cookie-policy` pages tailored to the app technical-cookie-only login flow, including GDPR/ePrivacy-oriented wording and project-specific session-retention notes
- surfaced the legal pages directly from both the authentication screen and Settings so users can review the technical-cookie and login-processing information without leaving the app flow
- introduced a browser-facing BFF service that now serves the built frontend, owns public authenticated app routes under `/api/*`, proxies Socket.IO, and keeps the backend app API private on the internal Docker network
- moved browser session ownership to the BFF by storing only a BFF session cookie in the browser while mapping it server-side to the backend session, so backend session semantics no longer travel directly through the public web surface
- relocated the public API documentation page from `/api` to `/api/docs` so `/api/*` can be reserved for browser-facing app endpoints while `/api/public/*` remains the public external integration surface

## 3.2.9.2

- fixed compact no-image cards so the share action no longer overlaps the title and now sits beside it without changing the standard card layout
- replaced the compact-card toggle with an explicit scope setting (`Off`, `Mobile only`, `Desktop only`, `Everywhere`) and migrated existing enabled compact-card preferences to the all-devices mode

## 3.2.9.1

- bumped the release version to `3.2.9.1` and started a new top-level changelog entry while preserving the existing in-app release notes content as history for the next update cycle
- added a persisted compact news-card view that keeps the existing card actions and reader shortcuts while switching the feed cards to a denser horizontal layout with the image on the left

## 3.2.9

- removed permanently disabled grouping code, unused exports, stale translation keys, and generated frontend build artifacts so the repository and runtime paths are easier to maintain
- consolidated duplicated feedback validation and attachment handling into shared helpers, and aligned frontend feedback limits with backend-defined settings payloads
- unified authenticated session resolution across HTTP and WebSocket paths to reduce drift between token parsing, expiry checks, and activity tracking
- migrated the frontend from `react-scripts` to a Vite + Vitest toolchain, renamed JSX-bearing files to `.jsx`, replaced CRA-specific entry handling, and updated tests to run on the new stack
- upgraded backend `@mozilla/readability` to the current supported release and cleared the remaining backend audit advisory without changing reader-service behavior
- upgraded the frontend Vite/Vitest stack to current compatible releases, added explicit `esbuild` support for the temporary JSX compatibility transform, then replaced the deprecated transform path with the native OXC-based flow
- updated Docker frontend builds to use a Node 22 build image and the Vite `dist/` output, restoring successful `docker compose up --build` behavior after the frontend toolchain migration
- split the HTTP surface into explicit app-private and public API paths, moving SPA/internal calls behind `/internal-api/*` while exposing only the external cached-news facade on `/api/public/*`
- added a dedicated public external news endpoint with anonymous and user-token modes, where anonymous requests return only default-source news and token-authenticated requests apply that user settings and custom sources
- enforced cached-only behavior for the public external news API so public requests never trigger seed ingestion, RSS refreshes, or reader-page upstream fetches
- added hashed per-user API tokens with mandatory 30-day expiry, server-side expiration checks, revocation/regeneration support, and last-used tracking without reusing browser session tokens
- added layered request protection only on the public external API, combining stricter anonymous limits, higher token-authenticated allowances, and nginx edge throttling without affecting internal app API flows
- added a multilingual `/api` documentation page describing the public API surface, authentication modes, external usage limits, and the distinction between public read-only access and app-private internal APIs
- tightened nginx exposure rules so `/api/public/*` is the only external API subtree, `/api` serves documentation, and generic public access to app-private API routes is rejected
- added runtime and regression coverage for the new separation model, including public news access, token-based external access, internal app API protection, and container health verification
- refreshed reader mode so the header controls, source/read-time metadata, and content cards now align more closely with the main News Flow visual language while keeping the article body as the primary focus
- simplified the reader toolbar by moving `Share` into a compact top-left icon action, replacing the text-size dropdown with a `- aA +` stepper, and removing extra header actions that competed with the reading flow
- widened the reader content column, tightened the side gutters, and fixed dark-mode header/title surfaces so the reading panel uses more space without losing its calm layout
- added a direct reader shortcut on news cards so a double click on desktop or double tap on mobile over the image or title now opens reader mode without needing the footer button
- aligned the `Auto refresh news` and `Show card images` settings rows with the rest of the preferences UI and replaced the plain checkboxes with compact state pills that fit the refreshed settings visual language better
- removed the temporary `news_aggregator` rename migration code and the legacy DB schema upgrade ladder so startup and persistence handling now target only the current `newsflow` naming and schema baseline
- changed the default scheduled ingestion interval from 5 minutes to 15 minutes to reduce upstream request pressure while keeping news reasonably fresh by default

## 3.2.8

- added a lightweight share feedback bubble for clipboard fallback flows so desktop users now get a clear confirmation when an article link is copied
- moved the news-card share action into a floating top-right translucent button and rebalanced the footer actions so `Reader mode` and `Open article` fill the row more cleanly
- refined the clipboard confirmation into a share-button-attached animated pill that expands outward from the trigger toward the left instead of taking dedicated layout space
- added a floating bottom-left back-to-top button on the news screen that appears after scrolling so long feed sessions can jump back to the start quickly
- refreshed reader mode so the header controls, source/read-time metadata, and content cards now align more closely with the main News Flow visual language while keeping the article body as the primary focus
- simplified the reader toolbar by moving `Share` into a compact top-left icon action, replacing the text-size dropdown with a `- aA +` stepper, and removing extra header actions that competed with the reading flow
- widened the reader content column and tightened the side gutters so article title and body cards use more of the available panel width without becoming edge-to-edge

## 3.2.7

- added an authenticated in-app feedback flow reachable from the user menu, with a dedicated modal for sending bug reports, ideas, and general product feedback
- added optional screenshot and short-video uploads for feedback submissions, including frontend file handling plus backend multipart validation and upload size/type limits
- added backend Telegram delivery for feedback submissions so reports can be forwarded directly to a configured bot chat without exposing bot credentials to the browser
- extended the feedback flow with explicit `bug`, `general feedback`, and `improvement idea` categories and validated the chosen category on the backend before Telegram delivery
- made the sender identity explicit by surfacing the authenticated username in the feedback modal and including it automatically in forwarded feedback payloads
- added inline attachment preview support in the feedback form so users can confirm the selected image or short video before submitting
- raised the frontend nginx request-body limit so feedback submissions with screenshots or short videos can pass through the Docker proxy instead of failing before they reach the backend
- added a structured nginx `413` JSON response for oversized feedback uploads so the UI can show a clear attachment-size error instead of a generic delivery failure
- added a persisted theme preference with `light`, `dark`, and `use device setting` modes so users can switch the app appearance from Settings

## 3.2.6.1

- simplified manual refresh behavior again by removing the refresh-button pending-update hint and keeping the button as a straightforward reload action when auto refresh is off
- refined the sticky search-and-filter surface so the dropdown now feels like a connected extension of the main bubble, animates open more smoothly, and can scroll internally when filters exceed the viewport height
- adjusted news-card action buttons so `Reader` and `Share` use the same compact icon treatment on both desktop and mobile, while `Open article` remains the primary action

## 3.2.6

- made passwords mandatory for new accounts, added minimum-length validation on backend and frontend, and blocked legacy passwordless logins from authenticating
- fixed settings export/import so `showNewsImages` now survives account migrations correctly
- added a dedicated admin bootstrap flow that creates the reserved admin account automatically, logs a one-time setup link on startup, and prevents normal users from registering the reserved admin username
- added admin-managed password setup/reset links so the admin can issue one-time links for users to configure a new valid password
- replaced the admin news home with a dedicated admin dashboard that focuses on account management instead of the reader/news feed
- added admin visibility into total users, currently online users, last login time, and last activity time with automatic activity tracking for authenticated API and WebSocket usage
- hardened outbound feed/article fetching against DNS rebinding and oversized response bodies by pinning validated DNS resolutions to the actual request and enforcing size limits for feeds, reader pages, and image-fallback fetches
- moved password hashing and verification off the synchronous Node.js event loop path by switching authentication flows to async `scrypt` usage
- fixed live-update pagination drift by adding cursor-based news loading so prepended real-time groups no longer break `Load more` ordering or cause duplicate-heavy paging
- reduced feed-query overhead and improved pagination accuracy by avoiding repeated intermediate resorting in grouped queries and by returning `hasMore` only when another page is actually reachable
- reduced WebSocket fanout work by batching sockets with identical subscriptions and bounded browser-side live-update dedupe tracking so long-running tabs no longer retain every seen group id forever
- fixed manual-refresh mode so the app still listens for live updates with auto refresh disabled, allowing the refresh button indicator to signal newly available news again
- added a clear-search control inside the main search field and removed the `Updated` status chip from the header area to simplify the top-bar UI
- removed the manual `Refresh reader` action from reader mode so the reading toolbar stays focused on opening the original article
- moved filters directly below the search bar, made the search-and-filter controls sticky for easier access while scrolling, and prevented the expanded filter panel from pushing page content down
- softened the sticky search/filter surface with a lighter translucent treatment and aligned the dropdown styling with the main control bubble
- fixed the user menu layering so it now opens above the sticky search/filter controls instead of behind them
- added a generic fallback cover illustration for articles without images and refined it into a cleaner neutral placeholder so imageless stories still render consistently without distracting artwork
- added share actions to news cards and reader mode, using the original article URL and the native OS share sheet when available with safe browser fallbacks otherwise
- compacted the news-card action bar on mobile so `Reader`, `Share`, and `Open article` use space more efficiently without losing desktop readability
- simplified reader mode by keeping only the `Clean reading view` label and close action sticky, moving the article title into the scrolling content, and trimming metadata chips down to the source plus read-time info
- added a persistent `readerTextSize` user setting with DB migration, settings-panel support, and an in-reader selector so text size stays consistent across sessions without reloading the page behind the reader
- removed the reader-mode top excerpt/summary block so articles open directly into the main content instead of showing a citation-style intro panel above the body

## 3.2.5

- improved article image coverage in news cards by falling back to article-page metadata when feeds omit image data
- intentionally limited that image fallback to a small number of recent imageless articles per feed to keep refresh latency and source-site load under control
- refreshed topic filter chips to use the new outlined style with matching topic-icon badges while keeping their sizing aligned with source filters
- added a user setting to hide images from news cards for a more compact feed layout
- added a GitHub project shortcut to the settings panel and release-notes popup

## 3.2.4

- corrected future-dated articles during ingestion so a bad source timestamp no longer leaves one story pinned at the top of the feed
- added cleanup for already-saved future-dated articles so hosted instances recover automatically after the update
- hardened article and feed URL handling to block unsafe links and server-side fetch targets
- made live updates respect excluded sources and excluded sub-feeds more consistently
- fixed settings-panel state drift so editing custom sources no longer leaks unsaved preference changes into the active app state
- split the backend database layer into focused modules, simplified logger startup hooks, and squashed legacy SQLite migrations into the current supported schema baseline

## 3.2.3

- refreshed the frontend experience with clearer settings, a simpler top bar and user menu, more readable filters, easier-to-scan news cards, and tighter mobile behavior including full-screen settings and iPhone input zoom fixes
- made refresh behavior easier to understand by keeping new-article availability aligned with already loaded content and replacing the numeric badge with a simple dot
- locked background scrolling consistently for settings, changelog, and reader mode overlays
- localized canonical topic labels across the UI, added shared topic icons, and simplified article actions with the new `Open article` wording

## 3.2.2

- fixed same-source duplicate articles during refreshes by switching article identity to stable canonical URLs before falling back to feed GUIDs or content metadata
- added canonical URL normalization and a database migration that stores canonical article URLs, merges existing same-source duplicates, and enforces per-source uniqueness for future ingestions
- strengthened ingestion deduplication and regression coverage for feeds that change GUIDs, tracking parameters, or publish timestamps across refreshes

## 3.2.1

- 🔄 replaced the notification center with a clearer refresh flow that combines live-update status and new-article counts in one top-bar action
- 👤 cleaned up the header and user menu by moving connection status and the language switcher into the user menu and improving the mobile layout
- 📚 added a per-user desktop reader panel position setting with left, center, and right options
- 📰 simplified news cards and filters by reducing card metadata noise and keeping filters collapsed by default on first load
- 🚫 temporarily disabled similar-article merging to reduce false positives in grouped news
- ✅ improved live new-article counting stability and added a localized in-app release notes popup with changelog access from settings

## 3.1.2

- replaced manual configured source-family grouping with registrable-domain grouping so feeds from the same publisher domain, such as ABC News, merge automatically
- removed the temporary saved-preference compatibility layer for old source ids and added a database migration to rewrite stored exclusions to the new registrable-domain source families
- extended registrable-domain source grouping to custom user feeds so same-domain personal feeds merge consistently in filters, source chips, and source statistics

## 3.1.1

- split backend aggregation logic into focused grouping, ingestion, and feed-query modules
- split the settings UI into dedicated sections plus a state hook for transfer, exclusions, and custom source editing

## 3.1.0

- replaced full ingestion after personal source changes with targeted per-user refreshes, queued ingestion work, and batched article/topic persistence for lower backend load
- made user settings import atomic, throttled expired-session cleanup, expanded CORS for `PATCH` and `DELETE`, and tightened WebSocket filtering and notification handling
- improved RSS and reader internals with bounded cache cleanup, shared error summarization, and small dead-code removals and metadata/query cleanups
- prevented stale frontend news and reader requests from overwriting newer UI state by adding abort-aware latest-request handling
- simplified frontend code paths with shared request helpers, safer settings exclusions, and small merge/filter readability refactors
- added backend and frontend regression coverage for import flows, targeted refreshes, session cleanup throttling, stale-request protection, and smoke-tested the passwordless auth/settings/logout flow

## 3.0.18

- removed the unused admin and debug API endpoints for manual refresh, WebSocket status, and broadcast notifications
- removed the related admin-token deployment and documentation requirements to simplify Kubernetes and container setup

## 3.0.17

- removed article previews from news cards and tightened card chip rows so source and topic areas keep a cleaner, more uniform one-line height

## 3.0.16

- replaced the separate header settings/logout buttons with a compact user menu beside notifications that shows the username, settings, and logout actions

## 3.0.15

- restricted news topics to a canonical taxonomy so invalid feed labels like home, home top, argomento, and bits no longer appear in topic filters

## 3.0.14

- replaced the custom near-duplicate grouping heuristic with a SimHash-based approach enriched by time proximity and shared named-entity/topic signals

## 3.0.13

- removed backend file logging and switched fully to stdout/stderr logging for simpler container operation
- simplified Docker setup by removing the backend log volume and log-directory permission handling

## 3.0.12

- added per-user sub-feed exclusions so grouped sources can stay enabled while specific feeds are disabled in settings

## 3.0.11

- service restart now removes articles and stale excluded-source settings for default sources that were removed from configuration
- removed the old multi-RSS source handling and kept configured sources as explicit single-feed entries
- grouped related feeds such as ANSA and Il Sole 24 Ore under shared source families for filters, exclusions, and source stats

## 3.0.10

- allowed local-network origins such as `.local` hostnames and LAN IPs so self-hosted access works from other devices

## 3.0.9

- renamed source exclusion settings from hidden to excluded across the API and frontend to keep the terminology consistent
- removed the temporary hidden-source compatibility layer because the project is still pre-release

## 3.0.8

- added targeted backend tests for news aggregation paging, broadcasting, and empty-feed failure handling
- added deeper SQLite tests for article filtering, user source cleanup, and source/topic statistics

## 3.0.7

- added backend lint configuration compatible with ESLint 9 so static checks run correctly again
- added backend integration tests for authentication, user settings, personal source flows, and SQLite migrations
- added frontend smoke tests for session bootstrapping and authenticated shell rendering

## 3.0.6

- removed unused API and WebSocket code paths to simplify the live update and feed interfaces
- reduced frontend complexity by simplifying real-time connection handling and consolidating settings and locale helpers
- removed unused frontend testing dependencies and other small dead code paths to improve readability

## 3.0.5

- removed the Ollama AI integration and related configuration from the application
- removed the last legacy AI topic metadata from the SQLite schema and database migration path

## 3.0.4

- secured WebSocket connections with user session authentication
- limited live news and topic updates to the correct user session so private feeds do not leak across users

## 3.0.3

- added automatic feed name and language detection when saving a new personal RSS source
- added editing support for personal RSS sources after creation

## 3.0.2

- added settings export and import for personal preferences and custom RSS sources

## 3.0.1

- changed personal source preferences from default selected sources to hidden sources excluded from each user feed
- hidden sources now disappear from each user's source filters while remaining restorable from personal settings
- added a database write-permission startup check and database status reporting in the health endpoint

## 3.0.0

- added user registration and login with optional passwords
- added per-user sessions, private settings, and personal default language selection
- added per-user hidden sources, lower personal retention, and lower quick-filter window settings
- added personal RSS source management with feed validation and private ingestion

## 2.2.7

- added configurable automatic cleanup for articles and reader cache older than 24 hours

## 2.2.6

- moved the live connection status from the header badge into the notifications panel
- moved the refresh action into the site logo/title block and removed the separate refresh button
- simplified the language selector by removing the extra label and keeping only the locale switch

## 2.2.5

- added custom News Flow branding with a new site logo and favicon
- updated the in-app header and web manifest to use the new brand assets

## 2.2.4

- moved the reader refresh action next to the original source link to leave more space for the reader title

## 2.2.3

- updated reader mode to use the same base font as the rest of the website for better readability

## 2.2.2

- improved reader panel typography and spacing for easier reading
- added icons to reader mode metadata, states, and actions

## 2.2.1

- improved reader mode to preserve article structure more accurately
- added structured reader blocks for paragraphs, headings, lists, quotes, and preformatted text
- added reader cache support for structured content blocks

## 2.2.0

- added in-app reader mode with clean text extraction and no images
- added SQLite caching for reader content to speed up repeated reads
- added server endpoint for per-article reader views

## 2.1.0

- added English/Italian UI localization with browser-language default and manual switch
- added a small language indicator on news cards

## 2.0.0

- moved persistence from memory/JSON to local SQLite with FTS5 search
- added scheduled background scraping
- added server-side filtering and pagination
- improved tagging with RSS/category fallback, keyword inference, and optional AI enrichment
- simplified the WebSocket layer for multi-user live updates
- removed unused frontend and backend code
