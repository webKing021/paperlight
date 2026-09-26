# Paperlight — Project Plan

> **Paperlight** — *a spotlight for every document on your PC.*
> One calm, fast place to find, open and organise every PDF, Word, Excel and PowerPoint
> file on your laptop — without ever moving a single file on disk.

---

## 1. The problem

- Documents are scattered across drives, `Downloads`, `Desktop`, project folders, nested sub-folders.
- You remember *what* a file is about (or roughly its name) but not *where* you saved it.
- Windows Explorer search is slow, needs you to pick the right folder first, and mixes documents
  with thousands of irrelevant system/app files.

## 2. Goals & non-goals

**Goals**
1. Automatically discover every document (`pdf, doc, docx, xls, xlsx, xlsm, csv, ppt, pptx, odt, ods, odp, rtf, txt, md`) on chosen drives.
2. Keep the index **always up to date** (new / renamed / moved / deleted files) with no manual refresh.
3. **Instant search** (< 50 ms for name search on 100k files) that tolerates typos and partial words.
4. Search **inside** documents (text content), not just names.
5. **Smart views**: Recent, Recently opened, Frequent, Favourites, Tags, By type, By location, Large files, Duplicates.
6. One-keystroke actions: open, reveal in Explorer, copy path, favourite, tag.
7. A global hotkey (`Alt+Space` by default) that summons Paperlight from anywhere, Spotlight-style.
8. Minimal, professional, keyboard-first UI with light & dark themes.
9. **100 % local & private** — no network calls, no telemetry, nothing leaves the laptop.

**Non-goals (v1)**
- Moving/renaming/deleting files on disk (Paperlight is read-only on your files; tags/favourites live in its own DB).
- Cloud sync, multi-device, editing documents, OCR of scanned images (possible later — see §12).

## 3. User experience

```
┌──────────────────────────────────────────────────────────────────────────┐
│  ◉ Paperlight        [ 🔍  Search documents, content, paths…   ⌘K ]   ⚙  │
├───────────────┬──────────────────────────────────────┬───────────────────┤
│ LIBRARY       │  Type ▾  Modified ▾  Location ▾  Size ▾ │  PREVIEW          │
│  ◎ All docs   │ ───────────────────────────────────── │  ┌─────────────┐  │
│  ◷ Recent     │  📕 Invoice_March_2024.pdf   2 d ago   │  │  page 1     │  │
│  ↻ Opened     │     D:\Work\Clients\Acme\Billing        │  │  thumbnail  │  │
│  ★ Favourites │  📘 Project Proposal v3.docx  1 w ago  │  └─────────────┘  │
│  ⚑ Duplicates │     C:\Users\…\Documents\Proposals      │  Invoice_March…   │
│ TYPES         │  📗 Budget 2025.xlsx          3 w ago  │  2.1 MB · PDF     │
│  PDF   1 204  │     D:\Finance                          │  D:\Work\Clients… │
│  Word    873  │  …(virtualised list, 100k rows OK)      │  [Open] [Reveal]  │
│  Excel   412  │                                         │  Tags: #tax #acme │
│ TAGS          │                                         │  "…matched text…" │
│  # tax        │                                         │                   │
│  # clients    │                                         │                   │
├───────────────┴──────────────────────────────────────┴───────────────────┤
│  ● Indexed 2 489 documents · watching 2 drives · up to date               │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Keyboard first**: type to search, `↑/↓` move, `Enter` open, `Ctrl+Enter` reveal in folder,
  `Ctrl+C` copy path, `Ctrl+D` favourite, `Ctrl+T` tag, `Esc` clear / hide.
- **Quick launcher**: global hotkey opens a compact floating search window; `Enter` opens the file and the window hides.
- **Search syntax (optional power-user)**: `type:pdf`, `in:D:\Work`, `modified:<7d`, `tag:tax`, `"exact phrase"`.
- **First-run onboarding**: choose drives/folders to watch (defaults: all fixed drives), see live scan progress.
- **Visual style**: neutral greys, one accent colour, Inter font, 8-pt spacing grid, subtle motion,
  file-type colour chips (PDF red, Word blue, Excel green, PowerPoint orange).

## 4. Architecture

```
┌──────────────────── Frontend (WebView2) ───────────────────┐
│ React 19 + TypeScript + Vite + Tailwind CSS v4             │
│ zustand (state) · @tanstack/react-virtual (list)          │
│ lucide-react (icons) · pdf.js (preview, phase 6)          │
└───────────────▲──────────────────────────┬─────────────────┘
                │ events (scan progress,   │ invoke() commands
                │ index changed)           ▼ (search, open, tag…)
┌───────────────┴──────────── Rust core (Tauri 2) ───────────┐
│ commands.rs   – thin API layer exposed to the UI           │
│ db/           – SQLite (rusqlite, bundled, WAL, FTS5)       │
│ indexer/                                                    │
│   scanner.rs  – parallel full walk (jwalk)                  │
│   watcher.rs  – live changes (notify + debouncer)           │
│   reconcile.rs– startup diff (mtime/size) for offline edits │
│   filters.rs  – extension whitelist + excluded dirs         │
│ extract/      – text extraction workers (pdf/docx/xlsx/pptx)│
│ search/       – query parser + ranking                      │
│ dupes.rs      – duplicate detection (size → blake3 hash)    │
│ Plugins: opener, dialog, global-shortcut, single-instance,  │
│          autostart, tray                                    │
└─────────────────────────────────────────────────────────────┘
```

**Why this split**: all heavy lifting (disk walking, hashing, text extraction, search) lives in Rust
threads, so the UI never freezes. The UI only asks for *pages* of results.

## 5. Data model (SQLite, stored in `%APPDATA%\com.paperlight.app\paperlight.db`)

| Table | Columns | Notes |
|---|---|---|
| `roots` | id, path, enabled, added_at | Folders/drives being watched |
| `exclusions` | id, pattern | Dir names / globs to skip |
| `files` | id, path (UNIQUE), name, stem, ext, kind, dir, root_id, size, created_at, modified_at, first_seen_at, last_seen_at, content_status, content_hash, is_favourite, open_count, last_opened_at | One row per document |
| `files_fts` | name, dir (FTS5 **trigram** tokenizer, external content = files) | Substring & typo-tolerant name/path search |
| `content_fts` | file_id, body (FTS5 unicode61 + remove_diacritics) | Extracted document text |
| `tags`, `file_tags` | id, name, colour / file_id, tag_id | User tags (never written to the file) |
| `opens` | file_id, opened_at | History for Recent/Frequent |
| `settings` | key, value (JSON) | Theme, hotkey, extraction limits… |

Paths are stored normalised (case-preserved, compared case-insensitively on Windows).

## 6. Indexing strategy (the "knows everything" part)

1. **Initial scan** — `jwalk` walks each root in parallel. We read only directory entries + metadata
   (no file contents), filter by extension, and batch-insert 5 000 rows per transaction. Expected:
   ~100k–300k directory entries/sec on SSD → a full laptop in well under a minute.
2. **Default exclusions** — `C:\Windows`, `Program Files*`, `ProgramData`, `$Recycle.Bin`,
   `System Volume Information`, `AppData`, `node_modules`, `.git`, `target`, `venv`, `.venv`,
   `__pycache__`, `site-packages`, `.cache`, temp files `~$*.docx` (Office lock files). User-editable.
3. **Live watching** — `notify` (ReadDirectoryChangesW) on each root, recursive, through a debouncer
   that pairs rename events. Create → insert, modify → update metadata + queue re-extract,
   remove → delete row, rename/move → update path **keeping tags/favourites/history**.
4. **Startup reconciliation** — changes made while Paperlight was closed are caught by a quick
   incremental re-walk comparing `(size, modified_at)`; rows not seen are removed (moved files
   are matched by size+name+mtime to preserve tags).
5. **Content extraction** — background worker pool (`num_cpus/2`, low priority) drains a queue;
   skipped for files > 50 MB (configurable); results cached by `(size, mtime)` so a file is only
   re-read when it changes. Every extractor runs under `catch_unwind` + timeout so a corrupt
   file can never crash the app.
   - PDF → `pdf-extract` (fallback `lopdf`)
   - DOCX/PPTX/ODT/ODP → `zip` + `quick-xml` text runs
   - XLSX/XLS/ODS/CSV → `calamine` (sheet names + cell text)
   - TXT/MD/RTF → direct read (RTF stripped)
   - Legacy `.doc`/`.ppt` → name/metadata only in v1

## 7. Search & ranking

- Query is parsed into free text + filters (`type:`, `in:`, `tag:`, `modified:`, `size:`).
- **Name/path**: FTS5 trigram `MATCH` gives substring matching ("voic" → "Invoice"). For queries
  shorter than 3 chars, or zero hits, fall back to `LIKE` + a fuzzy scorer (`nucleo-matcher`) over
  candidate names for typo tolerance ("invoce" → "Invoice").
- **Content**: FTS5 `MATCH` with `bm25()` and `snippet()` to show the matching sentence.
- **Final score** = text relevance (name match ≫ path match > content match)
  + recency boost (modified/opened recently) + frequency boost (`open_count`) + favourite boost.
- Results are paged (`limit/offset`) and rendered in a virtualised list.

## 8. Performance targets

| Metric | Target |
|---|---|
| Cold start to usable UI | < 1 s |
| Name search, 100k docs | < 50 ms |
| Content search, 20k docs | < 150 ms |
| Idle CPU while watching | ~0 % |
| Idle RAM | < 150 MB |
| Installer size | < 15 MB |

## 9. Security & privacy

- No network permission at all; Tauri capabilities grant only what each window needs.
- Paperlight never writes, moves or deletes user files. Only `open`/`reveal` via the OS.
- Asset-protocol access (for previews) is scoped to the configured roots only.
- DB lives in the user's AppData; "Reset index" in settings wipes it.

## 10. Repository & workflow

```
paperlight/
├─ src/                 React UI (components/, features/, lib/, stores/)
├─ src-tauri/           Rust core (src/db, src/indexer, src/extract, src/search, …)
├─ docs/                screenshots, design notes
├─ .github/workflows/   CI (lint + type-check + cargo check/test on Windows)
├─ PLAN.md  README.md  CHANGELOG.md
```

**Branching model**
- `main` — always stable & buildable; every completed feature lands here.
- `dev` — working/integration branch.
- `feature/<name>` — one branch per milestone, branched from `dev`.
- Flow per feature: `feature/x` → merge (`--no-ff`) into `dev` → verify build → merge `dev` into `main` → push → tag milestone.
- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`).

## 11. Milestones (each = one feature branch, merged to `main` when done)

| # | Branch | Scope | Done when |
|---|---|---|---|
| 0 | `chore/scaffold` | Tauri 2 + React + TS + Vite + Tailwind, lint/format, app icon, window chrome, CI | `npm run tauri dev` opens the themed empty shell |
| 1 | `feature/indexer-core` | SQLite schema + migrations, roots/exclusions, parallel scanner, progress events, basic stats | Full scan of all drives stores every document; progress shown |
| 2 | `feature/search-ui` | Search bar, FTS trigram + fuzzy fallback, virtualised results, open / reveal / copy path, keyboard nav | Type → instant results → Enter opens the file |
| 3 | `feature/live-watcher` | notify watcher, rename/move tracking, startup reconciliation, status bar | Creating/renaming/deleting a doc reflects in the UI within ~1 s |
| 4 | `feature/smart-views` | Sidebar: Recent, Opened, Frequent, Favourites, Types, Locations, Large; filters; tags; open history | All views populated and filterable |
| 5 | `feature/content-search` | Extraction workers, content FTS, snippets, search syntax | Searching a phrase inside a PDF finds it with a highlighted snippet |
| 6 | `feature/preview-panel` | Details pane, PDF first-page preview (pdf.js), text preview for others | Selecting a file shows preview + metadata |
| 7 | `feature/quick-launcher` | Global hotkey window, tray icon, autostart, single instance | `Alt+Space` from anywhere → search → open |
| 8 | `feature/settings-insights` | Settings page (roots, exclusions, hotkey, theme, limits, reset), duplicates, storage insights | Everything configurable from UI |
| 9 | `release/v1.0` | NSIS installer, version bump, README with screenshots, CHANGELOG | Installable `Paperlight_1.0.0_x64-setup.exe` |

## 12. Future ideas (post v1)

- NTFS USN-journal reader (like "Everything") for near-instant rescans (needs admin).
- OCR for scanned PDFs/images (Tesseract), semantic search with a local embedding model.
- Smart auto-collections ("Invoices", "Resumes", "Tax") via rules on name/content.
- Removable/network drive awareness (show offline files greyed out).

## 13. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Corrupt/huge files crash extractors | `catch_unwind`, per-file timeout, size cap, run off main thread |
| Watcher misses events (buffer overflow on massive copies) | Detect overflow → targeted rescan of that root; periodic light reconcile |
| Permission-denied folders | Skip silently, count & show in diagnostics |
| DB growth from content text | Store extracted text only in FTS, cap per-file text (e.g. 2 MB) |
| Limited C: drive space | Rust toolchain, build cache and VS Build Tools installed on **D:** (see §14) |

## 14. Development environment (this machine)

- C: has ~7 GB free → heavy tooling goes to **D:\DevTools**:
  - `RUSTUP_HOME=D:\DevTools\rustup`, `CARGO_HOME=D:\DevTools\cargo` (user env vars + PATH)
  - VS 2022 Build Tools (MSVC v143 + Windows 11 SDK) → install path & shared components on `D:\DevTools\BuildTools`
    (the Windows SDK itself still lands on C:, ~1–2 GB)
  - Cargo `target/` lives inside the project on D:
- Node.js v25 / npm 11 (already installed), Git 2.50, GitHub CLI (`gh`) for repo management.
