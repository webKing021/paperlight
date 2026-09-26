# Changelog

All notable changes to Paperlight are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added: choose which file formats are indexed
- Settings → File formats: tick the formats to index, per type or per extension (with a
  document count for each). Changes are staged and show what they will do before Apply.
- Formats turned off leave the index at once (no rescan) and their type disappears from the
  sidebar; turning one back on runs a diff-only rescan to find its documents.
- The scanner and live watcher only pick up enabled formats. Formats whose text isn't read
  (doc, dot, ppt, pps) are marked.

## [1.0.0] - 2026-09-26

First release. Paperlight indexes every PDF, Word, Excel and PowerPoint file on the chosen
drives, keeps the index current with a live watcher, and searches names, folders and the text
inside documents, from the app or from any app with Alt+Space. Everything below, milestones 0
to 8, is included.

### Release
- Windows installer (NSIS, per user, no admin rights): `Paperlight_1.0.0_x64-setup.exe`,
  4.7 MB.
- README with screenshots of the release build on a folder of made-up sample documents.
- `PAPERLIGHT_DATA_DIR` keeps a separate index (demos, screenshots, testing).
- Measured with the release build: Rust core 6 MB private memory, 0 ms CPU while idle.

### Added: Milestone 8, settings and insights
- Settings (sidebar footer): add, pause or remove locations (with document counts),
  manage excluded folders (folder names or full paths, typed or picked), theme, start with
  Windows (kept in step with the tray check), the quick-search hotkey in use, Rescan now,
  Reset index (with confirmation; locations, exclusions and tag names are kept) and the
  index size on disk. The details panel is hidden on this page.
- Exclude folder… in a document's right-click menu and in the details panel: pick any
  folder level between the document and its location (e.g. `D:\DevTools` rather than
  `D:\DevTools\BuildTools\Licenses\1033`). Its documents leave the index at once (no rescan),
  the watcher is re-planned, and removing the exclusion in Settings brings them back.
- Duplicates view: documents are grouped by exact size (index lookup), look-alikes are
  compared by their first 64 KB, and only files that still match are hashed in full with
  blake3, at background priority and only when the view is opened. Hashes are stored and
  cleared when a file's size or date changes, so later checks read nothing from disk.
  Sets show where the copies differ, with Open / Show in folder. Nothing is ever deleted.
- Storage view: documents, size on disk and index size; count, size and share per type;
  the largest documents.
- Settings, Duplicates and Storage are separate chunks loaded on first visit (2–10 KB).
- Database migration v4 (hash column, size and hash indexes). The write-ahead log is
  truncated on start and capped at 1 MB.
- Fixed: a path re-attached to a location with a changed size kept its old text.
- Measured on the development laptop (debug build): first duplicate check hashed 112
  candidates (584 MB) in about 5 s, finding 55 sets; repeat checks are instant; idle CPU
  0 ms over 15 s; Rust core 7 MB private memory; index 5.6 MB for 365 documents.

### Added: Milestone 7, always available
- Global quick search: Alt+Space (falls back to Ctrl+Shift+Space or Ctrl+Alt+P if taken)
  opens a small launcher from any app. Recently opened (or changed) files appear
  instantly; type to search names, folders and text. ↵ opens, Ctrl+↵ shows in folder,
  ⇧+↵ opens Paperlight, Esc or clicking away closes it.
- Tray icon with Open, Quick search, Rescan, Start with Windows and Quit.
- Closing the window keeps Paperlight in the tray and **destroys the web UI**, so in the
  background it is only the Rust core (about 6 MB measured), still watching files. The
  launcher is created on first use and freed after 10 idle minutes.
- Optional start with Windows (asked on the first-run screen, toggle in the tray); starts
  hidden in the tray.
- Single instance: launching Paperlight again brings the running one forward.
- Launcher uses native Windows 11 rounded corners and shadow; base styles moved into
  @layer base so component styles always win.

### Added: Milestone 6, details and preview
- Details panel (toggle with the header button or Ctrl+I; remembered): real first-page
  preview for PDFs, a paper-style text card for Word / Excel / PowerPoint, and name,
  favourite, Open / Show in folder / Copy path, folder, modified, created, open history,
  one-click tag toggles and text-reading status.
- pdf.js is loaded only when a PDF is first previewed (separate chunk). The parsed PDF is
  released right after rendering, and PDFs over 30 MB are not previewed.
- PDF bytes are served by id through the Rust core (no file-system access for the UI);
  CSP allows only a same-origin worker for pdf.js.

### Added: Milestone 5, search inside documents
- Text of PDF, Word (docx), PowerPoint (pptx), Excel (xlsx/xlsm/xlsb/xls/ods), OpenDocument
  (odt/odp), CSV and RTF files is read in the background and becomes searchable, with the
  matching passage shown under each result.
- One background-priority reader thread that sleeps when idle and reads newest documents
  first. Each file is read on a helper thread with a panic guard and a 20 s timeout. Files
  over 40 MB are skipped, at most ~32 K characters are kept per document, and zip parts are
  capped at 16 MB (zip-bomb guard).
- Text is re-read only when a file's size or date changes (not on rename or move).
- Name matches still rank above text matches; words are prefix-matched ("invoic" finds
  "invoices").
- Status bar shows "reading text of N documents" while the backlog is processed.
- Measured on the development laptop (debug build): 368 documents read in 26 s, index about
  9 MB, about 69 MB private memory afterwards.
- Release builds now unwind on panic (needed to contain parser crashes).
- Database migration v3 (content_fts, delete trigger, pending index).

### Added: Milestone 4, smart views
- Favourites: star any document (hover star, right-click, or Ctrl+D); lamp-amber star on
  rows; Favourites view with count.
- Recently opened: every document opened from Paperlight, most recent first.
- Tags: labels stored only in Paperlight (files are never modified). Create from the
  sidebar or straight from a document's menu (Ctrl+T), tag chips on rows, a view per tag
  with counts, and right-click a tag to rename, recolour (7 label-ink colours) or delete.
- Every view is searchable: search stays inside the current view (type, recent,
  favourites, opened, tag).
- Sortable columns (name / modified / size) while browsing.
- Lists reload every page on screen after an edit or live change, so nothing blanks out.
- Database migration v2 (tags, file_tags, indexes for opened and favourites), applied in
  place.

### Added: Milestone 3, live watching
- Index follows the disk in real time: new, changed, renamed, moved and deleted documents
  appear within about a second, with no rescans.
- Planned watches: drive roots and folders containing excluded children (e.g. a user profile
  with AppData) are watched shallowly; everything else gets one recursive watch. Windows,
  Program Files and AppData produce no events at all.
- Early filtering of irrelevant events (.tmp, .log, images…) and batching (300 ms quiet,
  at most every 2 s), applied in one transaction on a background-priority thread.
- Identity-preserving updates: renames, moves between folders (in any event order), folder
  renames and Office's "safe save" keep the same row, so favourites, history and tags
  survive.
- Folders moved or copied in are indexed at once; newly created top-level folders get their
  own watch; lost events (buffer overflow) trigger a quiet background re-sync.
- Exclusions now apply only below a location, so a folder you add explicitly is always
  honoured, even inside a hidden or excluded folder.
- Status bar shows "Live · watching for changes".
- Measured: 0 ms CPU while idle, about 36 MB RAM for the core process.

### Changed: brand identity
- New mark: geometric "P", with an ink stem and a lamp-amber half-disc bowl; new app icons.
- Warm paper and ink palette with one lamp-amber accent; warm charcoal dark theme.
- IBM Plex Sans + IBM Plex Mono replace Inter (bundled locally, no network).
- File types shown as label-ink tabs with mono extensions instead of pastel chips.
- Editorial first-run screen, ink primary button, amber selection edge, inverted toasts,
  mono status line; removed sparkle icons, pastel badges, glows and pill highlights.

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
