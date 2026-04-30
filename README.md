# News Flow

<p align="center">
  <img src="frontend/public/logo.svg" alt="News Flow logo" width="108" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-active-0f766e" alt="Project status: active" />
  <img src="https://img.shields.io/badge/license-GPL--3.0-1d4ed8" alt="License: GPL-3.0" />
</p>

<p align="center">
  A calm, personal RSS news hub that cuts through the noise with smart grouping, clean reader mode, manual refreshes, and full control over your sources.
</p>

## Table of Contents

- [Why News Flow](#why-news-flow)
- [Key Features](#key-features)
- [Quick Start](#quick-start)
- [Local Development](#local-development)
- [Container Images](#container-images)
- [Configuration](#configuration)
- [BFF and Security Boundary](#bff-and-security-boundary)
- [Ingestion Behavior](#ingestion-behavior)
- [Project Layout](#project-layout)
- [Operational Notes](#operational-notes)
- [License](#license)

## Why News Flow

- News Flow reduces RSS noise by grouping overlapping coverage into cleaner story clusters instead of showing the same story repeated across many feeds.
- It stays lightweight and self-hostable with local SQLite storage, built-in full-text search, and a small two-tier web architecture.
- It gives each user control over relevance and reading flow through exclusions, recent filters, retention limits, personal RSS feeds, manual refreshes, and a cleaner in-app reader mode.

## Key Features

- Grouped stories across overlapping feeds
- Source families by publisher domain
- Server-side full-text search
- Reader mode with cleaned article extraction and caching
- Personal custom RSS feeds
- Account-based access with persistent settings
- Settings import and export
- Manual top-navbar feed refreshes
- In-app feedback flow with optional Telegram forwarding

## Quick Start

```bash
INTERNAL_PROXY_TOKEN=<change-me> BFF_SESSION_SECRET=<change-me> docker compose up --build -d
```

Open `http://localhost`.

Runtime requirements:

- Backend: Node.js 20+
- BFF: Node.js 20+
- Frontend: Node.js `^20.19.0 || >=22.12.0`

## Local Development

Install dependencies per app:

```bash
cd backend && npm install
cd ../bff && npm install
cd ../frontend && npm install
```

Run the apps in separate terminals:

```bash
cd backend && npm run dev
cd bff && npm start
cd frontend && npm start
```

Notes:

- The frontend talks to the BFF on `/api/*` in development.
- The backend uses `backend/data/news.db` by default.
- The BFF uses `bff/data/sessions.sqlite` by default.

## Container Images

Each published GitHub release builds and publishes two public GHCR images:

- `ghcr.io/issogr/newsflow-backend:<release-tag>`
- `ghcr.io/issogr/newsflow-bff:<release-tag>`

Container publishing runs from `v*` tags that point to commits on `main`; each image is tagged with the release tag.

## Configuration

### Backend Runtime

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | development behavior when unset | Runtime mode |
| `PORT` | `5000` | Backend HTTP port |
| `SERVER_TIMEOUT` | `60000` | HTTP server timeout in ms |
| `LOG_LEVEL` | `debug` in development, `info` in production | Logger verbosity |
| `NEWS_DB_PATH` | `backend/data/news.db` | SQLite file path |
| `ALLOWED_ORIGINS` | empty | Comma-separated CORS allowlist |
| `TRUST_PROXY` | auto in production | Explicit proxy trust toggle |

### BFF, Auth, and Session

| Variable | Default | Purpose |
| --- | --- | --- |
| `SESSION_TTL_DAYS` | `30` | Session lifetime in days |
| `SESSION_PURGE_INTERVAL_MS` | `300000` | Expired-session cleanup interval in ms |
| `SESSION_STORE_CLEAR_INTERVAL_MS` | `300000` | BFF persisted session-store cleanup interval in ms |
| `ADMIN_USERNAME` | `admin` | Reserved dedicated admin username |
| `INTERNAL_PROXY_TOKEN` | `development-only-change-me` | Shared token used by the BFF when calling the private backend app API and Socket.IO surface |
| `BFF_SESSION_SECRET` | `development-only-change-me` | Secret used by the BFF to sign browser session cookies; must be set to a non-default value in production |
| `BFF_SESSION_DB_PATH` | `bff/data/sessions.sqlite` | SQLite path used by the BFF persistent session store |
| `INTERNAL_SERVICE_NAME` | `bff` | Expected internal caller name for backend app-private traffic |
| `APP_BASE_URL` | `http://localhost` | Public BFF or app URL for generated setup links and secure-cookie decisions |
| `FRONTEND_BASE_URL` | unset | Fallback alias for `APP_BASE_URL` |
| `PASSWORD_SETUP_TTL_MINUTES` | `60` | User password setup or reset link lifetime |
| `ADMIN_BOOTSTRAP_TTL_MINUTES` | `30` | Admin bootstrap link lifetime |
| `ONLINE_ACTIVITY_WINDOW_MINUTES` | `5` | Window used to consider a user online in the admin dashboard |
| `USER_ACTIVITY_TOUCH_INTERVAL_SECONDS` | `60` | Minimum interval between persisted activity updates |

### Feed Ingestion and Querying

| Variable | Default | Purpose |
| --- | --- | --- |
| `SCRAPE_INTERVAL_MS` | `900000` | Scheduled ingestion interval in ms |
| `SOURCE_REFRESH_ACTIVE_WINDOW_MINUTES` | `ONLINE_ACTIVITY_WINDOW_MINUTES` or `5` | Recent-activity window used to decide which users have assigned sources eligible for scheduled refresh |
| `ARTICLE_RETENTION_HOURS` | `24` | Article and reader-cache retention window in hours |
| `MAX_ARTICLES_PER_SOURCE` | `25` | Max parsed items per feed |
| `RSS_MAX_RETRIES` | `4` | Feed retry attempts for transient failures |
| `RSS_RETRY_DELAY` | `1500` | Base delay between feed retries in ms |
| `RSS_TIMEOUT` | `15000` | RSS fetch timeout in ms |
| `RSS_CACHE_TTL` | `60000` | Feed response cache TTL in ms |
| `RSS_CACHE_MAX_ENTRIES` | `200` | Max cached feed responses |
| `RSS_INGESTION_CONCURRENCY` | `8` | Max feed requests processed concurrently during ingestion |

### AI Topic Detection

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | unset | Server-side OpenRouter API key used only by the backend for AI topic detection |
| `OPENROUTER_MODEL` | `qwen/qwen3.5-9b` | OpenRouter model id used for topic classification |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | OpenRouter-compatible API base URL |
| `AI_TOPIC_DETECTION_ENABLED` | `auto` | Set to `false` to disable AI topics; `auto` enables AI only when `OPENROUTER_API_KEY` is present |
| `AI_TOPIC_BATCH_SIZE` | `4` | Max new articles sent in one AI topic-classification request |
| `AI_TOPIC_BATCH_CONCURRENCY` | `1` | Max concurrent AI topic-classification requests during ingestion |
| `AI_TOPIC_MAX_ARTICLES_PER_REFRESH` | `160` | Max newly inserted articles classified by AI per refresh before falling back to local detection |
| `AI_TOPIC_REQUEST_TIMEOUT_MS` | `30000` | Timeout for one AI topic-classification request, configurable up to 120 seconds for slower models |

AI topic detection uses the official `@openrouter/sdk` package from the backend.

- It sends only compact metadata for newly inserted articles: title, short description, and the internal article id used to map results back.
- Full article bodies, provider RSS categories, and source names are not sent to the model.
- Local fallback topics use weighted phrase scoring with positive and negative evidence instead of broad substring matching, with regression fixtures for difficult Italian headlines.
- Classifier requests disable model reasoning and ask for JSON-object responses with topic confidence. Optional evidence can still be stored when available.
- AI topics are accepted only when the topic is canonical and confidence is high enough.
- The existing local or RSS-derived taxonomy is used immediately as fallback, so ingestion does not wait for the AI request.
- When AI returns at least one valid canonical topic, the backend replaces the fallback topics in the background.
- Each stored topic includes source, confidence, evidence, and reason-code metadata.
- Each article also stores AI-processing metadata so attempted articles, including no-topic results, are not reprocessed on later refreshes or service restarts.
- Admins can inspect classification details with `GET /internal-api/admin/articles/:articleId/topics/debug`.

For Docker Compose development, AI topic activity is visible in backend logs without exposing prompts or secrets:

- `AI topic detection skipped: ...`
- `AI topic detection started: model=..., articles=..., batches=...`
- `AI topic batch completed: model=..., articles=..., classified=..., durationMs=...`
- `AI topic batch produced no valid topics: reason=..., responseChars=..., finishReason=...`
- `AI topic detection completed: model=..., requested=..., classified=..., durationMs=...`
- `AI topic batch failed: OpenRouter request timed out; keeping local fallback topics`

Use `docker compose logs -f backend` to follow these messages while debugging.

### Reader and Image Extraction

| Variable | Default | Purpose |
| --- | --- | --- |
| `READER_TIMEOUT` | `12000` | Article reader fetch timeout in ms |
| `READER_CACHE_TTL_MS` | `86400000` | Reader cache TTL in ms |
| `ARTICLE_IMAGE_TIMEOUT` | `8000` | Article-page image fallback timeout in ms |
| `ARTICLE_IMAGE_CACHE_TTL` | `21600000` | Article image fallback cache TTL in ms |
| `ARTICLE_IMAGE_CACHE_MAX_ENTRIES` | `500` | Max cached image fallback entries |
| `ARTICLE_IMAGE_FALLBACK_LIMIT` | `4` | Max recent articles per refresh that trigger image fallback extraction |

### Outbound Request Safety

| Variable | Default | Purpose |
| --- | --- | --- |
| `OUTBOUND_MAX_REDIRECTS` | `5` | Max followed redirects for outbound fetches |
| `OUTBOUND_MAX_RESPONSE_BYTES` | `2097152` (2 MB) | Default max size for generic outbound HTTP response bodies |
| `RSS_MAX_RESPONSE_BYTES` | `1048576` (1 MB) | Max size for fetched RSS/XML feed bodies |
| `READER_MAX_RESPONSE_BYTES` | `2097152` (2 MB) | Max size for fetched article HTML used by reader mode |
| `ARTICLE_IMAGE_MAX_RESPONSE_BYTES` | `524288` (512 KB) | Max size for fetched article HTML used for image fallback extraction |

### WebSocket

| Variable | Default | Purpose |
| --- | --- | --- |
| `WS_PING_TIMEOUT` | `60000` | Socket.IO ping timeout in ms |
| `WS_PING_INTERVAL` | `25000` | Socket.IO ping interval in ms |

### Feedback and Telegram Delivery

| Variable | Default | Purpose |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | unset | Bot token used to forward feedback submissions to Telegram |
| `TELEGRAM_CHAT_ID` | unset | Target chat or channel id that receives forwarded feedback |
| `TELEGRAM_MESSAGE_THREAD_ID` | unset | Optional Telegram forum topic id when feedback should be sent into a specific topic inside a forum-enabled supergroup |
| `TELEGRAM_API_BASE_URL` | `https://api.telegram.org` | Optional Telegram API base URL override |

### Admin Access

- On startup, the backend ensures a reserved admin account exists.
- If the admin password is not configured yet, the backend logs a warning with the bootstrap-link expiry time and the current single-use setup link.
- Generate a fresh admin bootstrap link manually from `backend/` with:
  `node -e "const userService=require('./services/userService'); const result=userService.ensureAdminBootstrap(); console.log(result);"`
- The returned `setupLink` opens the admin password setup flow at `/admin/setup#token=...`.
- Calling `ensureAdminBootstrap()` again invalidates any previous unused admin bootstrap token and returns a new one.
- Set `APP_BASE_URL` so generated setup links point to the correct public BFF or app origin in your environment.
- The outbound response-size limits above are optional; if unset, News Flow uses the listed safe defaults.

## BFF and Security Boundary

### HTTP Surface

- The browser-facing app talks to the BFF on `/api/*`.
- The backend app-private API remains on `/internal-api/*` and is intended to stay reachable only from the BFF on the private Docker network.
- The external cached-news API remains public on `/api/public/*`.
- Public API docs are available at `/api/docs`.

### Internal Trust

- `INTERNAL_PROXY_TOKEN` is a shared secret used only between the BFF and the backend.
- Set the same `INTERNAL_PROXY_TOKEN` value in both services.
- Do not keep the development default in production.
- Do not commit the production value to the repository.
- `BFF_SESSION_SECRET` is the secret used by the BFF session middleware to sign the browser-facing session cookie.
- Set a stable `BFF_SESSION_SECRET` value in production so browser sessions survive BFF restarts and browser reopen flows.
- `INTERNAL_SERVICE_NAME` is not a secret. It is an identifier the backend expects from the trusted internal caller.
- Keep `INTERNAL_SERVICE_NAME=bff` unless you intentionally rename the BFF service and update both sides together.

### Recommended Token Generation

- Use a long random value, for example 32 bytes or more.

Example with OpenSSL:

```bash
openssl rand -hex 32
```

Example with Node.js:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Example shell export before `docker compose up`:

```bash
export INTERNAL_PROXY_TOKEN="$(openssl rand -hex 32)"
export BFF_SESSION_SECRET="$(openssl rand -hex 32)"
export INTERNAL_SERVICE_NAME="bff"
docker compose up --build -d
```

### Operational Guidance

- Treat `INTERNAL_PROXY_TOKEN` like an application secret.
- Treat `BFF_SESSION_SECRET` like an application secret too.
- Store them in your shell environment, deployment secret manager, or an untracked local env file used only on your host.
- `docker compose` expects `INTERNAL_PROXY_TOKEN` and `BFF_SESSION_SECRET` to be set explicitly before startup instead of falling back to insecure defaults.
- If you change either secret, existing users may need to sign in again, but user data remains intact.
- If the values do not match, the backend rejects app-private HTTP and Socket.IO traffic from the BFF.

## Ingestion Behavior

### Assigned-Source Refresh

Scheduled ingestion refreshes only sources assigned to recently active users.

- Default sources are considered assigned when a user has not excluded the source family or subsource.
- Custom sources are assigned to their owning user.
- Normal app feed loads read cached articles without triggering upstream RSS requests.
- Clicking the top-navbar refresh button refreshes the user's assigned default and custom sources, then reads the updated feed.
- AI topic completion can update the visible cached feed automatically, but this does not trigger another RSS/source refresh.
- If another `/news` request arrives while that manual refresh is still running, it waits for the in-flight refresh before reading the feed.
- If the database is empty, the backend still seeds the default source set so first-run startup has data.

### Shared Custom RSS URLs

When multiple users add the same custom RSS URL, ingestion fetches that URL once per refresh and fans parsed articles out into each owning user source.

- Each user source still owns its private article rows.
- Deleting or updating one user source removes only that user source data.
- Other users with the same RSS URL are unaffected.

## Project Layout

- `backend/server.js` - backend HTTP and WebSocket entrypoint
- `backend/routes/api.js` - app-private REST API behind the BFF
- `backend/routes/publicApi.js` - public cached-news API
- `backend/services/` - ingestion, grouping, querying, users, database, reader extraction, and realtime services
- `backend/utils/` - auth, validation, logging, network safety, and shared helpers
- `bff/server.js` - browser-facing BFF, session bridge, static frontend host, and proxy layer
- `frontend/src/components/` - UI screens, cards, panels, and settings views
- `frontend/src/hooks/` - request and interaction helpers
- `frontend/src/services/api.js` - frontend API client
- `frontend/src/config/` - changelog and frontend config modules
- `frontend/src/utils/` - frontend utility helpers
- `frontend/public/` - static frontend assets

## Operational Notes

- Data is stored locally in `backend/data/news.db` by default.
- The app is optimized for a simple self-hosted deployment model.
- Users can only lower personal retention or recent windows within server-defined limits.
- Authenticated users can open `Send feedback` from the user menu.
- Each feedback submission includes a category, title, description, and the authenticated username automatically.
- Users can optionally attach one image up to 5 MB or one short video up to 12 MB.
- Attachments and feedback text are forwarded to the configured Telegram chat through the backend so the bot token never reaches the browser.
- If you use a Telegram forum-enabled supergroup, set `TELEGRAM_CHAT_ID` to the supergroup id like `-100...` and `TELEGRAM_MESSAGE_THREAD_ID` to the numeric topic id instead of combining both values into a single string.

## License

This project is licensed under the GNU General Public License v3.0. See `LICENSE` for the full text.
