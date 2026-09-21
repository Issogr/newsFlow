# News Flow

<img src="frontend/public/logo.svg" alt="News Flow logo" width="96" />

**Choose your sources. Follow the story. Read at your own pace.**

News Flow is a self-hosted RSS reader that brings articles from different publishers into one place, groups overlapping coverage into story cards, and offers a clean in-app reading view.

Use it for your own reading or share an installation with multiple accounts. Each reader chooses their sources, adds personal RSS feeds, saves articles for later, and keeps their own reading preferences. Optional [OpenRouter](https://openrouter.ai/) features add AI topic detection, story grouping, and daily thematic summaries.

## Run with Docker

Docker Compose is the quickest way to run the complete app. It builds the frontend and backend and starts Caddy as the public entry point, so Node.js and npm are not needed on your host. From the repository root:

```bash
docker compose up --build -d
```

Open [http://localhost](http://localhost), create an account, and choose your sources. An OpenRouter API key is not required for the RSS reader.

Compose reads an optional root `.env` file for configuration. After changing it, run `docker compose up -d` to apply the new values. See [Deploy with HTTPS](#deploy-with-https) when using a domain instead of localhost.

## Run with npm

Use npm for local development. Requires Node.js 24; Docker and CI currently pin `24.20.0`. The Express backend and Vite React frontend have separate packages, with no root `package.json`.

In one terminal, from the repository root:

```bash
npm --prefix backend ci
APP_BASE_URL=http://localhost:5173 npm --prefix backend run dev
```

In a second terminal, also from the repository root:

```bash
npm --prefix frontend ci
npm --prefix frontend start
```

Open [http://localhost:5173](http://localhost:5173). Vite forwards `/api` and `/socket.io` to the backend on port `5000`. If you change the frontend origin, use the same value for `APP_BASE_URL`.

For npm runs, pass configuration through the backend process environment; the root `.env` file is loaded by Compose, not automatically by the npm scripts.

## Make the feed yours

Choose built-in sources during account setup, then use **Settings** to change source selections or add personal RSS feeds. Each account can keep up to eight custom feeds by default. Settings and custom sources can be exported and imported.

Filter the feed by source, topic, or time, and search the articles already cached on your server. Related coverage appears together in a story card so you can compare publishers without working through a separate card for every article.

Feed reads use cached data. A manual refresh queues source updates in the background and has a five-minute cooldown by default. Scheduled ingestion runs every 15 minutes for sources assigned to recently active users.

## Read and save articles

Choose **Read here** to open the cleaned reader view or **Open original** to visit the publisher. Reader extraction depends on the source page; the original link remains available when an article cannot be extracted.

Save articles to **Read later** to keep them beyond the normal retention window, which defaults to 24 hours. The interface supports English and Italian, light and dark themes, and adjustable reader text size and width.

## Optional AI features

AI jobs run in the backend through OpenRouter. For a Compose installation, add the features you want to the root `.env` file:

```dotenv
OPENROUTER_API_KEY=your-openrouter-api-key
AI_TOPIC_DETECTION_ENABLED=true
AI_STORY_GROUPING_ENABLED=true
AI_SUMMARY_GENERATION_ENABLED=true
```

Topic detection classifies incoming articles; story grouping uses article metadata to connect coverage of the same event. Both run after ingestion, outside feed requests.

Thematic summaries use built-in sources and are shared across users. They provide English and Italian briefings with links to their source articles, scheduled for `20:00` in `AI_SUMMARY_TIME_ZONE` (`Europe/Rome` by default). Generation can use cached reader excerpts and includes a second AI pass to check claims against those excerpts.

Compose enables only the topic-detection switch by default; story grouping and summaries are opt-in. Raw backend runs default all three switches to enabled. Provider calls always require a key. Model choices, text budgets, and scheduling controls are documented in [CONFIGURATION.md](CONFIGURATION.md#ai-provider-and-feature-switches).

## Set up the admin account

The backend reserves an `admin` account on startup. Setup links are deliberately omitted from logs. To generate a single-use link in a running Compose installation:

```bash
docker compose exec newsflow node -e "console.log(require('./dist/services/userService').default.ensureAdminBootstrap().setupLink)"
```

For local development, run these commands from `backend/`:

```bash
npm run build
APP_BASE_URL=http://localhost:5173 node -e "console.log(require('./dist/services/userService').default.ensureAdminBootstrap().setupLink)"
```

Open the printed link to set the password. It expires after 30 minutes by default. Once the admin password is configured, the command returns `null` instead of creating another bootstrap link. Use the same `NEWS_DB_PATH` as the running backend if you have overridden it.

## Storage and privacy

Accounts, settings, cached articles, reader content, saved-article references, and summaries are stored in SQLite. Both local runs and the bundled Compose setup persist the database at `backend/data/news.db` on the host; Compose mounts that directory at `/usr/src/app/data` inside the container. Keep `backend/data/` when rebuilding or upgrading, and back it up while the app is stopped or with a SQLite-aware backup tool. Settings exports are not full database backups.

Browser authentication uses first-party session cookies. Passwords and session/API tokens are hashed in the database. The OpenRouter key stays on the backend. When AI features are enabled, article metadata and, for summaries, selected text excerpts are sent to OpenRouter and its model providers; see their [privacy policy](https://openrouter.ai/privacy).

Self-hosting still involves external requests: the backend fetches RSS feeds and reader pages, and the browser can load publisher images and source icons. If Telegram feedback is configured, submitted feedback, account identifiers, and attachments are forwarded to the operator's Telegram destination.

## Deploy with HTTPS

The bundled stack exposes only Caddy on host ports `80` and `443`. Caddy forwards the frontend, API, and Socket.IO traffic to the application over a private Docker network.

Set the public origin in the root `.env` file:

```dotenv
APP_BASE_URL=https://news.example.com
```

Point the domain's DNS records to the host and allow inbound TCP `80`/`443` and UDP `443`. Run `docker compose up -d`; Caddy manages HTTPS certificates automatically. Preserve the `caddy-data` and `caddy-config` volumes across upgrades. The bundled topology uses exactly one trusted proxy hop, so keep the application container's port unpublished.

When running the image outside this stack, set both `APP_BASE_URL` and `ALLOWED_ORIGINS` to the public origin and configure proxy trust for your topology. Replace the controller/contact placeholders in the [legal pages](frontend/src/components/LegalPolicyPage.tsx) before publishing the service.

### Use the published image

The published image, `ghcr.io/issogr/newsflow:latest`, includes the built frontend and supports `linux/amd64` and `linux/arm64`. To use it, change the `newsflow` service's `image` in `docker-compose.yml` and remove its `build` block. Then install or update with:

```bash
docker compose pull newsflow
docker compose up -d
```

The `latest` tag does not update running containers automatically. Images can be pinned by digest and retain their source commit in the `org.opencontainers.image.revision` label.

## Public API and configuration

External integrations can use `GET /api/public/news` when enabled by the operator. It is read-only and cache-only: requests never trigger RSS refreshes, reader extraction, or AI work. API documentation is available at `/api/docs` on your running installation.

- Set `PUBLIC_API_AUTHENTICATED_ENABLED=true` to enable dedicated API tokens and their controls in **Settings**. Tokens are shown once at creation, expire after 30 days, and can be revoked.
- Set `PUBLIC_API_ANONYMOUS_ENABLED=true` to allow access without a token. Both access modes are disabled by default.

For all environment variables, defaults, and limits—including ingestion, retention, reader extraction, AI models, authentication, and Telegram feedback—see [CONFIGURATION.md](CONFIGURATION.md).

## Development and updates

`backend/` contains the Express + Socket.IO server, SQLite persistence, ingestion, authentication, reader extraction, and AI jobs. `frontend/` contains the Vite React app, whose browser requests use same-origin `/api/*` routes.

After installing both packages, run checks from the repository root:

```bash
npm --prefix backend run typecheck
npm --prefix backend run lint
npm --prefix backend test
npm --prefix backend run build
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend test
npm --prefix frontend run build
```

The app shows the latest announcement under **Settings → What's new**. Full history is in [CHANGELOG.md](CHANGELOG.md) and [GitHub Releases](https://github.com/issogr/newsflow/releases). To follow published updates, choose **Watch → Custom → Releases** on GitHub.

<details>
<summary>Maintainers: publishing an update</summary>

Updates are batches of commits, not package versions. The [Publish Update workflow](.github/workflows/release-containers.yml) publishes on pushes to `main` whose tip commit has the exact title `Prepared update YYYY-MM-DD-NN`, matching the finalized changelog ID.

1. Collect changes under `## Unreleased` in `CHANGELOG.md`. Keep matching English/Italian notes in `frontend/src/config/changelog.ts` with `id: 'unreleased', date: ''`. Draft notes do not trigger acknowledgement prompts and block publication.
2. When ready to release, use the release date and next unused announcement ID, for example `2026-09-21-01`. Rename the top changelog heading and set matching app `id`/`date` values; use `02`, `03`, etc. for further updates that day. Published IDs are immutable.
3. Run `node --test scripts/release-notes.test.mts` and `node scripts/release-notes.mts`. Create the release commit with the exact title `Prepared update 2026-09-21-01`.
4. Push or merge through the repository's approved process, preserving that title on the tip commit of `main`. This triggers validation, production dependency audits, a Compose smoke check, image publication as `:latest`, and a GitHub Release tagged `update-2026-09-21-01` using the top changelog section.
5. Start the next batch with a new `Unreleased` section and reset the app metadata to draft values. Package versions do not need bumping.

Only the tip commit's first line controls publication. Earlier release commits or a release title in the body do not trigger it; extra text on the title line is rejected. Ordinary commits run CI without publishing, and no manual workflow dispatch is needed. A retry can finish creating the release after image upload while the release tag is absent; once that tag exists, use a new announcement for further changes.

The app tracks acknowledgement by announcement ID in the legacy `lastSeenReleaseNotesVersion` field. Users who skip updates see the newest announcement after updating and reloading.

To publish the same multi-platform image to an additional private registry, configure repository Actions secrets:

| Secret | Value |
| --- | --- |
| `PRIVATE_REGISTRY_ENDPOINT` | Registry hostname with optional port, such as `registry.example.com:5000`; no scheme, path, or trailing slash. |
| `PRIVATE_REGISTRY_USERNAME` | Registry login username. |
| `PRIVATE_REGISTRY_PASSWORD` | Password or access token with push permission. |

When configured, the workflow pushes to both `ghcr.io/issogr/newsflow:latest` and `<PRIVATE_REGISTRY_ENDPOINT>/issogr/newsflow:latest`. The image path follows the lowercase GitHub `<owner>/<repository>` name. The private registry must be reachable over HTTPS from the GitHub-hosted runner; the GitHub Release is created after both pushes succeed. Leaving the endpoint unset publishes only to GHCR.

</details>

## License

News Flow is licensed under the [MIT License](LICENSE).
