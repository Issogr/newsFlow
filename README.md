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
- It stays lightweight and self-hostable by using local SQLite storage, built-in full-text search, and a simple single-service architecture, so the project remains practical to deploy without extra infrastructure.
- It gives each user control over relevance through source exclusions, recent-time filters, retention limits, and personal RSS feeds, making the product useful both as a shared instance and as a tailored private reader.
- It keeps the reading experience focused with live updates, multilingual support, and an in-app reader mode that extracts cleaner article text from the original source instead of sending users straight into cluttered layouts.
- It supports this goal with features designed around clarity rather than volume: grouped stories, source families by publisher domain, server-side search, reader caching, settings import/export, account-based access with persistent user preferences, and an in-app feedback flow that can forward bug reports to Telegram.

## Quick Start

```bash
docker-compose up --build -d
```

Open `http://localhost`.

## Container Images

Each published GitHub release builds and publishes two public GHCR images:

- `ghcr.io/issogr/newsflow-backend:<release-tag>`
- `ghcr.io/issogr/newsflow-frontend:<release-tag>`

Every push to `main` also refreshes the rolling `latest` image for both containers.

If the pushed commit message contains `Release`, use a format like `Release v3.1.3` and the workflow will also publish that version tag alongside `latest`.

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
| `APP_BASE_URL` | `http://localhost:3000` | Public frontend base URL for generated setup links |
| `FRONTEND_BASE_URL` | unset | Fallback alias for `APP_BASE_URL` |
| `PASSWORD_SETUP_TTL_MINUTES` | `60` | User password setup/reset link lifetime |
| `ADMIN_BOOTSTRAP_TTL_MINUTES` | `30` | Admin bootstrap link lifetime |
| `ONLINE_ACTIVITY_WINDOW_MINUTES` | `5` | Window used to consider a user online in the admin dashboard |
| `USER_ACTIVITY_TOUCH_INTERVAL_SECONDS` | `60` | Minimum interval between persisted activity updates |

Feed ingestion and querying:

| Variable | Default | Purpose |
| --- | --- | --- |
| `SCRAPE_INTERVAL_MS` | `900000` | Scheduled ingestion interval in ms |
| `ARTICLE_RETENTION_HOURS` | `24` | Article and reader-cache retention window in hours |
| `MAX_ARTICLES_PER_SOURCE` | `25` | Max parsed items per feed |
| `MAX_SCAN_ARTICLES` | `600` | Max scanned articles for grouped-query mode |
| `RSS_MAX_RETRIES` | `4` | Feed retry attempts for transient failures |
| `RSS_RETRY_DELAY` | `1500` | Base delay between feed retries in ms |
| `RSS_TIMEOUT` | `15000` | RSS fetch timeout in ms |
| `RSS_CACHE_TTL` | `60000` | Feed response cache TTL in ms |
| `RSS_CACHE_MAX_ENTRIES` | `200` | Max cached feed responses |

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
- If the admin password is not configured yet, the backend logs a single-use setup link for the admin bootstrap flow.
- Set `APP_BASE_URL` so generated setup links point to the correct frontend origin in your environment.
- The outbound response-size limits above are optional; if unset, News Flow uses the listed safe defaults.

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
- `frontend/src/components/` - UI screens and panels
- `frontend/src/hooks/` - WebSocket and request helpers
- `frontend/src/services/api.js` - frontend API client

## Notes

- Data is stored locally in `backend/data/news.db` by default
- The app is optimized for a simple self-hosted deployment model
- Users can only lower personal retention/recent windows within server-defined limits

## License

This project is licensed under the GNU General Public License v3.0. See `LICENSE` for the full text.
