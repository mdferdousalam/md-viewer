cask "md-viewer" do
  version "1.2.4"
  sha256 "0b70e5b85441d63c5fbde17ff1bd25d82e5644d108636224d73b4badde60f978"

  url "https://github.com/mdferdousalam/md-viewer/releases/download/v#{version}/Markdown-Viewer-#{version}-universal.dmg"
  name "Markdown Viewer"
  desc "Simple, fast cross-platform Markdown viewer and editor"
  homepage "https://github.com/mdferdousalam/md-viewer"

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
