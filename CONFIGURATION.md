# Configuration Reference

This file documents the environment variables and build arguments that can change News Flow behavior. The README keeps only the essential setup values; use this file when you want to tune deployment, ingestion, AI, public API, reader extraction, or feedback delivery.

## How Values Are Parsed

- Boolean feature flags for AI accept only `true` or `false`. Missing values default to the documented default. Invalid values disable the AI feature.
- Public API booleans accept `true` or `false`. Missing or invalid values fall back to the documented default.
- `COOKIE_SECURE` accepts only `auto`, `true`, or `false`. Invalid values behave as insecure/disabled.
- Most numeric values are integers. If a value is outside the documented range, the code usually falls back to the default unless the notes say it is clamped.
- Durations ending in `_MS` are milliseconds unless the variable name says otherwise.
- Docker Compose sets some explicit defaults that differ from raw code defaults; those differences are called out where they matter.

## Required Production Secrets

| Variable | Scope | Default | Details |
| --- | --- | --- | --- |
| `INTERNAL_PROXY_TOKEN` | Backend, BFF | Development fallback outside production; required by Compose | Shared secret used by the BFF when calling backend private HTTP and Socket.IO routes. Must match in both services. Production rejects a missing value or the development fallback. |
| `BFF_SESSION_SECRET` | BFF | Development fallback outside production; required by Compose | Signs browser sessions and derives the key used to encrypt stored backend-session cookies. Keep stable across restarts or users are logged out. Production rejects a missing value or the development fallback. |

## Shared Runtime And Security

| Variable | Scope | Default | Details |
| --- | --- | --- | --- |
| `NODE_ENV` | Backend, BFF | Docker images set `production`; otherwise unset/development behavior | Enables production security defaults, required secret checks, production logging defaults, and less detailed backend error output. Tests commonly set `test`. |
| `PORT` | Backend, BFF | Backend `5000`; BFF `80` | HTTP listen port. BFF validates `1..65535`. |
| `SESSION_TTL_DAYS` | Backend, BFF | `30` | Browser and backend auth session lifetime in days. Minimum `1`. |
| `INTERNAL_SERVICE_NAME` | Backend, BFF | `bff` | Internal service identity sent by the BFF and checked by the backend for private traffic. Keep the same on both sides. |
| `APP_BASE_URL` | Backend, BFF | Compose `http://localhost`; OpenRouter referer fallback `http://localhost` | Canonical public app URL. Used for setup links, secure-cookie decisions, same-origin checks, and OpenRouter referer metadata. Set to `https://your-domain` in HTTPS deployments. |
| `FRONTEND_BASE_URL` | Backend, BFF | Backend setup-link fallback `http://localhost:3000` in one path | Legacy alias used when `APP_BASE_URL` is not set. Prefer `APP_BASE_URL`. |
| `COOKIE_SECURE` | Backend, BFF | `auto` | Controls `Secure` on session cookies. `auto` uses secure cookies when `APP_BASE_URL` starts with `https://`; `true` always requires HTTPS; `false` disables secure cookies. |
| `TRUST_PROXY` | Backend, BFF | Backend: `1` in production and `false` otherwise; BFF: `false`; Compose backend: `true` | Controls Express trust-proxy behavior. BFF accepts `true`, `false`, a hop count like `1`, or a comma-separated proxy list. Use only behind trusted proxies. |

## Backend Core

| Variable | Default | Details |
| --- | --- | --- |
| `NEWS_DB_PATH` | `backend/data/news.db`; Compose `/usr/src/app/data/news.db` | SQLite database path for articles, users, settings, summaries, podcasts, sessions, and public API data. |
| `ADMIN_USERNAME` | `admin` | Reserved admin account username. Backend auth lowercases it; user-service display/bootstrap handling trims to 40 chars. |
| `ALLOWED_ORIGINS` | Development `*`; production `http://localhost,http://localhost:80,http://127.0.0.1,http://127.0.0.1:80,http://frontend,@local-network`; Compose omits `http://frontend` | Comma-separated backend CORS and Socket.IO origin allowlist. Supports exact origins, `*`, wildcard patterns, and `@local-network`. |
| `SERVER_TIMEOUT` | `60000` | Backend HTTP server timeout in ms. Minimum `1000`. |
| `LOG_LEVEL` | `info` in production, `debug` otherwise | Winston log level such as `debug`, `info`, `warn`, or `error`. |
| `SESSION_PURGE_INTERVAL_MS` | `300000` | Interval for backend expired auth/session cleanup. Minimum `1000`. |
| `SESSION_REFRESH_WINDOW_MS` | `86400000` | Backend session renewal window before expiry. Minimum `0`. |
| `USER_ACTIVITY_TOUCH_INTERVAL_SECONDS` | `60` | Minimum interval between persisted user activity timestamp updates. Minimum `0`. |
| `PASSWORD_SETUP_TTL_MINUTES` | `60` | Password setup/reset link lifetime. Minimum `1`. |
| `ADMIN_BOOTSTRAP_TTL_MINUTES` | `30` | Single-use admin bootstrap link lifetime. Minimum `1`. |
| `ONLINE_ACTIVITY_WINDOW_MINUTES` | `5` | Window used to consider users recently active in admin views and scheduled source selection fallback. Minimum `0`. |

## BFF Core

| Variable | Default | Details |
| --- | --- | --- |
| `BACKEND_BASE_URL` | `http://backend:5000` | Backend upstream target used by the BFF proxy and session bridge. |
| `FRONTEND_DIST_DIR` | `bff/public` | Directory served by the BFF for built frontend assets. Docker copies `frontend/dist` here. |
| `BFF_SESSION_DB_PATH` | `bff/data/sessions.sqlite` | SQLite path for persisted BFF browser sessions. |
| `BFF_UPSTREAM_TIMEOUT_MS` | `30000` | BFF timeout for backend axios/proxy traffic. Minimum `1000`. |
| `SESSION_STORE_CLEAR_INTERVAL_MS` | `300000` | BFF expired-session cleanup interval. Minimum `1000`. |
| `SESSION_TOUCH_RENEWAL_WINDOW_MS` | `86400000` | Window before expiry when BFF session touches renew persisted session storage. Minimum `1000`. |

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
| `RSS_INGESTION_CONCURRENCY` | `8` | Max RSS sources processed concurrently during ingestion. Minimum `1`. |
| `MAX_ARTICLES_PER_SOURCE` | `25` | Max parsed RSS items processed per source. Minimum `1`. |
| `RSS_MAX_RETRIES` | Code `4`; Compose `5` | RSS fetch retry attempts. Minimum `1`. |
| `RSS_RETRY_DELAY` | Code `1500`; Compose `2000` | Base delay between RSS retries in ms. Minimum `0`. |
| `RSS_TIMEOUT` | `15000` | RSS request timeout in ms. Minimum `1`. |
| `RSS_VALIDATION_MAX_RETRIES` | `2` | Retry count for backend RSS validation. Minimum `1`. |
| `RSS_VALIDATION_TIMEOUT` | `8000` | Timeout for backend RSS validation. Minimum `1`. |
| `RSS_INTERACTIVE_VALIDATION_TIMEOUT` | `8000` | Timeout for custom-RSS validation triggered by user interactions. Minimum `1`. |
| `RSS_INTERACTIVE_VALIDATION_RETRIES` | `2` | Retry count for custom-RSS validation triggered by user interactions. Minimum `1`. |
| `RSS_CACHE_TTL` | `60000` | In-memory RSS response cache TTL in ms. Minimum `0`. |
| `RSS_CACHE_MAX_ENTRIES` | `200` | Max in-memory RSS response cache entries. Minimum `0`. |
| `RSS_MAX_RESPONSE_BYTES` | `1048576` | Max RSS/XML response size in bytes. Minimum `1`. |
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

AI features run only in the backend. Feature switches default to `true`, but provider-backed work still requires `OPENROUTER_API_KEY`.

| Variable | Default | Details |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | unset | Server-side OpenRouter API key used for topic detection, clickbait detection, story grouping, summaries, podcast scripts, and TTS. |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | OpenRouter-compatible API base URL. Trailing slashes are removed. |
| `AI_TOPIC_DETECTION_ENABLED` | `true` | Enables AI topic classification when the API key is present. Invalid values disable it. |
| `AI_CLICKBAIT_DETECTION_ENABLED` | `true` | Enables clickbait labels when the API key is present. Invalid values disable it. |
| `AI_STORY_GROUPING_ENABLED` | `true` | Enables AI-assisted story grouping when the API key is present. Invalid values disable it. |
| `AI_SUMMARY_GENERATION_ENABLED` | `true` | Enables thematic summaries when the API key is present and controls summary UI visibility. Invalid values disable it. |
| `AI_PODCAST_GENERATION_ENABLED` | `true` | Enables podcast script and audio generation when the API key is present and controls podcast UI visibility. Invalid values disable it. |

## AI Topic Detection

| Variable | Default | Details |
| --- | --- | --- |
| `OPENROUTER_TOPIC_MODEL` | `qwen/qwen3.5-9b` | Model used for AI topic classification. |
| `AI_TOPIC_BATCH_SIZE` | `10` | Articles per topic-classification request. Strict integer, clamped to `1..50`. |
| `AI_TOPIC_BATCH_CONCURRENCY` | `1` | Concurrent topic-classification requests. Strict integer, clamped to `1..4`. |
| `AI_TOPIC_MAX_ARTICLES_PER_REFRESH` | `160` | Max newly inserted articles sent to AI per refresh. Strict integer, clamped to `1..1000`. |
| `AI_TOPIC_REQUEST_TIMEOUT_MS` | `30000` | Timeout for one topic-classification request. Strict integer, clamped to `1000..120000`. |
| `AI_TOPIC_DETERMINISTIC_SKIP_ENABLED` | `true` | Skips OpenRouter classification for articles with high-confidence local topic matches. Invalid values disable it. |
| `AI_TOPIC_DEBUG_LOG_ARTICLES` | `false` | Enables verbose topic debug logging only when set to `true`. Invalid values disable it. |

## AI Clickbait Detection

| Variable | Default | Details |
| --- | --- | --- |
| `OPENROUTER_CLICKBAIT_MODEL` | `OPENROUTER_TOPIC_MODEL` | Optional model override for ambiguous clickbait labels. When unset, clickbait detection uses the topic model. |
| `AI_CLICKBAIT_REQUEST_TIMEOUT_MS` | `30000` | Timeout for one clickbait-classification request. Strict integer, clamped to `1000..120000`. |
| `AI_TOPIC_BATCH_SIZE` | `10` | Also controls articles per clickbait-classification request. |
| `AI_TOPIC_BATCH_CONCURRENCY` | `1` | Also controls concurrent clickbait-classification requests. |
| `AI_TOPIC_MAX_ARTICLES_PER_REFRESH` | `160` | Also limits newly inserted articles evaluated for clickbait per refresh. |
| `AI_TOPIC_DETERMINISTIC_SKIP_ENABLED` | `true` | Also skips OpenRouter clickbait classification when local headline signals are high confidence. |

## AI Story Grouping

| Variable | Default | Details |
| --- | --- | --- |
| `OPENROUTER_STORY_GROUPING_MODEL` | `deepseek/deepseek-v4-flash` | Model used to decide whether articles describe the same story. |
| `AI_STORY_GROUPING_REQUEST_TIMEOUT_MS` | `120000` | Timeout for one story-grouping request. Strict integer, valid `1000..120000`; invalid/out-of-range falls back. |
| `AI_STORY_GROUPING_CONCURRENCY` | `1` | Concurrent story-grouping jobs during ingestion. Minimum `1`, maximum `4`. |
| `AI_STORY_GROUPING_WINDOW_HOURS` | `24` | Candidate article age window for grouping. Minimum `1`, maximum `72`. |
| `AI_STORY_GROUPING_CANDIDATE_LIMIT` | `64` | Candidate articles considered before AI filtering. Minimum `8`, maximum `100`. |
| `AI_STORY_GROUPING_AI_CANDIDATE_LIMIT` | `8` | Candidate articles sent to AI for one grouping decision. Minimum `1`, maximum `12`. |
| `AI_STORY_GROUPING_RETRY_LIMIT` | `12` | Retry limit for deferred story grouping. Minimum `0`, maximum `50`. |

## AI Summaries And Prewarm

| Variable | Default | Details |
| --- | --- | --- |
| `OPENROUTER_SUMMARY_MODEL` | `deepseek/deepseek-v4-flash` | Model used for thematic summaries. |
| `AI_SUMMARY_REQUEST_TIMEOUT_MS` | `120000` | Timeout for thematic-summary requests and podcast-script requests. Strict integer, valid `1000..120000`; invalid/out-of-range falls back. |
| `AI_SUMMARY_TIME_ZONE` | `Europe/Rome` | IANA time zone used for `08:00` and `20:00` summary and podcast slots. Invalid zones fall back to `Europe/Rome`. |
| `THEMATIC_SUMMARY_CHECK_INTERVAL_MS` | `60000` | Scheduler interval for checking due summaries and podcasts. Minimum `1000`. |
| `AI_SUMMARY_MAX_ARTICLES_PER_TOPIC` | `120` | Max built-in topic-tagged articles sent to one thematic-summary request. Minimum `1`, maximum `300`. |
| `AI_SUMMARY_PROMPT_MAX_ARTICLES` | `60` | Max deduped/source-balanced articles included in one thematic-summary prompt. Minimum `1`, maximum `AI_SUMMARY_MAX_ARTICLES_PER_TOPIC`. |
| `AI_SUMMARY_GENERATION_CONCURRENCY` | `2` | Max topic summary generations run concurrently for one due window. Minimum `1`, maximum `6`. |
| `AI_SUMMARY_PROMPT_TEXT_BUDGET_CHARS` | `30000` | Approximate total article text budget for one summary prompt. Minimum `10000`, maximum `240000`. |
| `AI_SUMMARY_INVALID_OUTPUT_MAX_RETRIES` | `2` | Additional retries for invalid summary or podcast-script model output before treating it as terminal. Minimum `0`, maximum `10`. |
| `AI_SUMMARY_PENDING_TOPIC_GRACE_MS` | `900000` | How long after a summary slot to wait for pending topic classification before persisting an empty window from available data. Minimum `0`, maximum `21600000`. |
| `AI_SUMMARY_POST_TOPIC_DEBOUNCE_MS` | `5000` | Debounce delay for summary checks triggered by completed topic-classification batches. Minimum `0`, maximum `60000`. |
| `AI_SUMMARY_READER_PREWARM_ENABLED` | `true` | Prewarms reader-mode text before summary windows when summary generation is available. Invalid values disable it. |
| `AI_SUMMARY_READER_PREWARM_MINUTES_BEFORE` | `30` | Minutes before a summary slot when prewarm can start. Minimum `1`, maximum `180`. |
| `AI_SUMMARY_READER_PREWARM_CONCURRENCY` | `2` | Concurrent reader extractions during summary prewarm. Minimum `1`, maximum `8`. |
| `AI_SUMMARY_READER_PREWARM_RETRY_COOLDOWN_MS` | `300000` | Cooldown before retrying a failed reader prewarm attempt for the same article/window. Minimum `0`, maximum `3600000`. |
| `AI_SUMMARY_READER_TEXT_MAX_CHARS` | `3000` | Max cached reader-text chars sent per article to summary prompts. Minimum `500`, maximum `12000`. |
| `AI_SUMMARY_READER_TEXT_MIN_CHARS` | `250` | Minimum cached reader-text length considered useful for summary input. Minimum `80`, maximum `2000`. |
| `AI_SUMMARY_FAILED_RETRY_COOLDOWN_MS` | `600000` | Cooldown before retrying failed summaries. Minimum `0`, maximum `86400000`. |

## AI Podcasts And TTS

`AI_PODCAST_GENERATION_ENABLED` is the only podcast on/off switch. The variables below only tune podcast scripts or audio when podcast generation is enabled.

| Variable | Default | Details |
| --- | --- | --- |
| `OPENROUTER_PODCAST_SCRIPT_MODEL` | `deepseek/deepseek-v4-flash` | Model used for podcast script generation. |
| `AI_PODCAST_PROMPT_TEXT_BUDGET_CHARS` | `42000` | Approximate total article text budget for one podcast script prompt. Minimum `10000`, maximum `240000`. |
| `AI_PODCAST_PROMPT_MAX_ARTICLES` | `40` | Max deduped/source-balanced articles included in one podcast-script prompt. Minimum `1`, maximum `300`. |
| `AI_PODCAST_LANGUAGES` | `en` | Comma-separated podcast locales. Supported values are `en` and `it`; invalid entries are ignored. |
| `AI_PODCAST_BACKGROUND_AUDIO_ENABLED` | `true` | Persists podcast scripts with audio marked `generating`, then runs TTS audio generation in the background. Invalid values disable background startup. |
| `AI_PODCAST_HISTORY_RETAIN_COUNT` | `2` | Number of historical podcast entries retained. Minimum `1`, maximum `10`. |
| `OPENROUTER_PODCAST_AUDIO_MODEL` | `google/gemini-3.1-flash-tts-preview` | Model used for podcast TTS audio generation. |
| `AI_PODCAST_TTS_TIMEOUT_MS` | `120000` | Timeout for one podcast audio request. Strict integer, valid `1000..120000`; invalid/out-of-range falls back. |
| `AI_PODCAST_TTS_FORMAT` | `mp3` | Requested OpenRouter TTS `response_format`. Gemini TTS requests may need `pcm`; the backend wraps Gemini PCM into playable WAV audio when PCM is returned. |
| `AI_PODCAST_TTS_VOICE` | `Charon` | Requested TTS voice. Gemini voices include examples such as `Charon`, `Puck`, and `Orus`. |
| `AI_PODCAST_TTS_MAX_INPUT_BYTES` | Gemini model `3800`, otherwise `6000` | Max script input bytes sent to one TTS request. Minimum `500`, maximum `16000`. |
| `AI_PODCAST_TTS_MIN_AUDIO_BYTES` | `1024` | Minimum accepted audio response size. Minimum `44`, maximum `100000`. |
| `AI_PODCAST_TTS_CHUNK_MAX_BYTES` | Gemini model `min(700, max input)`, otherwise max input | Max script bytes per TTS chunk. Minimum `300`, maximum is `AI_PODCAST_TTS_MAX_INPUT_BYTES`. |
| `AI_PODCAST_TTS_MAX_CHUNKS` | `12` | Max TTS chunks generated for one podcast. Minimum `1`, maximum `30`. |
| `AI_PODCAST_TTS_CHUNK_SILENCE_MS` | `60` | Silence inserted between TTS chunks. Minimum `0`, maximum `500`. |
| `AI_PODCAST_TTS_RETRY_COOLDOWN_MS` | `600000` | Cooldown before retrying failed podcast audio. Minimum `0`, maximum `86400000`. |
| `AI_PODCAST_TTS_MAX_RETRIES` | `4` | Max podcast TTS retries. Minimum `0`, maximum `20`. |

## Feedback And Telegram

| Variable | Default | Details |
| --- | --- | --- |
| `TELEGRAM_API_BASE_URL` | `https://api.telegram.org` | Telegram API base URL for feedback forwarding. Trailing slashes are removed. |
| `TELEGRAM_BOT_TOKEN` | unset | Bot token used to forward feedback submissions. Required with `TELEGRAM_CHAT_ID` for feedback delivery. |
| `TELEGRAM_CHAT_ID` | unset | Target Telegram chat/channel/supergroup id. Required with `TELEGRAM_BOT_TOKEN` for feedback delivery. |
| `TELEGRAM_MESSAGE_THREAD_ID` | unset | Optional Telegram forum topic id. Must be numeric when set. |

Feedback attachments are limited by code, not env: images up to 5 MB, videos up to 12 MB, one attachment per submission.

## Frontend Development

| Variable | Default | Details |
| --- | --- | --- |
| `VITE_BFF_ORIGIN` | `http://localhost:80` | Vite dev-server proxy target for `/api`, `/api/public`, and `/socket.io`. Browser application code still calls relative `/api/*` paths. |

## Docker And Build-Time Values

| Variable | Scope | Default | Details |
| --- | --- | --- | --- |
| `TARGETARCH` | Backend and BFF Docker builds | BuildKit-provided when available; otherwise Node `process.arch` | Selects native dependency architecture during `npm ci`; maps `amd64` to `x64`. |
| `BUILDPLATFORM` | Docker builds | Docker/BuildKit automatic | Used by Dockerfiles in `FROM --platform=$BUILDPLATFORM` for dependency build stages. |

Docker Compose also applies fixed runtime defaults for the bundled deployment, including backend `NODE_ENV=production`, backend `PORT=5000`, BFF `PORT=80`, backend `TRUST_PROXY=true`, backend `LOG_LEVEL=info`, and container database paths. Edit `docker-compose.yml` only when those fixed deployment defaults need to change.
