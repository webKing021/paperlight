<p align="center">
  <img src="public/paperlight.svg" width="72" alt="Paperlight logo">
</p>

<h1 align="center">Paperlight</h1>

<p align="center">
  <b>Every document on your PC, one search away.</b><br>
  Find any PDF, Word, Excel or PowerPoint file by name, folder or the words inside it.<br>
  Fast, private, and it never touches your files.
</p>

<p align="center">
  <a href="https://github.com/webKing021/paperlight/releases/latest"><b>Download for Windows</b></a> ·
  <a href="#features">Features</a> ·
  <a href="CONTRIBUTING.md">Contribute</a>
</p>

<p align="center">
  <a href="https://github.com/webKing021/paperlight/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/webKing021/paperlight?color=18181b&label=release"></a>
  <a href="https://github.com/webKing021/paperlight/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/webKing021/paperlight/ci.yml?branch=main&label=ci"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-e09c26"></a>
</p>

![Paperlight overview: a tile per document type, the list below and a PDF preview](docs/screenshots/overview.png)

<!--
  DEMO VIDEO
  1. Open this file on github.com and click the pencil (Edit).
  2. Drag the .mp4 (max 100 MB) onto this spot. GitHub uploads it and inserts a link.
  3. Put that link on its own line, replacing this comment, and commit.
  GitHub turns the link into an inline video player.
-->

## Why

Documents pile up everywhere: Downloads, Desktop, project folders, old drives. You remember
what a file was about, not where you saved it. Paperlight indexes them all once, keeps up as
they change, and finds any of them in milliseconds.

## Features

- **Search inside documents.** Names, folders and the text of PDFs, Word, Excel and PowerPoint
  files, typo-tolerant, with the matching passage highlighted.
- **Buckets.** One tile per document type: PDFs, Word documents, Spreadsheets, Presentations,
  each with its own search.
- **Quick search from anywhere.** <kbd>Alt</kbd>+<kbd>Space</kbd> in any app, then <kbd>Enter</kbd> to open.
- **Always current.** New, renamed, moved and deleted files show up within a second.
- **Organise without touching files.** Favourites, tags, recently opened, previews.
- **Duplicates and storage.** Find byte-identical copies and see what takes space.
- **You choose what's indexed.** Pick the file formats and folders; skip the rest.
- **At home on Windows.** A native look, light and dark themes (title bar included) and a
  short welcome that sets everything up on first run.

## Screenshots

| Search inside documents | Quick search (<kbd>Alt</kbd>+<kbd>Space</kbd>) |
|---|---|
| ![Search results with matching passages](docs/screenshots/search.png) | ![Quick search launcher](docs/screenshots/quick-search.png) |
| **Duplicates** | **Storage** |
| ![Identical copies grouped](docs/screenshots/duplicates.png) | ![Size by type and largest documents](docs/screenshots/storage.png) |
| **Settings: formats and folders** | **Dark theme** |
| ![Choose file formats](docs/screenshots/settings.png) | ![Dark theme](docs/screenshots/dark.png) |
| **Welcome on first run** | **Set up in a minute** |
| ![Welcome screen](docs/screenshots/welcome.png) | ![Setup finished: documents found](docs/screenshots/first-scan.png) |

## Install

1. Download `Paperlight_x.y.z_x64-setup.exe` from the [latest release](https://github.com/webKing021/paperlight/releases/latest).
2. Run it. Windows 10/11, 64-bit; no admin rights needed. SmartScreen may warn because the
   installer isn't code-signed yet: *More info → Run anyway*.
3. The welcome screens walk you through setup: pick the drives or folders to index, choose a
   few preferences and press **Start indexing**. Paperlight is usable while the first scan runs.

## Private and light

- **Local only.** No network access, no telemetry, no account.
- **Read-only.** Your files are never modified, moved or deleted.
- **Tiny.** ~5 MB installer, ~6 MB of memory in the tray, zero CPU when idle.

## Keyboard

<kbd>Ctrl</kbd>+<kbd>K</kbd> search · <kbd>Enter</kbd> open · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> show in folder ·
<kbd>Ctrl</kbd>+<kbd>D</kbd> favourite · <kbd>Ctrl</kbd>+<kbd>T</kbd> tag ·
<kbd>Ctrl</kbd>+<kbd>B</kbd> sidebar · <kbd>Ctrl</kbd>+<kbd>I</kbd> details

## Build from source

```bash
npm install
npm run tauri dev      # run
npm run tauri build    # installer → src-tauri/target/release/bundle/nsis
```

Needs Node.js 20+, Rust (MSVC) and the Visual Studio C++ Build Tools. Built with
[Tauri 2](https://tauri.app), Rust, SQLite FTS5 and React.

## Contributing

Issues and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md) and look
for [good first issues](https://github.com/webKing021/paperlight/labels/good%20first%20issue).
If Paperlight saves you time, a star helps others find it.

Made by [webKing021](https://github.com/webKing021). Screenshots show made-up sample documents.
[MIT](LICENSE) licensed.
