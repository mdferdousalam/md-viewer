# Markdown Viewer

A fast, simple, cross-platform **Markdown viewer & editor** for **Windows, macOS, and Linux**, built with Electron.

![status](https://img.shields.io/badge/platforms-win%20%7C%20mac%20%7C%20linux-blue)

## Download & Install

Grab the installer for your operating system from the
[**Releases page**](https://github.com/mdferdousalam/md-viewer/releases/latest).

> The app is **not code-signed yet**, so each OS shows a one-time security prompt
> the first time you open it. Steps to get past it are below — this is expected
> for indie apps and safe to proceed.

### ⌨️ Install from the terminal

**macOS or Linux** — one line (downloads and installs the latest release; clears the
macOS quarantine flag for you):
```sh
curl -fsSL https://raw.githubusercontent.com/mdferdousalam/md-viewer/main/install.sh | sh
```

**Windows** (PowerShell):
```powershell
irm https://raw.githubusercontent.com/mdferdousalam/md-viewer/main/install.ps1 | iex
```

**Homebrew** (macOS) — `brew upgrade` keeps it up to date:
```sh
brew tap mdferdousalam/tap
brew install --cask md-viewer
```
> If Homebrew refuses with an *"untrusted tap"* message (newer Homebrew versions),
> run `brew trust --cask mdferdousalam/tap/md-viewer` once, then re-run the install.

**Scoop** (Windows) — `scoop update md-viewer` keeps it up to date:
```powershell
scoop bucket add md-viewer https://github.com/mdferdousalam/md-viewer
scoop install md-viewer
```

**winget** (Windows) — available once the manifest is accepted into the community repo:
```powershell
winget install mdferdousalam.MarkdownViewer
```

Prefer a graphical installer? Use the manual per-OS downloads below.

### 🍎 macOS
1. Download `Markdown-Viewer-<version>-universal.dmg` (a single **universal** build that runs on both **Intel** and **Apple Silicon** Macs)
2. Open it and drag **Markdown Viewer** into your **Applications** folder
3. First launch: **right-click** the app → **Open** → **Open** (bypasses Gatekeeper once)
4. If Apple Silicon says *"app is damaged and can't be opened"*, run this once in Terminal:
   ```bash
   xattr -cr "/Applications/Markdown Viewer.app"
   ```

### 🪟 Windows
1. Download `Markdown-Viewer-Setup-<version>.exe`
2. Run it. If Microsoft Defender SmartScreen appears → **More info** → **Run anyway**
3. Follow the installer (choose folder, create desktop shortcut)
4. Prefer no install? Download the **portable** `.exe` and just run it.

### 🐧 Linux
- **AppImage** (works on most distros, no install):
  ```bash
  chmod +x Markdown-Viewer-<version>.AppImage
  ./Markdown-Viewer-<version>.AppImage
  ```
- **Debian/Ubuntu** (`.deb`):
  ```bash
  sudo apt install ./md-viewer_<version>_amd64.deb
  ```

### Updates
The app **updates itself automatically** on **Windows** and **Linux** — it checks the
Releases page on launch and installs new versions in the background.
On **macOS**, auto-update needs code signing, so for now just re-download the latest
`.dmg` when a new version ships.

## Command line & automation

Once installed, drive the viewer from a terminal or a script (the installer puts a
`md-viewer` command on your `PATH`):

```sh
md-viewer notes.md                          # open in the app
md-viewer export notes.md --to pdf          # write notes.pdf (headless, no window)
md-viewer export notes.md --to html --out out.html
md-viewer render notes.md --to html         # print rendered HTML to stdout
cat notes.md | md-viewer render - --to html # read from stdin
```

Exports are fully self-contained — Mermaid diagrams, KaTeX math, and syntax
highlighting are all baked in.

**Live reload:** the open document reloads automatically when the file changes on disk,
so anything that rewrites it — another editor, a script, or an AI agent — updates the
preview live. If you have unsaved edits, it asks before replacing them.

## Features

- 📝 **Live split preview** — editor + rendered Markdown side by side, with synced scrolling
- 🎨 **Three themes** — dark, light, and sepia (`Ctrl/Cmd+Shift+L`)
- ⌘ **Command palette** (`Ctrl/Cmd+Shift+P`) — run any action instantly
- 🧭 **Document outline** (`Ctrl/Cmd+\`) — navigate headings, with active-section tracking
- 🔍 **Find & replace** (`Ctrl/Cmd+F`)
- 🧘 **Focus mode** (`Ctrl/Cmd+Shift+F`) — distraction-free writing
- 🧮 **Math** — inline `$…$` and block `$$…$$` rendered with KaTeX
- 📊 **Diagrams** — Mermaid flowcharts, sequence diagrams, and more
- ✅ **Interactive task lists** — tick checkboxes in the preview and the source updates live
- 🌈 **Syntax highlighting** in fenced code blocks (theme-aware)
- 🧰 **Formatting toolbar + shortcuts** — bold, italic, headings, lists, links, images, tables, code
- ⚡ **GitHub-flavored Markdown** — tables, task lists, strikethrough, autolinks, heading anchors
- 📊 **Reading time & word/character count** in the status bar
- 🔒 **Safe rendering** — HTML sanitized (DOMPurify) in a sandboxed renderer
- 💾 **Open / Save / Save As / Export to HTML / Export to PDF / Copy as HTML**
- 🖱️ **Drag & drop** a file to open · 🔗 **`.md` file associations** · ↩️ **unsaved-changes protection**
- 📴 **Fully offline** — no network, everything bundled

## Keyboard shortcuts

| Action            | Shortcut                 |
| ----------------- | ------------------------ |
| Command palette   | `Ctrl/Cmd + Shift + P`   |
| New / Open / Save | `Ctrl/Cmd + N / O / S`   |
| Save As           | `Ctrl/Cmd + Shift + S`   |
| Find & replace    | `Ctrl/Cmd + F`           |
| Bold / Italic / Link | `Ctrl/Cmd + B / I / K` |
| Editor / Split / Preview | `Ctrl/Cmd + 1 / 2 / 3` |
| Toggle outline    | `Ctrl/Cmd + \`           |
| Focus mode        | `Ctrl/Cmd + Shift + F`   |
| Cycle theme       | `Ctrl/Cmd + Shift + L`   |
| Keyboard shortcuts| `?`                      |

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

**© 2026 Ferdous. All Rights Reserved.** This project is **source-available, not open
source** — the source is published for transparency and reference only, and no rights to
use, copy, modify, or redistribute it are granted. See [LICENSE](LICENSE).

The **application itself is free to use** under the terms of the [EULA](EULA.md). Bundled
third-party components remain under their own licenses — see
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

External contributions are not accepted at this time.
