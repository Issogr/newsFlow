# News Aggregator

News Aggregator is a web app that collects articles from multiple RSS sources, stores them locally, groups similar stories, assigns topics, and serves them through a filterable interface with real-time updates.

## How It Works

- The backend periodically fetches configured RSS feeds.
- Each article is normalized and stored in a local SQLite database.
- Topics are assigned from RSS categories and text keywords.
- Similar articles from different sources are grouped into a single news cluster.
- The frontend requests grouped news with server-side search, pagination, and filters.
- Users can create personal accounts and save private instance preferences.
- Each user can hide default sources, set a lower personal retention window, set a lower quick-filter window, choose a default UI language, and add private custom RSS feeds.
- Users can export and import their personal settings and custom RSS sources.
- When adding a personal RSS source, users only need the RSS URL; the app automatically detects the feed name and language, and the source can be edited later if needed.
- The web UI supports English and Italian, defaulting to the browser/system language and allowing manual switching.
- Reader mode can fetch the original article server-side, strip images/layout noise, and show a clean reading view inside the app.
- WebSocket notifications inform connected users when new grouped news or updated topics are available.

## Main Features

- Multi-source RSS aggregation
- Local persistence with SQLite
- User accounts with optional passwords
- Full-text search with FTS5
- Filters by source, topic, and recent time window
- Grouping of similar news from different publishers
- Real-time updates for multiple connected users
- English/Italian interface with automatic browser-language default
- Small language badge on news cards to show article language
- In-app reader mode with SQLite caching and source text extraction
- Per-user private settings and custom RSS source validation
- Settings export/import for personal preferences and custom sources

## Architecture

### Backend

- `backend/server.js`: starts the HTTP and WebSocket servers
- `backend/routes/api.js`: exposes REST endpoints
- `backend/services/newsAggregator.js`: runs scheduled ingestion and news grouping
- `backend/services/database.js`: manages SQLite storage and search
- `backend/services/userService.js`: manages accounts, sessions, settings, and personal sources
- `backend/services/rssParser.js`: fetches and parses RSS feeds
- `backend/services/websocketService.js`: pushes real-time updates to clients

### Frontend

- `frontend/src/components/NewsAggregator.js`: main page, filters, pagination, refresh flow
- `frontend/src/components/AuthScreen.js`: registration and login UI
- `frontend/src/components/SettingsPanel.js`: per-user settings and personal RSS source management
- `frontend/src/components/NewsCard.js`: renders grouped news cards
- `frontend/src/hooks/useWebSocket.js`: receives live updates from the backend
- `frontend/src/services/api.js`: calls backend APIs

## API Overview

- `POST /api/auth/register`: create a new user
- `POST /api/auth/login`: login and receive a session token
- `POST /api/auth/logout`: logout the current session
- `GET /api/me`: current user, personal settings, and personal sources
- `PATCH /api/me/settings`: update per-user defaults
- `GET /api/me/settings/export`: export personal settings and custom sources
- `POST /api/me/settings/import`: import personal settings and custom sources
- `POST /api/me/sources`: add a personal RSS source after validation
- `PATCH /api/me/sources/:sourceId`: update a personal RSS source after validation
- `DELETE /api/me/sources/:sourceId`: remove a personal RSS source
- `GET /api/news`: grouped news with pagination and filters
- `GET /api/articles/:articleId/reader`: cached clean reader view for one article
- `POST /api/refresh`: force a refresh (admin token required)
- `GET /api/ws/status`: WebSocket status

## Configuration

Useful backend variables:

- `SCRAPE_INTERVAL_MS`: scraping interval
- `ARTICLE_RETENTION_HOURS`: automatically remove articles and reader cache older than this age
- `MAX_ARTICLES_PER_SOURCE`: max articles read from each feed
- `NEWS_DB_PATH`: SQLite file path
- `SESSION_TTL_DAYS`: session duration for user logins
- `ADMIN_API_TOKEN`: admin token for protected endpoints

## Run

```bash
docker-compose up --build -d
```

Then open `http://localhost`.

## Notes

- Data is stored locally in `backend/data/news.db`.
- By default, articles older than 24 hours are automatically removed from storage.
- Users can only lower retention and quick-filter defaults inside their own profile; they cannot increase the server-wide limits.
- This setup is intentionally simple: no external database is required.
- It works well for a single deployed service and multiple simultaneous users.
