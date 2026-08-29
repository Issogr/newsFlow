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
- Keep browser traffic same-origin on `/api/*`; Caddy is the only public service.

## Quick Start

```bash
docker compose up --build -d --remove-orphans
```

Open `http://localhost`.

Runtime target for all packages is Node.js `24.20.0`.

## Local Development

There is no root `package.json`; install and run the backend and frontend separately.

```bash
cd backend && npm install
cd ../frontend && npm install
```

Run in separate terminals:

```bash
cd backend && APP_BASE_URL=http://localhost:5173 npm run dev
cd frontend && npm start
```

Useful checks:

```bash
cd backend && npm run lint && npm test
cd frontend && npm run lint && npm test && npm run build
```

Local data defaults:

- Application database: `backend/data/news.db`

## Deployment

The bundled deployment puts Caddy in front of the application. Only Caddy publishes host ports; the backend serves the API, Socket.IO, and built React application on a private Docker network.

For automatic production HTTPS:

- Set `APP_BASE_URL=https://your-domain`.
- Point the domain's DNS records to the deployment host.
- Allow inbound TCP ports `80` and `443` and UDP port `443` through the host firewall.
- Keep the `caddy-data` volume so certificates and account state survive restarts.
- Do not publish the backend container port; Compose fixes the service to one trusted Caddy hop.
- Replace the controller/contact placeholders in the legal pages with deployment-approved details before publishing the service.

Published images:

- `ghcr.io/issogr/newsflow-backend:<release-tag>` (includes the built frontend)

When using the image outside the bundled Compose stack, set both `APP_BASE_URL` and `ALLOWED_ORIGINS` to the public origin. Existing deployments can remove the retired `bff-data` volume after upgrading.

## Configuration
Full configuration reference: [`CONFIGURATION.md`](CONFIGURATION.md).

Docker Compose forwards values from an optional root `.env` file to the backend.

### Required And Security

| Variable | Default | Notes |
| --- | --- | --- |
| `APP_BASE_URL` | `http://localhost` | Public app URL; controls setup links and secure-cookie decisions. |
| `ALLOWED_ORIGINS` | local origins; Compose `APP_BASE_URL` | Public API and Socket.IO allowlist, for example `https://news.example`. |
| `COOKIE_SECURE` | `auto` | Accepts `auto`, `true`, or `false`. |
| `TRUST_PROXY` | Compose `1` | The bundled topology has exactly one trusted Caddy hop. |
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
| `SCRAPE_INTERVAL_MS` | `900000` | Scheduled ingestion interval. |
| `SOURCE_REFRESH_ACTIVE_WINDOW_MINUTES` | `ONLINE_ACTIVITY_WINDOW_MINUTES` or `5` | Scheduled ingestion refreshes sources assigned to recently active users. |
| `MANUAL_REFRESH_COOLDOWN_MS` | `300000` | Per-user manual refresh cooldown. |
| `SOURCE_FETCH_FRESHNESS_MS` | `300000` | Skips repeated source fetches across refresh paths. |
| `ARTICLE_RETENTION_HOURS` | `24` | Article and reader-cache retention. |
| `MAX_ARTICLES_PER_SOURCE` | `25` | Max parsed items per RSS feed. |

### AI

AI runs only in the backend. Set `OPENROUTER_API_KEY` to enable provider-backed jobs. Defaults below are for Docker Compose; see [CONFIGURATION.md](CONFIGURATION.md) for raw backend defaults and tuning.

| Variable | Default | Notes |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | unset | Required for AI provider calls. |
| `AI_TOPIC_DETECTION_ENABLED` | `true` | Adds AI topic metadata during ingestion. |
| `AI_STORY_GROUPING_ENABLED`, `AI_SUMMARY_GENERATION_ENABLED`, `AI_PODCAST_GENERATION_ENABLED` | `false` | Enable individual optional AI jobs. |
| `AI_TOPIC_DETERMINISTIC_SKIP_ENABLED` | `true` | Skips provider calls for articles the local classifier can topic with high confidence. |
| `AI_SUMMARY_PROMPT_MAX_ARTICLES` | `60` | Max selected articles included in one thematic-summary prompt after dedupe/source balancing. |
| `AI_SUMMARY_POST_TOPIC_DEBOUNCE_MS` | `5000` | Debounces summary checks triggered by topic-classification completion. |
| `AI_SUMMARY_READER_PREWARM_ENABLED` | `true` | Prewarms reader text before summary windows when summaries are enabled. |
| `AI_SUMMARY_READER_PREWARM_RETRY_COOLDOWN_MS` | `300000` | Cooldown before retrying failed reader prewarm attempts. |
| `AI_SUMMARY_INVALID_OUTPUT_MAX_RETRIES` | `2` | Additional retries for invalid summary or podcast-script output. |
| `AI_SUMMARY_PENDING_TOPIC_GRACE_MS` | `900000` | Grace period after a summary slot for pending topic classification. |
| `AI_SUMMARY_TIME_ZONE` | `Europe/Rome` | Time zone for the daily `20:00` summary/podcast slot. |
| `AI_PODCAST_LANGUAGES` | `en` | Comma-separated locales: `en`, `it`. |
| `AI_PODCAST_PROMPT_MAX_ARTICLES` | `40` | Max selected articles included in one podcast-script prompt after dedupe/source balancing. |
| `AI_PODCAST_BACKGROUND_AUDIO_ENABLED` | `true` | Saves podcast scripts first and generates TTS audio in the background when enabled. |

Model overrides:

| Variable | Default |
| --- | --- |
| `OPENROUTER_TOPIC_MODEL` | `mistralai/mistral-small-24b-instruct-2501` |
| `OPENROUTER_SUMMARY_MODEL` | `qwen/qwen3.7-flash` |
| `OPENROUTER_STORY_GROUPING_MODEL` | `qwen/qwen3.7-flash` |
| `OPENROUTER_PODCAST_SCRIPT_MODEL` | `qwen/qwen3.7-flash` |
| `OPENROUTER_PODCAST_AUDIO_MODEL` | `google/gemini-3.1-flash-tts-preview` |

### Feedback

| Variable | Default | Notes |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | unset | Enables feedback forwarding to Telegram. |
| `TELEGRAM_CHAT_ID` | unset | Target chat or channel id. |
| `TELEGRAM_MESSAGE_THREAD_ID` | unset | Optional forum topic id. |

## Admin Setup

The backend creates a reserved admin account on startup. If its password is missing, startup logs only a warning; setup secrets are intentionally not written to logs. Generate a single-use link locally from `backend/`:

```bash
node -e "const userService=require('./services/userService'); console.log(userService.ensureAdminBootstrap());"
```

## Repository Layout

- `backend/`: Express, Socket.IO, SQLite, browser security, static frontend hosting, ingestion, auth, reader extraction, public API, and AI jobs.
- `frontend/`: Vite React app. Browser API calls use same-origin `/api/*` routes.

## License

This project is licensed under the GNU General Public License v3.0. See `LICENSE` for the full text.
