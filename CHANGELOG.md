# Changelog

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
