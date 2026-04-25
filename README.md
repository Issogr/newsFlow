# News Flow

<p align="center">
  <img src="frontend/public/logo.svg" alt="News Flow logo" width="108" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-active-0f766e" alt="Project status: active" />
  <img src="https://img.shields.io/badge/license-GPL--3.0-1d4ed8" alt="License: GPL-3.0" />
</p>

<p align="center">
  A calm, personal RSS news hub that cuts through the noise with smart grouping, clean reader mode, live updates, and full control over your sources.
</p>

## Why It Stands Out

- News Flow is built to reduce the noise of modern RSS consumption: instead of showing the same story repeated across many feeds, it groups overlapping coverage into cleaner story clusters that are easier to scan.
- It stays lightweight and self-hostable by using local SQLite storage, built-in full-text search, and a small two-tier web architecture, so the project remains practical to deploy without extra infrastructure.
- It gives each user control over relevance through source exclusions, recent-time filters, retention limits, and personal RSS feeds, making the product useful both as a shared instance and as a tailored private reader.
- It keeps the reading experience focused with live updates, multilingual support, and an in-app reader mode that extracts cleaner article text from the original source instead of sending users straight into cluttered layouts.
- It supports this goal with features designed around clarity rather than volume: grouped stories, source families by publisher domain, server-side search, reader caching, settings import/export, account-based access with persistent user preferences, and an in-app feedback flow that can forward bug reports to Telegram.

## Quick Start

```bash
INTERNAL_PROXY_TOKEN=<change-me> BFF_SESSION_SECRET=<change-me> docker compose up --build -d
```

Open `http://localhost`.

Local runtime requirements:

- Backend: Node.js 18+
- BFF: Node.js 20+
- Frontend: Node.js `^20.19.0 || >=22.12.0`

## Container Images

Each published GitHub release builds and publishes two public GHCR images:

- `ghcr.io/issogr/newsflow-backend:<release-tag>`
- `ghcr.io/issogr/newsflow-bff:<release-tag>`

Container publishing runs from `v*` tags that point to commits on `main`; each image is tagged with the release tag.

## Configuration

Server and runtime:

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | development behavior when unset | Runtime mode |
| `PORT` | `5000` | Backend HTTP port |
| `SERVER_TIMEOUT` | `60000` | HTTP server timeout in ms |
| `LOG_LEVEL` | `debug` in development, `info` in production | Logger verbosity |
| `NEWS_DB_PATH` | `backend/data/news.db` | SQLite file path |
| `ALLOWED_ORIGINS` | empty | Comma-separated CORS allowlist |
| `TRUST_PROXY` | auto in production | Explicit proxy trust toggle |

Auth and admin:

| Variable | Default | Purpose |
| --- | --- | --- |
| `SESSION_TTL_DAYS` | `30` | Session lifetime in days |
| `SESSION_PURGE_INTERVAL_MS` | `300000` | Expired-session cleanup interval in ms |
| `ADMIN_USERNAME` | `admin` | Reserved dedicated admin username |
| `INTERNAL_PROXY_TOKEN` | `development-only-change-me` | Shared token used by the BFF when calling the private backend app API and Socket.IO surface |
| `BFF_SESSION_SECRET` | `development-only-change-me` | Secret used by the BFF to sign browser session cookies; must be set to a non-default value in production |
| `BFF_SESSION_DB_PATH` | `bff/data/sessions.sqlite` | SQLite path used by the BFF persistent session store |
| `INTERNAL_SERVICE_NAME` | `bff` | Expected internal caller name for backend app-private traffic |
| `APP_BASE_URL` | `http://localhost` | Public BFF/base URL for generated setup links and secure-cookie decisions |
| `FRONTEND_BASE_URL` | unset | Fallback alias for `APP_BASE_URL` |
| `PASSWORD_SETUP_TTL_MINUTES` | `60` | User password setup/reset link lifetime |
| `ADMIN_BOOTSTRAP_TTL_MINUTES` | `30` | Admin bootstrap link lifetime |
| `ONLINE_ACTIVITY_WINDOW_MINUTES` | `5` | Window used to consider a user online in the admin dashboard |
| `USER_ACTIVITY_TOUCH_INTERVAL_SECONDS` | `60` | Minimum interval between persisted activity updates |

Feed ingestion and querying:

| Variable | Default | Purpose |
| --- | --- | --- |
| `SCRAPE_INTERVAL_MS` | `900000` | Scheduled ingestion interval in ms |
| `SOURCE_REFRESH_ACTIVE_WINDOW_MINUTES` | `ONLINE_ACTIVITY_WINDOW_MINUTES` or `5` | Recent-activity window used to decide which users have assigned sources eligible for scheduled refresh |
| `ARTICLE_RETENTION_HOURS` | `24` | Article and reader-cache retention window in hours |
| `MAX_ARTICLES_PER_SOURCE` | `25` | Max parsed items per feed |
| `MAX_SCAN_ARTICLES` | `600` | Max scanned articles for grouped-query mode |
| `RSS_MAX_RETRIES` | `4` | Feed retry attempts for transient failures |
| `RSS_RETRY_DELAY` | `1500` | Base delay between feed retries in ms |
| `RSS_TIMEOUT` | `15000` | RSS fetch timeout in ms |
| `RSS_CACHE_TTL` | `60000` | Feed response cache TTL in ms |
| `RSS_CACHE_MAX_ENTRIES` | `200` | Max cached feed responses |
| `RSS_INGESTION_CONCURRENCY` | `8` | Max feed requests processed concurrently during ingestion |

AI topic detection:

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | unset | Server-side OpenRouter API key used only by the backend for AI topic detection |
| `OPENROUTER_MODEL` | `liquid/lfm-2.5-1.2b-instruct:free` | OpenRouter model id used for topic classification |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | OpenRouter-compatible API base URL |
| `AI_TOPIC_DETECTION_ENABLED` | `auto` | Set to `false` to disable AI topics; `auto` enables AI only when `OPENROUTER_API_KEY` is present |
| `AI_TOPIC_BATCH_SIZE` | `20` | Max new articles sent in one AI topic-classification request |
| `AI_TOPIC_BATCH_CONCURRENCY` | `2` | Max concurrent AI topic-classification requests during ingestion |
| `AI_TOPIC_MAX_ARTICLES_PER_REFRESH` | `160` | Max newly inserted articles classified by AI per refresh before falling back to local detection |
| `AI_TOPIC_REQUEST_TIMEOUT_MS` | `10000` | Timeout for one AI topic-classification request |

AI topic detection sends only compact metadata for newly inserted articles: source, title, and short description. Full article bodies and provider RSS categories are not sent to the model. The existing local/RSS-derived taxonomy is used as an immediate fallback, then replaced only when AI returns at least one valid canonical topic. If OpenRouter is unavailable, disabled, over the per-refresh cap, unsure, or returns invalid topics, the backend keeps the local fallback so ingestion can continue.

For Docker Compose development, AI topic activity is visible in backend logs without exposing prompts or secrets:

- `AI topic detection skipped: ...`
- `AI topic detection started: model=..., articles=..., batches=...`
- `AI topic batch completed: model=..., articles=..., classified=..., durationMs=...`
- `AI topic detection completed: model=..., requested=..., classified=..., durationMs=...`

Use `docker compose logs -f backend` to follow these messages while debugging.

Scheduled ingestion refreshes only sources assigned to recently active users. Default sources are considered assigned when a user has not excluded the source family or subsource; custom sources are assigned to their owning user. When a user opens the app, their assigned default and custom sources can refresh immediately once per scheduled ingestion cycle so returning sessions do not rely only on the next scheduled tick and repeated app requests do not spam upstream feeds. If the database is empty, the backend still seeds the default source set so first-run startup has data.

When multiple users add the same custom RSS URL, ingestion fetches that URL once per refresh and fans out parsed articles into each owning user source. Each user source still owns its private article rows, so deleting or updating one user source removes only that user source data and leaves other users with the same RSS URL unaffected.

Reader and article image extraction:

| Variable | Default | Purpose |
| --- | --- | --- |
| `READER_TIMEOUT` | `12000` | Article reader fetch timeout in ms |
| `READER_CACHE_TTL_MS` | `86400000` | Reader cache TTL in ms |
| `ARTICLE_IMAGE_TIMEOUT` | `8000` | Article-page image fallback timeout in ms |
| `ARTICLE_IMAGE_CACHE_TTL` | `21600000` | Article image fallback cache TTL in ms |
| `ARTICLE_IMAGE_CACHE_MAX_ENTRIES` | `500` | Max cached image fallback entries |
| `ARTICLE_IMAGE_FALLBACK_LIMIT` | `4` | Max recent articles per refresh that trigger image fallback extraction |

Outbound request safety:

| Variable | Default | Purpose |
| --- | --- | --- |
| `OUTBOUND_MAX_REDIRECTS` | `5` | Max followed redirects for outbound fetches |
| `OUTBOUND_MAX_RESPONSE_BYTES` | `2097152` (2 MB) | Default max size for generic outbound HTTP response bodies |
| `RSS_MAX_RESPONSE_BYTES` | `1048576` (1 MB) | Max size for fetched RSS/XML feed bodies |
| `READER_MAX_RESPONSE_BYTES` | `2097152` (2 MB) | Max size for fetched article HTML used by reader mode |
| `ARTICLE_IMAGE_MAX_RESPONSE_BYTES` | `524288` (512 KB) | Max size for fetched article HTML used for image fallback extraction |

WebSocket:

| Variable | Default | Purpose |
| --- | --- | --- |
| `WS_PING_TIMEOUT` | `60000` | Socket.IO ping timeout in ms |
| `WS_PING_INTERVAL` | `25000` | Socket.IO ping interval in ms |

Feedback and Telegram delivery:

| Variable | Default | Purpose |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | unset | Bot token used to forward feedback submissions to Telegram |
| `TELEGRAM_CHAT_ID` | unset | Target chat or channel id that receives forwarded feedback |
| `TELEGRAM_MESSAGE_THREAD_ID` | unset | Optional Telegram forum topic id when feedback should be sent into a specific topic inside a forum-enabled supergroup |
| `TELEGRAM_API_BASE_URL` | `https://api.telegram.org` | Optional Telegram API base URL override |

Admin access:

- On startup, the backend ensures a reserved admin account exists.
- If the admin password is not configured yet, the backend logs only a warning with the bootstrap-link expiry time. The single-use setup link itself is no longer printed to logs.
- Generate a fresh admin bootstrap link manually from `backend/` with:
  `node -e "const userService=require('./services/userService'); const result=userService.ensureAdminBootstrap(); console.log(result);"`
- The returned `setupLink` opens the admin password setup flow at `/admin/setup#token=...`.
- Calling `ensureAdminBootstrap()` again invalidates any previous unused admin bootstrap token and returns a new one.
- Set `APP_BASE_URL` so generated setup links point to the correct public BFF/app origin in your environment.
- The outbound response-size limits above are optional; if unset, News Flow uses the listed safe defaults.

HTTP surface:

- The browser-facing app now talks to the BFF on `/api/*`.
- The backend app-private API remains on `/internal-api/*` but is intended to stay reachable only from the BFF on the private Docker network.
- The external cached-news API remains public on `/api/public/*`.
- Public API docs are available at `/api/docs`.

Internal BFF-to-backend trust:

- `INTERNAL_PROXY_TOKEN` is a shared secret used only between the BFF and the backend.
- Set the same `INTERNAL_PROXY_TOKEN` value in both services.
- Do not keep the development default in production.
- Do not commit the production value to the repository.
- `BFF_SESSION_SECRET` is the secret used by the BFF session middleware to sign the browser-facing session cookie.
- Set a stable `BFF_SESSION_SECRET` value in production so browser sessions survive BFF restarts and browser reopen flows.
- `INTERNAL_SERVICE_NAME` is not a secret. It is an identifier the backend expects from the trusted internal caller.
- Keep `INTERNAL_SERVICE_NAME=bff` unless you intentionally rename the BFF service and update both sides together.

Recommended token generation:

- Use a long random value, for example 32 bytes or more.
- Example with OpenSSL:

```bash
openssl rand -hex 32
```

- Example with Node.js:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- Example shell export before `docker compose up`:

```bash
export INTERNAL_PROXY_TOKEN="$(openssl rand -hex 32)"
export BFF_SESSION_SECRET="$(openssl rand -hex 32)"
export INTERNAL_SERVICE_NAME="bff"
docker compose up --build -d
```

Operational guidance:

- Treat `INTERNAL_PROXY_TOKEN` like an application secret.
- Treat `BFF_SESSION_SECRET` like an application secret too.
- Store it in your shell environment, deployment secret manager, or an untracked local env file used only on your host.
- `docker compose` now expects `INTERNAL_PROXY_TOKEN` and `BFF_SESSION_SECRET` to be set explicitly before startup instead of falling back to insecure defaults.
- If you change either secret, existing users may need to sign in again, but user data remains intact.
- If the values do not match, the backend will reject app-private HTTP and Socket.IO traffic from the BFF.

Feedback flow:

- Authenticated users can open `Send feedback` from the user menu.
- Each feedback submission includes a category, title, description, and the authenticated username automatically.
- Users can optionally attach one image up to 5 MB or one short video up to 12 MB.
- Attachments and feedback text are forwarded to the configured Telegram chat through the backend so the bot token never reaches the browser.
- If you use a Telegram forum-enabled supergroup, set `TELEGRAM_CHAT_ID` to the supergroup id like `-100...` and `TELEGRAM_MESSAGE_THREAD_ID` to the numeric topic id, instead of combining both values into a single string.

## Project Layout

- `backend/server.js` - HTTP and WebSocket entrypoint
- `backend/services/` - ingestion, grouping, querying, users, database, reader extraction
- `backend/routes/api.js` - REST API
- `bff/server.js` - browser-facing BFF, session bridge, and proxy layer
- `frontend/src/components/` - UI screens and panels
- `frontend/src/hooks/` - WebSocket and request helpers
- `frontend/src/services/api.js` - frontend API client

## Notes

- Data is stored locally in `backend/data/news.db` by default
- The app is optimized for a simple self-hosted deployment model
- Users can only lower personal retention/recent windows within server-defined limits

## License

This project is licensed under the GNU General Public License v3.0. See `LICENSE` for the full text.
