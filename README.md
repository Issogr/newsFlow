# News Aggregator

News Aggregator is a web app that collects articles from multiple RSS sources, stores them locally, groups similar stories, assigns topics, and serves them through a filterable interface with real-time updates.

## How It Works

- The backend periodically fetches configured RSS feeds.
- Each article is normalized and stored in a local SQLite database.
- Topics are assigned from RSS categories and text keywords; optional Ollama integration can enrich them further.
- Similar articles from different sources are grouped into a single news cluster.
- The frontend requests grouped news with server-side search, pagination, and filters.
- WebSocket notifications inform connected users when new grouped news or updated topics are available.

## Main Features

- Multi-source RSS aggregation
- Local persistence with SQLite
- Full-text search with FTS5
- Filters by source, topic, and recent time window
- Grouping of similar news from different publishers
- Real-time updates for multiple connected users
- Optional AI topic enrichment with Ollama

## Architecture

### Backend

- `backend/server.js`: starts the HTTP and WebSocket servers
- `backend/routes/api.js`: exposes REST endpoints
- `backend/services/newsAggregator.js`: runs scheduled ingestion and news grouping
- `backend/services/database.js`: manages SQLite storage and search
- `backend/services/rssParser.js`: fetches and parses RSS feeds
- `backend/services/websocketService.js`: pushes real-time updates to clients

### Frontend

- `frontend/src/components/NewsAggregator.js`: main page, filters, pagination, refresh flow
- `frontend/src/components/NewsCard.js`: renders grouped news cards
- `frontend/src/hooks/useWebSocket.js`: receives live updates from the backend
- `frontend/src/services/api.js`: calls backend APIs

## API Overview

- `GET /api/news`: grouped news with pagination and filters
- `GET /api/hot-topics`: most frequent topics
- `GET /api/sources`: available sources
- `GET /api/articles/:articleId/topics`: topics for one article
- `POST /api/refresh`: force a refresh (admin token required)
- `GET /api/ws/status`: WebSocket status

## Configuration

Useful backend variables:

- `SCRAPE_INTERVAL_MS`: scraping interval
- `MAX_ARTICLES_PER_SOURCE`: max articles read from each feed
- `NEWS_DB_PATH`: SQLite file path
- `USE_OLLAMA`: enable optional AI topic enrichment
- `OLLAMA_API_URL`: Ollama endpoint
- `ADMIN_API_TOKEN`: admin token for protected endpoints

## Run

```bash
docker-compose up --build -d
```

Then open `http://localhost`.

## Notes

- Data is stored locally in `backend/data/news.db`.
- This setup is intentionally simple: no external database is required.
- It works well for a single deployed service and multiple simultaneous users.
