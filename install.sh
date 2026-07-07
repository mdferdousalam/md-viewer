#!/bin/sh
# Markdown Viewer installer for macOS and Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/mdferdousalam/md-viewer/main/install.sh | sh
#
# Downloads the latest release from GitHub and installs it. No dependencies
# beyond curl (or wget), unzip (macOS), and standard POSIX tools.
set -eu

REPO="mdferdousalam/md-viewer"
APP_NAME="Markdown Viewer"
RAW_ICON="https://raw.githubusercontent.com/${REPO}/main/assets/icon.png"

# ---- helpers ------------------------------------------------------------

info() { printf '  \033[36m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m%s\033[0m\n' "$*"; }
err()  { printf '\033[31mError:\033[0m %s\n' "$*" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

# fetch <url> -> stdout
fetch() {
  if have curl; then curl -fsSL "$1"
  elif have wget; then wget -qO- "$1"
  else err "need curl or wget installed"; fi
}

# download <url> <dest>
download() {
  info "Downloading $(basename "$2")..."
  if have curl; then curl -fL# -o "$2" "$1"
  elif have wget; then wget -q --show-progress -O "$2" "$1"
  else err "need curl or wget installed"; fi
}

# latest_tag : newest release tag (e.g. v1.2.5), resolved from the /releases/latest
# redirect on github.com. Avoids api.github.com/.../releases/latest, which is capped
# at 60 requests/hour per IP for anonymous callers and returns 403 once exhausted.
latest_tag() {
  _u="https://github.com/${REPO}/releases/latest"
  if have curl; then
    _eff="$(curl -fsSLo /dev/null -w '%{url_effective}' "$_u")" || return 1
    printf '%s' "${_eff##*/}"
  elif have wget; then
    # Scrape the redirect target (…/releases/tag/vX.Y.Z) from the response headers.
    wget -qS --spider "$_u" 2>&1 \
      | sed -n 's/^[[:space:]]*[Ll]ocation:[[:space:]]*//p' \
      | tail -n1 | tr -d '\r' | sed 's#.*/##'
  else
    err "need curl or wget installed"
  fi
}

# ---- start --------------------------------------------------------------

printf '\n\033[1mInstalling %s\033[0m\n\n' "$APP_NAME"

info "Looking up the latest release..."
VERSION="$(latest_tag)" || err "could not reach GitHub"
[ -n "$VERSION" ] && [ "$VERSION" != "latest" ] || err "could not determine the latest version"
VER="${VERSION#v}"
DL="https://github.com/${REPO}/releases/download/${VERSION}"
ok "Latest version: $VERSION"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

OS="$(uname -s)"
case "$OS" in
  Darwin) # ---------------------------------------------------------- macOS
    URL="$DL/Markdown-Viewer-${VER}-universal-mac.zip"

    ZIP="$TMP/mdviewer.zip"
    download "$URL" "$ZIP"

    info "Extracting..."
    unzip -q "$ZIP" -d "$TMP/app"

    APP_SRC="$(find "$TMP/app" -maxdepth 1 -name '*.app' | head -n1)"
    [ -n "$APP_SRC" ] || err "app bundle not found in archive"

    if [ -w /Applications ]; then APPDIR="/Applications"; else APPDIR="$HOME/Applications"; fi
    mkdir -p "$APPDIR"
    DEST="$APPDIR/${APP_NAME}.app"

    info "Installing to $APPDIR..."
    rm -rf "$DEST"
    mv "$APP_SRC" "$DEST"

    # The app is not code-signed; clear the quarantine flag so it opens without
    # the Gatekeeper "unidentified developer" prompt.
    xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

    # CLI shim so scripts and agents can run `md-viewer <subcommand>`
    # (e.g. `md-viewer export notes.md --to pdf`).
    if [ -w /usr/local/bin ]; then SHIMDIR="/usr/local/bin"; else SHIMDIR="$HOME/.local/bin"; fi
    mkdir -p "$SHIMDIR"
    ln -sf "$DEST/Contents/MacOS/${APP_NAME}" "$SHIMDIR/md-viewer"

    ok "Installed $APP_NAME $VERSION to $APPDIR"
    printf '\n  Launch it with:  \033[1mopen -a "%s"\033[0m\n' "$APP_NAME"
    case ":$PATH:" in
      *":$SHIMDIR:"*) printf '  From a terminal or scripts:  \033[1mmd-viewer <file>\033[0m\n\n' ;;
      *) printf '  CLI shim: \033[1m%s/md-viewer\033[0m  (add %s to PATH to use "md-viewer")\n\n' "$SHIMDIR" "$SHIMDIR" ;;
    esac
    ;;

  Linux) # ---------------------------------------------------------- Linux
    URL="$DL/Markdown-Viewer-${VER}.AppImage"

    BINDIR="$HOME/.local/bin"
    APPIMG="$BINDIR/md-viewer"
    mkdir -p "$BINDIR"
    download "$URL" "$APPIMG"
    chmod +x "$APPIMG"

    # Desktop entry + icon for the application menu.
    ICON_DIR="$HOME/.local/share/icons"
    DESK_DIR="$HOME/.local/share/applications"
    mkdir -p "$ICON_DIR" "$DESK_DIR"
    download "$RAW_ICON" "$ICON_DIR/md-viewer.png" || true

    cat > "$DESK_DIR/md-viewer.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=${APP_NAME}
Comment=Markdown viewer and editor
Exec=${APPIMG} %F
Icon=${ICON_DIR}/md-viewer.png
Terminal=false
Categories=Office;Utility;TextEditor;
MimeType=text/markdown;
EOF
    have update-desktop-database && update-desktop-database "$DESK_DIR" 2>/dev/null || true

    ok "Installed $APP_NAME $VERSION to $APPIMG"
    case ":$PATH:" in
      *":$BINDIR:"*) printf '\n  Run it with:  \033[1mmd-viewer\033[0m  (or find it in your app menu)\n\n' ;;
      *) printf '\n  Run it with:  \033[1m%s\033[0m\n  (add %s to your PATH to run it as "md-viewer")\n\n' "$APPIMG" "$BINDIR" ;;
    esac
    info "AppImages need FUSE. If it does not start, run: $APPIMG --appimage-extract-and-run"
    ;;

  *)
    err "unsupported OS: $OS (use install.ps1 on Windows)"
    ;;
esac
