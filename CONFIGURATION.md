# Configuration Reference

This file documents the environment variables and build arguments that can change News Flow behavior. The README keeps only the essential setup values; use this file when you want to tune deployment, ingestion, AI, public API, reader extraction, or feedback delivery.

## How Values Are Parsed

- Boolean feature flags for AI accept `true` or `false`, ignoring case and surrounding whitespace. Missing or empty values use the documented default. Invalid values disable the AI feature.
- Public API booleans use the same normalization. Missing, empty, or invalid values fall back to the documented default.
- `COOKIE_SECURE` accepts only `auto`, `true`, or `false`. Production startup rejects invalid values.
- Most numeric settings use base-10 `parseInt`, so `2.9` becomes `2` and `1500ms` becomes `1500`. Missing, empty, invalid, or out-of-range values fall back to the documented default unless the notes say the value is clamped.
- AI topic batch settings and topic/story/summary request timeouts use `Number` parsing instead: fractions are rounded down before range checks, and trailing text is rejected. Unset or non-finite values use the default. Empty or whitespace-only strings become `0`, which selects the minimum for clamped topic settings and the default for story/summary timeouts.
- Durations ending in `_MS` are milliseconds unless the variable name says otherwise.
- Docker Compose sets some explicit defaults that differ from raw code defaults; those differences are called out where they matter.
- Docker Compose forwards values from an optional root `.env` file to the backend. Explicit service `environment` entries take precedence; see [Docker And Build-Time Values](#docker-and-build-time-values) for fixed overrides. npm scripts do not automatically load the root `.env` file; provide values through the backend process environment.

## Runtime And Security

| Variable | Scope | Default | Details |
| --- | --- | --- | --- |
| `NODE_ENV` | Backend | Docker sets `production`; otherwise unset/development behavior | Enables production security defaults, production logging defaults, and less detailed error output. Tests commonly set `test`. |
| `PORT` | Backend | `5000` | Internal HTTP listen port. Compose publishes only Caddy ports `80` and `443`. |
| `SESSION_TTL_DAYS` | Backend | `30` | Browser auth session lifetime in days. Minimum `1`. |
| `APP_BASE_URL` | Backend | Compose `http://localhost`; OpenRouter referer fallback `http://localhost` | Canonical public app URL. Used for setup links, secure-cookie decisions, same-origin checks, and OpenRouter referer metadata. Set to `https://your-domain` in HTTPS deployments. |
| `FRONTEND_BASE_URL` | Backend | unset | Legacy fallback when `APP_BASE_URL` is not set, used for setup links, same-origin checks, and secure-cookie decisions. If neither URL is set, setup links fall back to `http://localhost:3000`. Prefer `APP_BASE_URL`. |
| `COOKIE_SECURE` | Backend | `auto` | Controls `Secure` on session cookies. `auto` uses HTTPS from `APP_BASE_URL` (or `FRONTEND_BASE_URL`) or a trusted request; `true` always requires HTTPS; `false` disables secure cookies. |
| `TRUST_PROXY` | Backend | `false`; Compose fixed at `1` | Controls Express trust-proxy behavior. `true` maps to one trusted hop, not unlimited proxy trust. Also accepts `false`, a numeric hop count, or a comma-separated proxy list. The bundled topology has one Caddy hop. |

## Backend Core

| Variable | Default | Details |
| --- | --- | --- |
| `NEWS_DB_PATH` | `backend/data/news.db`; Docker `/usr/src/app/data/news.db` | SQLite database path for articles, users, settings, summaries, sessions, and public API data. Compose persists `/usr/src/app/data` in the host's `backend/data/` directory. |
| `ADMIN_USERNAME` | `admin` | Reserved admin account username. Backend auth lowercases it; user-service display/bootstrap handling trims to 40 chars. |
| `ALLOWED_ORIGINS` | Development `*`; production localhost origins; Compose `APP_BASE_URL` | Comma-separated public API and Socket.IO origin allowlist. Private browser APIs additionally require the exact same origin as `APP_BASE_URL`. Supports exact origins, `*`, wildcard patterns, and `@local-network`. |
| `SERVER_TIMEOUT` | `60000` | Backend HTTP server timeout in ms. Minimum `1000`. |
| `LOG_LEVEL` | `info` in production, `debug` otherwise | Console log threshold: `error`, `warn`, `info`, `http`, `verbose`, `debug`, or `silly`. Logs include an ISO timestamp and are silent in tests. |
| `SESSION_PURGE_INTERVAL_MS` | `300000` | Interval for backend expired auth/session cleanup. Minimum `1000`. |
| `SESSION_REFRESH_WINDOW_MS` | `86400000` | Backend session renewal window before expiry. Minimum `0`. |
| `USER_ACTIVITY_TOUCH_INTERVAL_SECONDS` | `60` | Minimum interval between persisted user activity timestamp updates. Minimum `0`. |
| `PASSWORD_SETUP_TTL_MINUTES` | `60` | Password setup/reset link lifetime. Minimum `1`. |
| `ADMIN_BOOTSTRAP_TTL_MINUTES` | `30` | Single-use admin bootstrap link lifetime. Minimum `1`. |
| `ONLINE_ACTIVITY_WINDOW_MINUTES` | `5` | Window used to consider users recently active in admin views and scheduled source selection fallback. Minimum `0`. |
| `FRONTEND_DIST_DIR` | `backend/public` | Directory served for built frontend assets. The Docker image copies `frontend/dist` here. |

## Bundled TLS Ingress

Docker Compose runs Caddy as the only host-facing service. Caddy handles TLS and compression, then proxies HTTP, WebSocket, and static frontend requests to the backend. The backend has no published host port.

`APP_BASE_URL=https://your-domain` enables Caddy's automatic certificate management. The domain must resolve to the host and ports `80` and `443` must be reachable. Named volumes `caddy-data` and `caddy-config` preserve certificate and Caddy runtime state.

## Public API

| Variable | Default | Details |
| --- | --- | --- |
| `PUBLIC_API_ANONYMOUS_ENABLED` | `false` | Enables unauthenticated `GET /api/public/news` only when set to `true`. |
| `PUBLIC_API_AUTHENTICATED_ENABLED` | `false` | Enables API-token access to `GET /api/public/news` and exposes token controls in Settings only when set to `true`. |
| `API_TOKEN_USAGE_FLUSH_INTERVAL_MS` | `5000` | Flush interval for API-token usage counters. Minimum `1000`. |
| `API_TOKEN_USAGE_FLUSH_THRESHOLD` | `50` | Number of API-token requests that triggers an early usage-counter flush. Minimum `1`. |
| `ANONYMOUS_PUBLIC_USAGE_FLUSH_INTERVAL_MS` | `5000` | Flush interval for anonymous public API usage counters. Minimum `1000`. |
| `ANONYMOUS_PUBLIC_USAGE_FLUSH_THRESHOLD` | `100` | Number of anonymous public API requests that triggers an early usage-counter flush. Minimum `1`. |
| `AUTHENTICATED_PUBLIC_USAGE_FLUSH_INTERVAL_MS` | `5000` | Flush interval for authenticated public API usage counters. Minimum `1000`. |
| `AUTHENTICATED_PUBLIC_USAGE_FLUSH_THRESHOLD` | `50` | Number of authenticated public API requests that triggers an early usage-counter flush. Minimum `1`. |

The public API is read-only and cache-only. It must not trigger RSS refreshes, article extraction, or AI work.

## Feed, RSS, And Storage

| Variable | Default | Details |
| --- | --- | --- |
| `ARTICLE_RETENTION_HOURS` | `24` | Article and reader-cache retention window. Minimum `0`; `0` disables age cutoff in ingestion paths. |
| `SCRAPE_INTERVAL_MS` | `900000` | Scheduled RSS ingestion interval. Minimum `1000`. |
| `MANUAL_REFRESH_COOLDOWN_MS` | `300000` | Per-user cooldown for manual refresh attempts. Minimum `0`. |
| `SOURCE_REFRESH_ACTIVE_WINDOW_MINUTES` | `ONLINE_ACTIVITY_WINDOW_MINUTES` or `5`; Compose `5` | Scheduled ingestion refreshes sources assigned to users active in this window. Minimum `0`. |
| `SOURCE_FETCH_FRESHNESS_MS` | `300000` | De-dupe window that skips upstream RSS fetches recently completed by any refresh path. Minimum `0`. |
| `SOURCE_FETCH_FRESHNESS_MAX_ENTRIES` | `1000` | Max source freshness records retained in memory. Minimum `1`. |
| `SOURCE_FETCH_FRESHNESS_RETENTION_MS` | `max(SOURCE_FETCH_FRESHNESS_MS * 6, 3600000)` | Retention for source freshness records. Minimum `1000`. |
| `SOURCE_FETCH_FAILURE_BACKOFF_MS` | `120000` | Initial per-source backoff after RSS fetch failures. Minimum `0`. |
| `SOURCE_FETCH_FAILURE_MAX_BACKOFF_MS` | `1800000` | Maximum per-source RSS failure backoff. Minimum `1000`. |
| `RSS_INGESTION_CONCURRENCY` | `8` | Max RSS sources processed concurrently per ingestion and process-wide RSS/article-image network requests. Minimum `1`. |
| `MAX_ARTICLES_PER_SOURCE` | `25` | Max parsed RSS items processed per source. Minimum `1`. |
| `RSS_MAX_RETRIES` | Code `4`; Compose fixed at `5` | RSS fetch retry attempts. Minimum `1`. |
| `RSS_RETRY_DELAY` | Code `1500`; Compose fixed at `2000` | Base delay between RSS retries in ms. Minimum `0`. |
| `RSS_TIMEOUT` | `15000` | RSS request timeout in ms. Minimum `1`. |
| `RSS_VALIDATION_MAX_RETRIES` | `2` | Retry count for backend RSS validation. Minimum `1`. |
| `RSS_VALIDATION_TIMEOUT` | `8000` | Timeout for backend RSS validation. Minimum `1`. |
| `RSS_INTERACTIVE_VALIDATION_TIMEOUT` | `8000` | Timeout for custom-RSS validation triggered by user interactions. Minimum `1`. |
| `RSS_INTERACTIVE_VALIDATION_RETRIES` | `2` | Retry count for custom-RSS validation triggered by user interactions. Minimum `1`. |
| `MAX_CUSTOM_SOURCES_PER_USER` | `8` | Maximum custom RSS sources retained for one user, including inactive sources. Minimum `1`, maximum `100`. |
| `RSS_CACHE_TTL` | `60000` | In-memory RSS response cache TTL in ms. Minimum `0`. |
| `RSS_CACHE_MAX_ENTRIES` | `200` | Max in-memory RSS response cache entries. Minimum `0`. |
| `RSS_MAX_RESPONSE_BYTES` | `1048576` | Max RSS/XML response size in bytes. Minimum `1`. |
| `RSS_DISCOVERY_MAX_RESPONSE_BYTES` | `6291456` | Max website HTML or RSS-directory response size during feed discovery. Minimum `1`. |
| `FILTER_STATS_CACHE_TTL_MS` | `10000` | Feed filter-stat cache TTL. Minimum `0`, maximum `300000`. |
| `FILTER_STATS_CACHE_MAX_ENTRIES` | `200` | Feed filter-stat cache entries. Minimum `1`, maximum `5000`. |

## Reader, Images, And Outbound Safety

| Variable | Default | Details |
| --- | --- | --- |
| `READER_TIMEOUT` | `12000` | Reader-mode article fetch timeout in ms. Minimum `1`. |
| `READER_CACHE_TTL_MS` | `86400000` | Successful reader-cache TTL. Minimum `0`. |
| `READER_FALLBACK_CACHE_TTL_MS` | `900000` | Failed or empty reader fallback cache TTL. Minimum `0`. |
| `READER_FALLBACK_CACHE_PRUNE_INTERVAL_MS` | `min(max(READER_FALLBACK_CACHE_TTL_MS or 60000, 1000), 60000)` | Cleanup interval for reader fallback cache. Minimum `1000`. |
| `READER_MAX_RESPONSE_BYTES` | `2097152` | Max fetched article HTML size for reader extraction. Minimum `1`. |
| `READER_EXTRACTION_CONCURRENCY` | `3` | Max parallel reader extractions. Minimum `1`. |
| `READER_EXTRACTION_MAX_PENDING` | `60` | Global pending reader extraction queue cap. Minimum is the configured reader concurrency. |
| `READER_EXTRACTION_MAX_PENDING_PER_USER` | `20` | Per-user pending reader extraction queue cap. Minimum `1`. |
| `ARTICLE_IMAGE_TIMEOUT` | `8000` | Article-page image fallback fetch timeout in ms. Minimum `1`. |
| `ARTICLE_IMAGE_CACHE_TTL` | `21600000` | Article-image fallback cache TTL in ms. Minimum `0`. |
| `ARTICLE_IMAGE_CACHE_MAX_ENTRIES` | `500` | Max article-image fallback cache entries. Minimum `0`. |
| `ARTICLE_IMAGE_FALLBACK_LIMIT` | `4` | Max recent articles per refresh that trigger article-page image fallback extraction. Minimum `0`. |
| `ARTICLE_IMAGE_MAX_RESPONSE_BYTES` | `524288` | Max article HTML size fetched only for image fallback extraction. Minimum `1`. |
| `OUTBOUND_MAX_REDIRECTS` | `5` | Safe outbound fetch redirect limit. Minimum `0`. |
| `OUTBOUND_MAX_RESPONSE_BYTES` | `2097152` | Default max generic outbound HTTP response body size. Minimum `1`. |

## WebSocket

| Variable | Default | Details |
| --- | --- | --- |
| `WS_PING_TIMEOUT` | `60000` | Socket.IO ping timeout in ms. Minimum `1000`. |
| `WS_PING_INTERVAL` | `25000` | Socket.IO ping interval in ms. Minimum `1000`. |

## AI Provider And Feature Switches

AI features run only in the backend, and provider-backed work requires `OPENROUTER_API_KEY`. Raw backend feature switches default to `true`; Docker Compose defaults only topic detection to `true` and the other two switches to `false`.

| Variable | Default | Details |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | unset | Server-side OpenRouter API key used for topic detection, story grouping, and summaries. |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | OpenRouter-compatible API base URL. Trailing slashes are removed. |
| `OPENROUTER_FAILURE_BACKOFF_MS` | `60000` | Initial model-specific pause after transient provider, network, rate-limit, or authentication failures. Minimum `1000`, maximum `3600000`. |
| `OPENROUTER_FAILURE_MAX_BACKOFF_MS` | `900000` | Maximum model-specific provider pause after repeated failures. Minimum `1000`, maximum `86400000`. Successful requests clear the backoff. |
| `AI_TOPIC_DETECTION_ENABLED` | Code and Compose: `true` | Enables AI topic classification when the API key is present. Invalid values disable it. |
| `AI_STORY_GROUPING_ENABLED` | Code: `true`; Compose: `false` | Enables AI-assisted story grouping when the API key is present. Invalid values disable it. |
| `AI_SUMMARY_GENERATION_ENABLED` | Code: `true`; Compose: `false` | Enables thematic summaries when the API key is present and controls summary UI visibility. Invalid values disable it. |

## AI Topic Detection

| Variable | Default | Details |
| --- | --- | --- |
| `OPENROUTER_TOPIC_MODEL` | `mistralai/mistral-small-24b-instruct-2501` | Model used for AI topic classification. |
| `AI_TOPIC_BATCH_SIZE` | `10` | Articles per topic-classification request. `Number` parsing, rounded down and clamped to `1..50`. |
| `AI_TOPIC_BATCH_CONCURRENCY` | `1` | Concurrent topic-classification requests. `Number` parsing, rounded down and clamped to `1..4`. |
| `AI_TOPIC_MAX_ARTICLES_PER_REFRESH` | `160` | Max newly inserted articles sent to AI per refresh. `Number` parsing, rounded down and clamped to `1..1000`. |
| `AI_TOPIC_REQUEST_TIMEOUT_MS` | `30000` | Timeout for one topic-classification request. `Number` parsing, rounded down and clamped to `1000..120000`. |
| `AI_TOPIC_DETERMINISTIC_SKIP_ENABLED` | `true` | Skips OpenRouter classification for articles with high-confidence local topic matches. Invalid values disable it. |
| `AI_TOPIC_DEBUG_LOG_ARTICLES` | `false` | Enables verbose topic debug logging only when set to `true`. Invalid values disable it. |

## AI Story Grouping

| Variable | Default | Details |
| --- | --- | --- |
| `OPENROUTER_STORY_GROUPING_MODEL` | `qwen/qwen3.7-flash` | Model used to decide whether articles describe the same story. |
| `AI_STORY_GROUPING_REQUEST_TIMEOUT_MS` | `120000` | Timeout for one story-grouping request. `Number` parsing, rounded down; valid `1000..120000`. Invalid/out-of-range values fall back to the default. |
| `AI_STORY_GROUPING_CONCURRENCY` | `1` | Concurrent story-grouping jobs during ingestion. Minimum `1`, maximum `4`. |
| `AI_STORY_GROUPING_WINDOW_HOURS` | `24` | Candidate article age window for grouping. Minimum `1`, maximum `72`. |
| `AI_STORY_GROUPING_CANDIDATE_LIMIT` | `64` | Candidate articles considered before AI filtering. Minimum `8`, maximum `100`. |
| `AI_STORY_GROUPING_AI_CANDIDATE_LIMIT` | `8` | Candidate articles sent to AI for one grouping decision after lexical/topic filtering. Minimum `1`, maximum `12`. |
| `AI_STORY_GROUPING_RETRY_LIMIT` | `12` | Retry limit for deferred story grouping. Minimum `0`, maximum `50`. |

## AI Summaries And Prewarm

Each thematic summary uses two sequential requests to `OPENROUTER_SUMMARY_MODEL`: bilingual generation, then a source-grounding review of the exact same excerpts. The review checks claim support, citations, contradictions, uncertainty, and translation consistency; failed or malformed reviews are retried through the existing invalid-output policy. This is an additional AI check, not an independent fact-check of the publishers.

The default selection prioritizes stories covered by multiple publishers, deduplicates them, and balances sources across up to 24 stories. The 30,000-character text budget allows up to 1,250 characters per story at that cap, including longer RSS content when reader text is unavailable. Completed summaries retain their exact input excerpts in SQLite for later evaluation. Source fingerprints trigger regeneration for changed evidence or replacement articles, while retention-only removals preserve the previous briefing. Reader caches are invalidated when article text changes. The reader panel shows the last successful generation timestamp.

To check the configured model against a small fixed evidence set, run `npm run eval:summaries` in `backend/` with `OPENROUTER_API_KEY` set. This makes seven live grounding requests covering supported facts, invented numbers, uncertainty, contradictions, geographic scope, and language consistency; it exits nonzero for mismatches or invalid responses. `npm run eval:summaries -- --help` is offline. Use this smoke evaluation alongside manual reviews of saved excerpts before changing models or prompts.

| Variable | Default | Details |
| --- | --- | --- |
| `OPENROUTER_SUMMARY_MODEL` | `qwen/qwen3.7-flash` | Model used for thematic summaries. |
| `AI_SUMMARY_REQUEST_TIMEOUT_MS` | `120000` | Timeout for each thematic-summary request. `Number` parsing, rounded down; valid `1000..120000`. Invalid/out-of-range values fall back to the default. |
| `AI_SUMMARY_TIME_ZONE` | `Europe/Rome` | IANA time zone used for the daily `20:00` summary slot. Invalid zones fall back to `Europe/Rome`. |
| `THEMATIC_SUMMARY_CHECK_INTERVAL_MS` | `60000` | Scheduler interval for checking due summaries. Minimum `1000`. |
| `AI_SUMMARY_MAX_ARTICLES_PER_TOPIC` | `120` | Max built-in topic-tagged articles queried before deduplication and prompt selection. Minimum `1`, maximum `300`. |
| `AI_SUMMARY_PROMPT_MAX_ARTICLES` | `24` | Max deduped/source-balanced articles included in one thematic-summary prompt. Minimum `1`, maximum `AI_SUMMARY_MAX_ARTICLES_PER_TOPIC`. |
| `AI_SUMMARY_GENERATION_CONCURRENCY` | `2` | Max topic summary generations run concurrently for one due window. Minimum `1`, maximum `6`. |
| `AI_SUMMARY_PROMPT_TEXT_BUDGET_CHARS` | `30000` | Hard aggregate description/reader-text budget divided across selected summary articles. Prompt instructions and bounded article metadata are additional. Minimum `10000`, maximum `240000`. |
| `AI_SUMMARY_INVALID_OUTPUT_MAX_RETRIES` | `2` | Additional retries for invalid summary model output before treating it as terminal. Minimum `0`, maximum `10`. |
| `AI_SUMMARY_PENDING_TOPIC_GRACE_MS` | `900000` | How long after a summary slot to wait for pending topic classification before persisting an empty window from available data. Minimum `0`, maximum `21600000`. |
| `AI_SUMMARY_POST_TOPIC_DEBOUNCE_MS` | `5000` | Debounce delay for summary checks triggered by completed topic-classification batches. Minimum `0`, maximum `60000`. |
| `AI_SUMMARY_READER_PREWARM_ENABLED` | `true` | Prewarms only articles selected for enabled summary prompts before a due window. Invalid values disable it. |
| `AI_SUMMARY_READER_PREWARM_MINUTES_BEFORE` | `30` | Minutes before a summary slot when prewarm can start. Minimum `1`, maximum `180`. |
| `AI_SUMMARY_READER_PREWARM_CONCURRENCY` | `2` | Concurrent reader extractions during summary prewarm. Minimum `1`, maximum `8`. |
| `AI_SUMMARY_READER_PREWARM_RETRY_COOLDOWN_MS` | `300000` | Cooldown before retrying a failed reader prewarm attempt for the same article/window. Minimum `0`, maximum `3600000`. |
| `AI_SUMMARY_READER_TEXT_MAX_CHARS` | `3000` | Max cached reader-text chars sent per article to summary prompts. Minimum `500`, maximum `12000`. |
| `AI_SUMMARY_READER_TEXT_MIN_CHARS` | `250` | Minimum cached reader-text length considered useful for summary input. Minimum `80`, maximum `2000`. |
| `AI_SUMMARY_FAILED_RETRY_COOLDOWN_MS` | `600000` | Cooldown before retrying failed summaries. Minimum `0`, maximum `86400000`. |

## Feedback And Telegram

| Variable | Default | Details |
| --- | --- | --- |
| `TELEGRAM_API_BASE_URL` | `https://api.telegram.org` | Telegram API base URL for feedback forwarding. Trailing slashes are removed. |
| `TELEGRAM_BOT_TOKEN` | unset | Bot token used to forward feedback submissions. Required with `TELEGRAM_CHAT_ID` for feedback delivery. |
| `TELEGRAM_CHAT_ID` | unset | Target Telegram chat/channel/supergroup id. Required with `TELEGRAM_BOT_TOKEN` for feedback delivery. |
| `TELEGRAM_MESSAGE_THREAD_ID` | unset | Optional Telegram forum topic id. Must be numeric when set. |
| `FEEDBACK_DELIVERY_TIMEOUT_MS` | `25000` | Total deadline for attachment and text delivery to Telegram. Minimum `1000`, maximum `120000`. |

Feedback attachments are limited by code, not env: images up to 5 MB, videos up to 12 MB, one attachment per submission.

## Frontend Development

| Variable | Default | Details |
| --- | --- | --- |
| `VITE_BACKEND_ORIGIN` | `http://localhost:5000` | Vite dev-server proxy target for `/api`, `/api/public`, and `/socket.io`. Browser application code still calls relative `/api/*` paths. |

## Docker And Build-Time Values

| Variable | Scope | Default | Details |
| --- | --- | --- | --- |
| `TARGETARCH` | Backend Docker build | BuildKit-provided when available; otherwise Node `process.arch` | Selects native dependency architecture during `npm ci`; maps `amd64` to `x64`. |
| `BUILDPLATFORM` | Docker builds | Docker/BuildKit automatic | Used by Dockerfiles in `FROM --platform=$BUILDPLATFORM` for dependency build stages. |

The bundled Compose service hardcodes `TRUST_PROXY=1`, `RSS_MAX_RETRIES=5`, and `RSS_RETRY_DELAY=2000`. These explicit `environment` entries override values in `.env`; changing them requires editing or overriding the Compose service configuration. Other explicit entries, such as `APP_BASE_URL` and the AI feature switches, interpolate configurable values with defaults.

`NODE_ENV=production` and `PORT=5000` are Docker image defaults. `LOG_LEVEL=info` in production and `/usr/src/app/data/news.db` are backend defaults. All four can be overridden through `.env`, but the bundled Caddy upstream and application health check expect port `5000`, and only `/usr/src/app/data` is mounted for persistent application data. Caddy alone publishes host ports `80` and `443`.

After changing `.env`, run `docker compose up -d` to recreate affected services with the new values.
