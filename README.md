# News Flow

<p align="center">
  <img src="frontend/public/logo.svg" alt="News Flow logo" width="108" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-active-0f766e" alt="Project status: active" />
  <img src="https://img.shields.io/badge/license-GPL--3.0-1d4ed8" alt="License: GPL-3.0" />
</p>

<p align="center">
  A focused RSS news reader that groups overlapping stories, keeps data local, and gives each user a personalized feed with real-time updates.
</p>

## Why It Stands Out

- News Flow is built to reduce the noise of modern RSS consumption: instead of showing the same story repeated across many feeds, it groups overlapping coverage into cleaner story clusters that are easier to scan.
- It stays lightweight and self-hostable by using local SQLite storage, built-in full-text search, and a simple single-service architecture, so the project remains practical to deploy without extra infrastructure.
- It gives each user control over relevance through source exclusions, recent-time filters, retention limits, and personal RSS feeds, making the product useful both as a shared instance and as a tailored private reader.
- It keeps the reading experience focused with live updates, multilingual support, and an in-app reader mode that extracts cleaner article text from the original source instead of sending users straight into cluttered layouts.
- It supports this goal with features designed around clarity rather than volume: grouped stories, source families by publisher domain, server-side search, reader caching, settings import/export, and optional passwordless accounts for frictionless access.

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

Common backend variables:

- `SCRAPE_INTERVAL_MS` - ingestion interval
- `ARTICLE_RETENTION_HOURS` - article and reader-cache retention window
- `MAX_ARTICLES_PER_SOURCE` - max parsed items per feed
- `NEWS_DB_PATH` - SQLite file path
- `SESSION_TTL_DAYS` - session lifetime

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
