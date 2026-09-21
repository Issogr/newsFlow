# News Flow

<p align="center">
  <img src="frontend/public/logo.svg" alt="News Flow logo" width="108" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-active-0f766e" alt="Project status: active" />
  <img src="https://img.shields.io/badge/license-GPL--3.0-1d4ed8" alt="License: GPL-3.0" />
</p>

News Flow is a self-hosted RSS news hub with grouped stories, clean reader mode, per-user sources, and optional AI-powered topics, summaries, and story grouping.

## Features

- Group overlapping RSS articles into story cards.
- Search cached news server-side.
- Use account-based access with persistent settings import and export.
- Add personal RSS feeds and source exclusions.
- Read articles in a cleaned in-app reader.
- Save read-later articles outside normal retention.
- Use optional OpenRouter AI jobs for topic detection, story grouping, and thematic summaries.
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

The bundled deployment puts Caddy in front of the application. Only Caddy publishes host ports; the application serves the API, Socket.IO, and built React frontend on a private Docker network.

For automatic production HTTPS:

- Set `APP_BASE_URL=https://your-domain`.
- Point the domain's DNS records to the deployment host.
- Allow inbound TCP ports `80` and `443` and UDP port `443` through the host firewall.
- Keep the `caddy-data` volume so certificates and account state survive restarts.
- Do not publish the application container port; Compose fixes the service to one trusted Caddy hop.
- Replace the controller/contact placeholders in the legal pages with deployment-approved details before publishing the service.

Published images:

- `ghcr.io/issogr/newsflow:latest` (includes the built frontend)

The bundled Compose file builds your local checkout. To use the published image instead, set the `newsflow` service's `image` to `ghcr.io/issogr/newsflow:latest` and remove its `build` block. Pull the image and recreate the service when upgrading; the `latest` tag does not update running containers automatically. Each image retains its source commit in the `org.opencontainers.image.revision` label, and can be pinned by digest.

When using the image outside the bundled Compose stack, set both `APP_BASE_URL` and `ALLOWED_ORIGINS` to the public origin. Existing deployments can remove the retired `bff-data` volume after upgrading.

## Publishing An Update

Updates are batches of commits, not package versions. CI runs on pushes and pull requests, but publishing happens only when you manually run **Actions → Publish Update → Run workflow** on `main`.

1. Collect changes from as many commits as needed under `## Unreleased` in `CHANGELOG.md`. Keep the matching English/Italian user-facing notes in `frontend/src/config/changelog.ts`; draft metadata is `id: 'unreleased', date: ''`.
2. When the batch is ready, choose a date and a unique announcement ID, for example `date: '2026-09-21'` and `id: '2026-09-21-01'`. Use `02`, `03`, etc. for additional updates on the same day. Rename the first changelog heading to `## 2026-09-21-01`.
3. Check the release notes locally with `node scripts/release-notes.mts`, then commit and push the complete batch to `main` when ready.
4. Run **Publish Update** on `main`. It validates both packages, audits production dependencies, runs the Compose smoke check, rejects unfinished or reused announcements, publishes the `:latest` image tag to GHCR and the optional private registry, then creates a GitHub Release tagged `update-2026-09-21-01` with that changelog section as its body. GitHub subscribers can follow **Watch → Custom → Releases**.
5. For the next batch, add a new `Unreleased` section above the published history and reset the app metadata to the draft values while editing the new notes. Do not reuse a published announcement ID. Package versions do not need bumping.

The app displays a localized release date and tracks each user's acknowledgement by announcement ID. Draft notes are available from **Settings → What's new** without showing an update notice or recording an acknowledgement. The existing `lastSeenReleaseNotesVersion` settings field stores the ID for compatibility with current databases and settings exports.

The app includes the latest announcement; full history remains in `CHANGELOG.md` and GitHub Releases. Users who skip multiple releases see the newest announcement after their installation updates and they reload the app. A workflow retry after the image upload can finish creating the release while its tag is still absent; once the release tag exists, use a new announcement for further changes.

### Additional Private Registry

To also publish to a private registry, configure these repository secrets under **Settings → Secrets and variables → Actions → Secrets**:

| Secret | Value |
| --- | --- |
| `PRIVATE_REGISTRY_ENDPOINT` | Registry hostname with an optional port, e.g. `registry.example.com:5000`; no scheme, path, or trailing slash. |
| `PRIVATE_REGISTRY_USERNAME` | Registry login username. |
| `PRIVATE_REGISTRY_PASSWORD` | Registry password or access token with push permission. |

When the endpoint is set, **Publish Update** uses the same build to push `linux/amd64` and `linux/arm64` images to both:

- `ghcr.io/issogr/newsflow:latest`
- `<PRIVATE_REGISTRY_ENDPOINT>/issogr/newsflow:latest`

The image path follows the lowercase GitHub `<owner>/<repository>` name. The registry must be reachable over HTTPS from the GitHub-hosted runner, and the account must have push access to that image path. The GitHub Release is created after both pushes succeed. Leaving `PRIVATE_REGISTRY_ENDPOINT` unset publishes only to GHCR.

## Configuration
Full configuration reference: [`CONFIGURATION.md`](CONFIGURATION.md).

Docker Compose forwards values from an optional root `.env` file to the application.

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
| `AI_STORY_GROUPING_ENABLED`, `AI_SUMMARY_GENERATION_ENABLED` | `false` | Enable individual optional AI jobs. |
| `AI_TOPIC_DETERMINISTIC_SKIP_ENABLED` | `true` | Skips provider calls for articles the local classifier can topic with high confidence. |
| `AI_SUMMARY_PROMPT_MAX_ARTICLES` | `24` | Max selected articles included in one thematic-summary prompt after dedupe/source balancing. |
| `AI_SUMMARY_POST_TOPIC_DEBOUNCE_MS` | `5000` | Debounces summary checks triggered by topic-classification completion. |
| `AI_SUMMARY_READER_PREWARM_ENABLED` | `true` | Prewarms reader text before summary windows when summaries are enabled. |
| `AI_SUMMARY_READER_PREWARM_RETRY_COOLDOWN_MS` | `300000` | Cooldown before retrying failed reader prewarm attempts. |
| `AI_SUMMARY_INVALID_OUTPUT_MAX_RETRIES` | `2` | Additional retries for invalid summary output. |
| `AI_SUMMARY_PENDING_TOPIC_GRACE_MS` | `900000` | Grace period after a summary slot for pending topic classification. |
| `AI_SUMMARY_TIME_ZONE` | `Europe/Rome` | Time zone for the daily `20:00` summary slot. |

Model overrides:

| Variable | Default |
| --- | --- |
| `OPENROUTER_TOPIC_MODEL` | `mistralai/mistral-small-24b-instruct-2501` |
| `OPENROUTER_SUMMARY_MODEL` | `qwen/qwen3.7-flash` |
| `OPENROUTER_STORY_GROUPING_MODEL` | `qwen/qwen3.7-flash` |

### Feedback

| Variable | Default | Notes |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | unset | Enables feedback forwarding to Telegram. |
| `TELEGRAM_CHAT_ID` | unset | Target chat or channel id. |
| `TELEGRAM_MESSAGE_THREAD_ID` | unset | Optional forum topic id. |

## Admin Setup

The backend creates a reserved admin account on startup. If its password is missing, startup logs only a warning; setup secrets are intentionally not written to logs. After `npm run build`, generate a single-use link locally from `backend/`:

```bash
node -e "const userService=require('./dist/services/userService').default; console.log(userService.ensureAdminBootstrap());"
```

## Repository Layout

- `backend/`: Express, Socket.IO, SQLite, browser security, static frontend hosting, ingestion, auth, reader extraction, public API, and AI jobs.
- `frontend/`: Vite React app. Browser API calls use same-origin `/api/*` routes.

## License

This project is licensed under the GNU General Public License v3.0. See `LICENSE` for the full text.
