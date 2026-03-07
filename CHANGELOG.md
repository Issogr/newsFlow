# Changelog

## 3.0.13

- removed backend file logging and switched fully to stdout/stderr logging for simpler container operation
- simplified Docker setup by removing the backend log volume and log-directory permission handling

## 3.0.12

- added per-user sub-feed exclusions so grouped sources can stay enabled while specific feeds are disabled in settings

## 3.0.11

- service restart now removes articles and stale excluded-source settings for default sources that were removed from configuration
- removed the old multi-RSS source handling and kept configured sources as explicit single-feed entries
- grouped related feeds such as ANSA and Il Sole 24 Ore under shared source families for filters, exclusions, and source stats

## 3.0.10

- allowed local-network origins such as `.local` hostnames and LAN IPs so self-hosted access works from other devices

## 3.0.9

- renamed source exclusion settings from hidden to excluded across the API and frontend to keep the terminology consistent
- removed the temporary hidden-source compatibility layer because the project is still pre-release

## 3.0.8

- added targeted backend tests for news aggregation paging, broadcasting, and empty-feed failure handling
- added deeper SQLite tests for article filtering, user source cleanup, and source/topic statistics

## 3.0.7

- added backend lint configuration compatible with ESLint 9 so static checks run correctly again
- added backend integration tests for authentication, user settings, personal source flows, and SQLite migrations
- added frontend smoke tests for session bootstrapping and authenticated shell rendering

## 3.0.6

- removed unused API and WebSocket code paths to simplify the live update and feed interfaces
- reduced frontend complexity by simplifying real-time connection handling and consolidating settings and locale helpers
- removed unused frontend testing dependencies and other small dead code paths to improve readability

## 3.0.5

- removed the Ollama AI integration and related configuration from the application
- removed the last legacy AI topic metadata from the SQLite schema and database migration path

## 3.0.4

- secured WebSocket connections with user session authentication
- limited live news and topic updates to the correct user session so private feeds do not leak across users

## 3.0.3

- added automatic feed name and language detection when saving a new personal RSS source
- added editing support for personal RSS sources after creation

## 3.0.2

- added settings export and import for personal preferences and custom RSS sources

## 3.0.1

- changed personal source preferences from default selected sources to hidden sources excluded from each user feed
- hidden sources now disappear from each user's source filters while remaining restorable from personal settings
- added a database write-permission startup check and database status reporting in the health endpoint

## 3.0.0

- added user registration and login with optional passwords
- added per-user sessions, private settings, and personal default language selection
- added per-user hidden sources, lower personal retention, and lower quick-filter window settings
- added personal RSS source management with feed validation and private ingestion

## 2.2.7

- added configurable automatic cleanup for articles and reader cache older than 24 hours

## 2.2.6

- moved the live connection status from the header badge into the notifications panel
- moved the refresh action into the site logo/title block and removed the separate refresh button
- simplified the language selector by removing the extra label and keeping only the locale switch

## 2.2.5

- added custom News Flow branding with a new site logo and favicon
- updated the in-app header and web manifest to use the new brand assets

## 2.2.4

- moved the reader refresh action next to the original source link to leave more space for the reader title

## 2.2.3

- updated reader mode to use the same base font as the rest of the website for better readability

## 2.2.2

- improved reader panel typography and spacing for easier reading
- added icons to reader mode metadata, states, and actions

## 2.2.1

- improved reader mode to preserve article structure more accurately
- added structured reader blocks for paragraphs, headings, lists, quotes, and preformatted text
- added reader cache support for structured content blocks

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
