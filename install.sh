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
API_URL="https://api.github.com/repos/${REPO}/releases/latest"
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

# asset_url <regex> : print the first release asset download URL matching regex
asset_url() {
  printf '%s' "$RELEASE_JSON" \
    | grep -o '"browser_download_url":[[:space:]]*"[^"]*"' \
    | cut -d'"' -f4 \
    | grep -E "$1" \
    | head -n1
}

# ---- start --------------------------------------------------------------

printf '\n\033[1mInstalling %s\033[0m\n\n' "$APP_NAME"

info "Looking up the latest release..."
RELEASE_JSON="$(fetch "$API_URL")" || err "could not reach GitHub"
VERSION="$(printf '%s' "$RELEASE_JSON" | grep -o '"tag_name":[[:space:]]*"[^"]*"' | cut -d'"' -f4)"
[ -n "$VERSION" ] || err "could not determine the latest version"
ok "Latest version: $VERSION"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

OS="$(uname -s)"
case "$OS" in
  Darwin) # ---------------------------------------------------------- macOS
    URL="$(asset_url '\-universal-mac\.zip$')"
    [ -n "$URL" ] || err "no macOS build found in release $VERSION"

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

    ok "Installed $APP_NAME $VERSION to $APPDIR"
    printf '\n  Launch it with:  \033[1mopen -a "%s"\033[0m\n\n' "$APP_NAME"
    ;;

  Linux) # ---------------------------------------------------------- Linux
    URL="$(asset_url '\.AppImage$')"
    [ -n "$URL" ] || err "no Linux AppImage found in release $VERSION"

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
