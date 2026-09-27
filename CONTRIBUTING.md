# Contributing to Paperlight

Thanks for helping. Bug reports, ideas, docs and code are all welcome.

## Ways to help

- **Report a bug**: [open an issue](https://github.com/webKing021/paperlight/issues/new/choose)
  with steps to reproduce and your Windows version.
- **Suggest a feature**: open a feature request and describe the problem it solves.
- **Pick an issue**: look for [`good first issue`](https://github.com/webKing021/paperlight/labels/good%20first%20issue)
  or [`help wanted`](https://github.com/webKing021/paperlight/labels/help%20wanted). Comment
  on it so nobody duplicates work.

## Set up

You need Windows 10/11, Node.js 20+, Rust (stable, MSVC toolchain), the Visual Studio C++
Build Tools and WebView2 (preinstalled on Windows 11).

```bash
git clone https://github.com/webKing021/paperlight
cd paperlight
npm install
npm run tauri dev
```

Tip: `PAPERLIGHT_DATA_DIR=<some folder>` keeps a separate index, so you can experiment
without touching your real one.

## Project layout

```
src/                React + TypeScript UI (components/, lib/, stores/)
src-tauri/src/
  commands.rs       everything the UI can call
  db/               SQLite schema, migrations and queries (FTS5)
  indexer/          scanner, live watcher, exclusions and formats
  content/          reading text out of documents
  dupes.rs          duplicate detection
  search.rs         query parsing and ranking
  shell.rs          tray, hotkey, quick-search window
```

`PLAN.md` explains the design; `CHANGELOG.md` lists what changed.

## Making a change

1. Branch from `dev`: `git checkout -b feature/short-name dev`.
2. Keep the change focused. Add or update tests for Rust logic.
3. Run the same checks as CI:

   ```bash
   npm run build                                   # type-check + bundle
   cd src-tauri
   cargo fmt --check
   cargo clippy --all-targets -- -D warnings
   cargo test
   ```

4. Add a line to `CHANGELOG.md` under *Unreleased*.
5. Open a pull request **into `dev`**. Screenshots help for UI changes.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
(`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).

## Releasing (maintainers)

Installed copies update themselves from GitHub Releases, so a release is just a tag:

1. Bump the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`,
   and move the *Unreleased* notes in `CHANGELOG.md` under `## [x.y.z] - date`.
2. Merge into `main`, then tag and push: `git tag vx.y.z && git push origin vx.y.z`.
3. The **Release** workflow builds the installer, signs it with the `TAURI_SIGNING_PRIVATE_KEY`
   secret and drafts a release with the installer, its `.sig` and `latest.json`. The changelog
   section becomes the release notes shown in the app.
4. Check the draft and press **Publish**. From then on every installed Paperlight offers the
   update on its next check.

Never change the updater public key in `tauri.conf.json` unless you mean to: installed copies
only accept updates signed with the matching private key.

## Principles

These are what make Paperlight Paperlight; PRs are reviewed against them.

- **Read-only.** Paperlight never modifies, moves or deletes a user's files.
- **Private and offline.** No telemetry, and nothing may need the internet to work. The only
  network use is the optional update check (one small request to GitHub, can be turned off);
  don't add others.
- **Light.** No polling timers, no needless scans, near-zero CPU when idle. Heavy UI code is
  lazy-loaded. Measure memory and CPU for anything that runs in the background.
- **Calm, native design.** Reuse the tokens in `src/index.css` and the shared components
  (`FileIcon`, `Switch`, `Kbd`, `PageHeader`, `EmptyState`), Segoe UI Variable, hairline
  borders and small radii. Amber is for the mark, selection and highlights only. No gradients,
  glows, pastel badges or monospace labels (see PLAN.md §3a).

## Code of conduct

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
