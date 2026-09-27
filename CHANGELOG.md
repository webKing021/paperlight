# Changelog

All notable changes to Paperlight are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.1.0] - 2026-09-27

### Added
- Paperlight updates itself. It looks for a new version on launch (and at most twice a day
  after that), announces it once in a dialog with the release notes, and keeps an
  **Update available** card above Settings until you install it. **Update now** downloads the
  signed installer, installs it and reopens Paperlight, keeping your index, favourites, tags
  and settings. Nothing is downloaded until you choose to update, and updating is optional:
  Paperlight still works fully offline.
- Settings → About: **Check for updates** and a switch to turn automatic checks off.

## [1.0.0] - 2026-09-27

First release. Paperlight indexes every PDF, Word, Excel and PowerPoint file on the chosen
drives and folders, keeps the index current with a live watcher, and finds any of them by
name, folder or the words inside, from the app or from any app with Alt+Space. It only
reads your files: nothing is moved, renamed, uploaded or deleted.

### Find
- Ranked search over names, folders and the text inside documents, with the matching
  passage shown under each result and every match highlighted. Name matches rank above
  folder and text matches; whole-name, word-start, recent, favourite and often-opened
  documents get a boost.
- Prefix matching ("invoic" finds "invoices") and strict typo tolerance (one typo in words
  of 5+ letters, two in 9+, swapped letters count as one); exact matches always win.
- Search works inside every view (a type, recently changed, favourites, a tag…).
- Text is read from PDF, Word (docx), PowerPoint (pptx), Excel (xlsx, xlsm, xlsb, xls,
  ods), OpenDocument (odt, odp), CSV and RTF, in the background, newest documents first.
  Legacy doc, dot, ppt and pps files are found by name.
- Keyboard first: Ctrl+K to search, ↑ ↓ PgUp PgDn to move, Enter to open, Ctrl+Enter to
  show in folder, Ctrl+Shift+C to copy the path, Ctrl+D to star, Ctrl+T to tag.

### Always current
- A live watcher follows the disk: new, changed, renamed, moved and deleted documents show
  up within about a second, with no rescans. Renames, moves and Office's "safe save" keep
  a document's favourites, tags and history.
- Rescans are diffs: an unchanged disk costs almost no database writes. An automatic sync
  only runs on launch when the index is more than 12 hours old, at background priority.
- Windows, Program Files, AppData, the Recycle Bin, developer folders and dot-folders are
  skipped; add your own exclusions, or right-click any document and choose Exclude folder.
- Choose which file formats are indexed (Settings → File formats); turning one off
  removes its documents at once.

### Organise and explore
- Overview: one tile per document type (PDFs, Word documents, Spreadsheets,
  Presentations) with count, size and the formats present; pick one to list its documents,
  with a search box that looks only inside that type.
- Favourites, Recently changed, Recently opened, and tags kept only in Paperlight (create,
  rename, recolour, delete; tag from the right-click menu or the details panel).
- Details panel (Ctrl+I): a first-page preview for PDFs, a text card for other documents,
  folder, dates, open history, tags and whether the text has been read.
- Duplicates: byte-identical copies grouped, compared by size, then the first 64 KB, then
  a full blake3 hash, only when the view is opened. Nothing is ever deleted.
- Storage: size by type and the largest documents.

### Always available
- Quick search from any app: Alt+Space (or Ctrl+Shift+Space / Ctrl+Alt+P if taken) opens a
  small launcher; recently opened documents appear instantly.
- Tray icon with Open, Quick search, Rescan, Start with Windows and Quit. Closing the
  window keeps only the Rust core running (about 6 MB), still watching files.
- Optional start with Windows (hidden in the tray). A second launch brings the running
  Paperlight forward.

### Design
- A native Windows 11 look: Segoe UI Variable, quiet neutral surfaces, real document icons
  (a page with a coloured PDF / DOC / XLS / PPT badge) and a single amber accent from the
  mark. Light and dark themes follow Windows or your choice, including the title bar.
- An animated splash screen from the window's first frame, and full-window welcome screens
  on first run: choose locations, preferences, then watch the first scan. Settings → About
  shows them again.
- Collapsible sidebar (Ctrl+B) and details panel that slide smoothly; both are remembered.
- The version is shown in the status bar and in Settings → About, which also links to the
  author's GitHub, releases, issues and the source code.

### Private and light
- No network access and no telemetry. Files are opened and previewed by id through the Rust
  core; the UI never gets file-system access.
- No polling: 0 ms CPU while idle. Heavy parts (PDF preview, reports, settings) load only
  when first used.
- Windows installer (NSIS, per user, no admin rights): `Paperlight_1.0.0_x64-setup.exe`.
- `PAPERLIGHT_DATA_DIR` keeps a separate index (demos, screenshots, testing).
