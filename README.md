# News Flow

<p align="center">
  <img src="frontend/public/logo.svg" alt="News Flow logo" width="108" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-active-0f766e" alt="Project status: active" />
  <img src="https://img.shields.io/badge/license-GPL--3.0-1d4ed8" alt="License: GPL-3.0" />
</p>

News Flow is a self-hosted RSS news hub with grouped stories, clean reader mode, per-user sources, and optional AI-powered topics, summaries, story grouping, and podcasts.

## Features

- Group overlapping RSS articles into story cards.
- Search cached news server-side.
- Use account-based access with persistent settings import and export.
- Add personal RSS feeds and source exclusions.
- Read articles in a cleaned in-app reader.
- Save read-later articles outside normal retention.
- Use optional OpenRouter AI jobs for topic detection, story grouping, thematic summaries, and podcast briefings.
- Keep browser traffic behind the BFF on `/api/*`; the backend private API stays on `/internal-api/*`.

## Quick Start

```bash
export INTERNAL_PROXY_TOKEN="$(openssl rand -hex 32)"
export BFF_SESSION_SECRET="$(openssl rand -hex 32)"
docker compose up --build -d
```

Open `http://localhost`.

Runtime target for all packages is Node.js `24.16.0`.

## Local Development

There is no root `package.json`; install and run each app separately.

```bash
cd backend && npm install
cd ../bff && npm install
cd ../frontend && npm install
```

Run in separate terminals:

```bash
cd backend && npm run dev
cd bff && npm start
cd frontend && npm start
```

Useful checks:

```bash
cd backend && npm run lint && npm test
cd bff && npm run lint && npm test
cd frontend && npm run lint && npm test && npm run build
```

Local data defaults:

- Backend database: `backend/data/news.db`
- BFF sessions: `bff/data/sessions.sqlite`
- If Node changes, rerun `npm install` or `npm rebuild` in `backend/` and `bff/` for `better-sqlite3`.

## Deployment

Docker Compose needs two secrets:

- `INTERNAL_PROXY_TOKEN`: shared by BFF and backend for private backend access.
- `BFF_SESSION_SECRET`: signs BFF browser sessions. Keep it stable or users will be logged out.

For HTTPS behind a reverse proxy:

- Set `APP_BASE_URL=https://your-domain`.
- Ensure the proxy forwards `X-Forwarded-Proto: https`.
- Set BFF `TRUST_PROXY=true` only when the BFF is reachable only through a trusted proxy and you need forwarded client IP/header handling.

Published images:

- `ghcr.io/issogr/newsflow-backend:<release-tag>`
- `ghcr.io/issogr/newsflow-bff:<release-tag>`

## Configuration
Full configuration reference: [`CONFIGURATION.md`](CONFIGURATION.md).

### Required And Security

| Variable | Default | Notes |
| --- | --- | --- |
| `INTERNAL_PROXY_TOKEN` | required in Compose | Must match between BFF and backend. |
| `BFF_SESSION_SECRET` | required in Compose | Use a stable random value in production. |
| `APP_BASE_URL` | `http://localhost` | Public app URL; controls setup links and secure-cookie decisions. |
| `ALLOWED_ORIGINS` | empty | Backend CORS allowlist, for example `https://news.example`. |
| `COOKIE_SECURE` | `auto` | Accepts `auto`, `true`, or `false`. |
| `TRUST_PROXY` | backend auto in production, BFF `false` | Use only behind a trusted reverse proxy. |
| `SESSION_TTL_DAYS` | `30` | Browser/backend session lifetime. |

### Public API

| Variable | Default | Notes |
| --- | --- | --- |
| `PUBLIC_API_ANONYMOUS_ENABLED` | `false` | Enables `GET /api/public/news` without a token only when set to `true`. |
| `PUBLIC_API_AUTHENTICATED_ENABLED` | `false` | Enables API-token access and Settings token controls only when set to `true`. |

The public API is read-only and cache-only. It must not trigger RSS refreshes or article extraction.
Public API docs are available at `/api/docs`.

### Feed And Storage

| Variable | Default | Notes |
| --- | --- | --- |
| `NEWS_DB_PATH` | `backend/data/news.db` | Backend SQLite path. |
| `BFF_SESSION_DB_PATH` | `bff/data/sessions.sqlite` | BFF session SQLite path. |
| `SCRAPE_INTERVAL_MS` | `900000` | Scheduled ingestion interval. |
| `SOURCE_REFRESH_ACTIVE_WINDOW_MINUTES` | `ONLINE_ACTIVITY_WINDOW_MINUTES` or `5` | Scheduled ingestion refreshes sources assigned to recently active users. |
| `MANUAL_REFRESH_COOLDOWN_MS` | `300000` | Per-user manual refresh cooldown. |
| `SOURCE_FETCH_FRESHNESS_MS` | `300000` | Skips repeated source fetches across refresh paths. |
| `ARTICLE_RETENTION_HOURS` | `24` | Article and reader-cache retention. |
| `MAX_ARTICLES_PER_SOURCE` | `25` | Max parsed items per RSS feed. |

### AI

AI runs only in the backend. Set `OPENROUTER_API_KEY` to enable provider-backed jobs. Feature toggles accept only `true` or `false`; invalid values disable the feature.

| Variable | Default | Notes |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | unset | Required for AI provider calls. |
| `AI_TOPIC_DETECTION_ENABLED` | `true` | Adds AI topic metadata during ingestion. |
| `AI_STORY_GROUPING_ENABLED` | `true` | Groups articles describing the same story after ingestion. |
| `AI_SUMMARY_GENERATION_ENABLED` | `true` | Generates thematic summaries; hides summary UI when `false`. |
| `AI_PODCAST_GENERATION_ENABLED` | `true` | Set to `false` to disable podcast scripts, audio, and UI. |
| `AI_SUMMARY_READER_PREWARM_ENABLED` | `true` | Prewarms reader text before summary windows when summaries are enabled. |
| `AI_SUMMARY_READER_PREWARM_RETRY_COOLDOWN_MS` | `300000` | Cooldown before retrying failed reader prewarm attempts. |
| `AI_SUMMARY_INVALID_OUTPUT_MAX_RETRIES` | `2` | Additional retries for invalid summary or podcast-script output. |
| `AI_SUMMARY_PENDING_TOPIC_GRACE_MS` | `900000` | Grace period after a summary slot for pending topic classification. |
| `AI_SUMMARY_TIME_ZONE` | `Europe/Rome` | Time zone for `08:00` and `20:00` summary/podcast slots. |
| `AI_PODCAST_LANGUAGES` | `en` | Comma-separated locales: `en`, `it`. |

Model overrides:

| Variable | Default |
| --- | --- |
| `OPENROUTER_TOPIC_MODEL` | `qwen/qwen3.5-9b` |
| `OPENROUTER_SUMMARY_MODEL` | `deepseek/deepseek-v4-flash` |
| `OPENROUTER_STORY_GROUPING_MODEL` | `deepseek/deepseek-v4-flash` |
| `OPENROUTER_PODCAST_SCRIPT_MODEL` | `deepseek/deepseek-v4-flash` |
| `OPENROUTER_PODCAST_AUDIO_MODEL` | `google/gemini-3.1-flash-tts-preview` |

### Feedback

| Variable | Default | Notes |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | unset | Enables feedback forwarding to Telegram. |
| `TELEGRAM_CHAT_ID` | unset | Target chat or channel id. |
| `TELEGRAM_MESSAGE_THREAD_ID` | unset | Optional forum topic id. |

## Admin Setup

The backend creates a reserved admin account on startup. If the admin password is missing, it logs a single-use setup link. To generate a fresh link manually from `backend/`:

```bash
node -e "const userService=require('./services/userService'); console.log(userService.ensureAdminBootstrap());"
```

## Repository Layout

- `backend/`: Express, Socket.IO, SQLite, ingestion, auth, reader extraction, public API, and AI jobs.
- `bff/`: browser-facing security boundary, session bridge, static frontend host, and proxy layer.
- `frontend/`: Vite React app. Browser API calls go through `/api/*` on the BFF.

## License

This project is licensed under the GNU General Public License v3.0. See `LICENSE` for the full text.
