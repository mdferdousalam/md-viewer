# Markdown Viewer

A fast, simple, cross-platform **Markdown viewer & editor** for **Windows, macOS, and Linux**, built with Electron.

![status](https://img.shields.io/badge/platforms-win%20%7C%20mac%20%7C%20linux-blue)

## Download & Install

Grab the installer for your operating system from the
[**Releases page**](https://github.com/mdferdousalam/md-viewer/releases/latest).

> The app is **not code-signed yet**, so each OS shows a one-time security prompt
> the first time you open it. Steps to get past it are below — this is expected
> for indie apps and safe to proceed.

### 🍎 macOS
1. Download `Markdown Viewer-<version>.dmg`
2. Open it and drag **Markdown Viewer** into your **Applications** folder
3. First launch: **right-click** the app → **Open** → **Open** (bypasses Gatekeeper once)
4. If Apple Silicon says *"app is damaged and can't be opened"*, run this once in Terminal:
   ```bash
   xattr -cr "/Applications/Markdown Viewer.app"
   ```

### 🪟 Windows
1. Download `Markdown Viewer Setup <version>.exe`
2. Run it. If Microsoft Defender SmartScreen appears → **More info** → **Run anyway**
3. Follow the installer (choose folder, create desktop shortcut)
4. Prefer no install? Download the **portable** `.exe` and just run it.

### 🐧 Linux
- **AppImage** (works on most distros, no install):
  ```bash
  chmod +x "Markdown Viewer-<version>.AppImage"
  ./"Markdown Viewer-<version>.AppImage"
  ```
- **Debian/Ubuntu** (`.deb`):
  ```bash
  sudo apt install ./"Markdown Viewer_<version>_amd64.deb"
  ```

### Updates
The app **updates itself automatically** on **Windows** and **Linux** — it checks the
Releases page on launch and installs new versions in the background.
On **macOS**, auto-update needs code signing, so for now just re-download the latest
`.dmg` when a new version ships.

## Features

- 📝 **Live split preview** — editor on the left, rendered Markdown on the right, with synced scrolling
- 🎨 **Dark & light themes** (`Ctrl/Cmd+Shift+D`)
- 🧰 **Formatting toolbar** — bold, italic, headings, lists, task lists, links, images, tables, code blocks, and more
- ⚡ **GitHub-flavored Markdown** — tables, task lists, strikethrough, autolinks
- 🌈 **Syntax highlighting** in fenced code blocks (theme-aware)
- 🔒 **Safe rendering** — HTML is sanitized (DOMPurify) and runs in a sandboxed renderer
- 💾 **Open / Save / Save As / Export to HTML**
- 🖱️ **Drag & drop** a `.md` file to open it
- 🔗 **File associations** — double-click `.md` files to open them in the app
- ↩️ **Unsaved-changes protection** before closing
- 📴 **Fully offline** — no network, all assets bundled

## Keyboard shortcuts

| Action            | Shortcut                 |
| ----------------- | ------------------------ |
| New               | `Ctrl/Cmd + N`           |
| Open              | `Ctrl/Cmd + O`           |
| Save              | `Ctrl/Cmd + S`           |
| Save As           | `Ctrl/Cmd + Shift + S`   |
| Bold              | `Ctrl/Cmd + B`           |
| Italic            | `Ctrl/Cmd + I`           |
| Insert link       | `Ctrl/Cmd + K`           |
| Editor / Split / Preview | `Ctrl/Cmd + 1 / 2 / 3` |
| Toggle theme      | `Ctrl/Cmd + Shift + D`   |

## Development

```bash
npm install      # install dependencies
npm start        # build the renderer bundle and launch the app
npm run dev      # rebuild the renderer on change (run `electron .` separately)
```

## Releasing (for maintainers)

Releases are built automatically by **GitHub Actions** and published to the repo's
**Releases** page. To cut a release:

1. Bump the `version` in `package.json` (e.g. `1.0.0` → `1.0.1`)
2. Commit, then tag and push:
   ```bash
   git commit -am "Release v1.0.1"
   git tag v1.0.1
   git push origin main --tags
   ```
3. The [`Release` workflow](.github/workflows/release.yml) builds installers on
   macOS, Windows, and Linux runners and uploads them (plus `latest*.yml`
   auto-update metadata) to a GitHub Release for that tag.
4. Open the Release on GitHub, add notes, and publish it.

Windows and Linux users' installed apps will then auto-update to the new version.

### Building locally (optional)

You can also build installers on your own machine (each OS builds its own targets):

```bash
npm run dist         # current platform
npm run dist:win     # Windows  -> NSIS installer + portable .exe
npm run dist:mac     # macOS    -> .dmg + .zip
npm run dist:linux   # Linux    -> AppImage + .deb
```

Output is written to the `release/` directory. Cross-building for another OS from
your machine is unreliable — prefer the CI workflow above for real releases.

### Code signing (future)

The app currently ships **unsigned**. To remove OS security prompts and unlock
macOS auto-update, add signing later:

- **macOS**: an [Apple Developer](https://developer.apple.com/) account ($99/yr) plus
  notarization credentials (`CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`) as GitHub Actions secrets.
- **Windows**: an OV/EV code-signing certificate (`CSC_LINK`, `CSC_KEY_PASSWORD`).

Both are wired through electron-builder via environment variables — no code changes needed.

## Project structure

```
src/
  main/
    main.js        # Electron main process: windows, native menu, file dialogs, IPC
    preload.js     # Secure bridge (contextIsolation) between main and renderer
  renderer/
    index.html     # App shell (toolbar, editor, preview, status bar)
    styles.css     # Themes, layout, Markdown & syntax styling
    renderer.js    # Editor logic, Markdown pipeline (marked + DOMPurify + highlight.js)
    dist/          # esbuild output (generated)
build.js           # esbuild bundler for the renderer
```

## Tech

- [Electron](https://www.electronjs.org/) — cross-platform desktop shell
- [marked](https://marked.js.org/) — Markdown parser
- [DOMPurify](https://github.com/cure53/DOMPurify) — HTML sanitizer
- [highlight.js](https://highlightjs.org/) — code syntax highlighting
- [esbuild](https://esbuild.github.io/) — fast renderer bundler
- [electron-builder](https://www.electron.build/) — installers

## License

MIT
