<p><img src="public/paperlight.svg" width="64" alt="Paperlight"></p>

# Paperlight

> A spotlight for every document on your PC.

Paperlight finds, tracks and opens every PDF, Word, Excel and PowerPoint file on your laptop, all
from one fast, minimal window. It never moves your files. It indexes them where they are and keeps
the index current in real time.

- Instant, typo-tolerant search by name, path **and content**
- Live tracking of new, renamed, moved and deleted files
- Smart views: Recent, Opened, Favourites, Tags, Types, Locations, Duplicates
- Global hotkey quick-launcher (`Alt+Space`)
- 100 % local and private

Built with [Tauri 2](https://tauri.app), Rust, React and SQLite.

See [PLAN.md](PLAN.md) for the full design and roadmap.

## Status

🚧 In development. See the milestones in [PLAN.md](PLAN.md#11-milestones-each--one-feature-branch-merged-to-main-when-done).

## Development

Prerequisites: Node.js 20+, Rust (stable, MSVC toolchain), Visual Studio C++ Build Tools, WebView2.

```bash
npm install
npm run tauri dev      # run the app with hot reload
npm run tauri build    # produce the Windows installer
```

## Branching

- `main`: stable; every finished feature is merged here
- `dev`: integration/working branch
- `feature/*`, `chore/*`: one branch per milestone, merged into `dev` and then into `main`

## License

MIT
