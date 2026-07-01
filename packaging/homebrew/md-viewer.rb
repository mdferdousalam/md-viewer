cask "md-viewer" do
  version "1.1.0"
  sha256 "45a4698a1072f99075489da4a20b9ea55454d6cbb592ad33168577f1a071e14e"

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
