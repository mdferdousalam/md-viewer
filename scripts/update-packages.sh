#!/bin/sh
# Regenerate package-manager definitions from a published GitHub release:
#   - Scoop manifest      -> bucket/md-viewer.json          (this repo)
#   - winget manifests    -> packaging/winget/*.yaml        (this repo)
#   - Homebrew cask       -> Casks/md-viewer.rb             (pushed to the tap repo)
#
# Usage:  scripts/update-packages.sh [version]     (default: package.json version)
#
# Env:
#   PUSH_CASK=0   skip pushing the Homebrew cask (e.g. in CI without a tap token)
#   GH_TOKEN      used by `gh` for the cask push; must have access to the tap repo
set -eu

REPO="mdferdousalam/md-viewer"
TAP_REPO="mdferdousalam/homebrew-tap"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PUSH_CASK="${PUSH_CASK:-1}"

VERSION="${1:-}"
[ -n "$VERSION" ] || VERSION="$(node -p "require('$ROOT/package.json').version")"
TAG="v$VERSION"

echo "Updating package definitions for $TAG"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

DMG="Markdown-Viewer-${VERSION}-universal.dmg"
PORTABLE="Markdown-Viewer-${VERSION}.exe"
SETUP="Markdown-Viewer-Setup-${VERSION}.exe"

echo "Downloading release assets..."
gh release download "$TAG" --repo "$REPO" --dir "$WORK" \
  --pattern "$DMG" --pattern "$PORTABLE" --pattern "$SETUP"

sha256() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else sha256sum "$1" | awk '{print $1}'; fi
}

DMG_SHA="$(sha256 "$WORK/$DMG")"
PORTABLE_SHA="$(sha256 "$WORK/$PORTABLE")"
SETUP_SHA="$(sha256 "$WORK/$SETUP")"
SETUP_SHA_UPPER="$(printf '%s' "$SETUP_SHA" | tr '[:lower:]' '[:upper:]')"

echo "  dmg      $DMG_SHA"
echo "  portable $PORTABLE_SHA"
echo "  setup    $SETUP_SHA"

REL="https://github.com/$REPO/releases/download"

# ---- Scoop manifest -----------------------------------------------------
mkdir -p "$ROOT/bucket"
cat > "$ROOT/bucket/md-viewer.json" <<EOF
{
    "version": "$VERSION",
    "description": "A simple, fast cross-platform Markdown viewer and editor.",
    "homepage": "https://github.com/$REPO",
    "license": "MIT",
    "architecture": {
        "64bit": {
            "url": "$REL/$TAG/$PORTABLE#/md-viewer.exe",
            "hash": "$PORTABLE_SHA"
        }
    },
    "bin": "md-viewer.exe",
    "shortcuts": [
        ["md-viewer.exe", "Markdown Viewer"]
    ],
    "checkver": "github",
    "autoupdate": {
        "architecture": {
            "64bit": {
                "url": "$REL/v\$version/Markdown-Viewer-\$version.exe#/md-viewer.exe"
            }
        }
    }
}
EOF
echo "Wrote bucket/md-viewer.json"

# ---- winget manifests ---------------------------------------------------
WG="$ROOT/packaging/winget"
mkdir -p "$WG"
cat > "$WG/mdferdousalam.MarkdownViewer.yaml" <<EOF
PackageIdentifier: mdferdousalam.MarkdownViewer
PackageVersion: $VERSION
DefaultLocale: en-US
ManifestType: version
ManifestVersion: 1.6.0
EOF

cat > "$WG/mdferdousalam.MarkdownViewer.installer.yaml" <<EOF
PackageIdentifier: mdferdousalam.MarkdownViewer
PackageVersion: $VERSION
InstallerType: nullsoft
Scope: user
InstallModes:
  - interactive
  - silent
Installers:
  - Architecture: x64
    InstallerUrl: $REL/$TAG/$SETUP
    InstallerSha256: $SETUP_SHA_UPPER
ManifestType: installer
ManifestVersion: 1.6.0
EOF

cat > "$WG/mdferdousalam.MarkdownViewer.locale.en-US.yaml" <<EOF
PackageIdentifier: mdferdousalam.MarkdownViewer
PackageVersion: $VERSION
PackageLocale: en-US
Publisher: Ferdous
PublisherUrl: https://github.com/mdferdousalam
PackageName: Markdown Viewer
PackageUrl: https://github.com/$REPO
License: MIT
LicenseUrl: https://github.com/$REPO/blob/main/LICENSE
ShortDescription: A simple, fast cross-platform Markdown viewer and editor.
Moniker: md-viewer
Tags:
  - markdown
  - editor
  - viewer
ManifestType: defaultLocale
ManifestVersion: 1.6.0
EOF
echo "Wrote packaging/winget/*.yaml"

# ---- Homebrew cask ------------------------------------------------------
CASK="$WORK/md-viewer.rb"
cat > "$CASK" <<EOF
cask "md-viewer" do
  version "$VERSION"
  sha256 "$DMG_SHA"

  url "$REL/v#{version}/Markdown-Viewer-#{version}-universal.dmg"
  name "Markdown Viewer"
  desc "Simple, fast cross-platform Markdown viewer and editor"
  homepage "https://github.com/$REPO"

  app "Markdown Viewer.app"

  # The app is not code-signed; drop the quarantine flag so it opens cleanly.
  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-dr", "com.apple.quarantine", "#{appdir}/Markdown Viewer.app"],
                   sudo: false
  end

  zap trash: [
    "~/Library/Application Support/Markdown Viewer",
    "~/Library/Preferences/ai.fintant.mdviewer.plist",
    "~/Library/Saved Application State/ai.fintant.mdviewer.savedState",
  ]
end
EOF

# Keep a copy in-repo for history/reference.
mkdir -p "$ROOT/packaging/homebrew"
cp "$CASK" "$ROOT/packaging/homebrew/md-viewer.rb"

if [ "$PUSH_CASK" = "1" ]; then
  echo "Pushing cask to $TAP_REPO via GitHub API..."
  B64="$(base64 < "$CASK" | tr -d '\n')"
  EXISTING_SHA="$(gh api "repos/$TAP_REPO/contents/Casks/md-viewer.rb" -q .sha 2>/dev/null || true)"
  if [ -n "$EXISTING_SHA" ]; then
    gh api --method PUT "repos/$TAP_REPO/contents/Casks/md-viewer.rb" \
      -f message="md-viewer $VERSION" -f content="$B64" -f sha="$EXISTING_SHA" >/dev/null
  else
    gh api --method PUT "repos/$TAP_REPO/contents/Casks/md-viewer.rb" \
      -f message="md-viewer $VERSION" -f content="$B64" >/dev/null
  fi
  echo "Cask pushed."
else
  echo "PUSH_CASK=0 -> skipped tap push (cask copy left in packaging/homebrew/md-viewer.rb)"
fi

echo "Done."
