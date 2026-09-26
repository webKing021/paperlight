# Changelog

All notable changes to Paperlight are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added — Milestone 2: search
- Ranked search over names and folders: trigram index for 3+ letter terms, LIKE for short
  ones ("cv", "v3"), multi-word AND, name matches outrank folder matches, whole-name and
  word-start bonuses, small boosts for recent / favourite / often-opened files.
- Typo tolerance that stays strict: one typo in 5+ letter words, two in 9+ letter words,
  adjacent swaps count as one ("reprot" → report); exact matches always rank first.
- Search inside the current view (type filter, recent), 90 ms debounce, match highlighting.
- Open (Enter / double-click), Show in folder (Ctrl+Enter), Copy path (Ctrl+Shift+C),
  hover actions and a right-click menu; keyboard navigation with ↑ ↓ PgUp PgDn.
- Files are opened by id through the Rust core — the UI cannot open arbitrary paths; files
  that vanished since the last sync are dropped from the index with a notice.
- Measured on real data: every query answers in about 1 ms.

### Added — Milestone 1: indexer core
- SQLite index (WAL, auto-vacuum) with FTS5 trigram search over names and folders.
- Parallel scanner for all fixed drives with smart exclusions (Windows, Program Files,
  AppData, node_modules, dot-folders, Recycle Bin, Office lock files).
- Diff-based sync: rescans write only new / changed / deleted files; an unchanged disk
  costs ~0 database writes. Deleted files are removed only after a full, uncancelled walk.
- Automatic sync on launch only when the index is older than 12 h, delayed 5 s, running in
  Windows background mode (low CPU + disk priority) on at most 4 threads.
- First-run onboarding (choose drives / folders), live scan progress with cancel,
  virtualised paged file list, live per-type counts, status bar with Rescan.
- Measured on the development laptop: full scan of C: + D: (15k folders, 454 documents)
  in 2.7 s; background re-sync in 1.2 s with zero writes; Rust process ~32 MB RAM.

### Added
- Project plan (`PLAN.md`) and README.
- Tauri 2 + React 19 + TypeScript + Tailwind v4 scaffold.
- App shell: sidebar (Library / Types / Tags), search bar with `Ctrl+K`, status bar,
  light / dark / system theme, Paperlight icon.
- CI workflow (type-check, frontend build, rustfmt, clippy, tests) on Windows.
