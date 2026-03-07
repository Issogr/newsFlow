# Changelog

## 2.2.0

- added in-app reader mode with clean text extraction and no images
- added SQLite caching for reader content to speed up repeated reads
- added server endpoint for per-article reader views

## 2.1.0

- added English/Italian UI localization with browser-language default and manual switch
- added a small language indicator on news cards

## 2.0.0

- moved persistence from memory/JSON to local SQLite with FTS5 search
- added scheduled background scraping
- added server-side filtering and pagination
- improved tagging with RSS/category fallback, keyword inference, and optional AI enrichment
- simplified the WebSocket layer for multi-user live updates
- removed unused frontend and backend code
