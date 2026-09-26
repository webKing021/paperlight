# Changelog

All notable changes to Paperlight are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
