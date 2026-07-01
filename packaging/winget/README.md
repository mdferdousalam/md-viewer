# winget manifests

These manifests describe **Markdown Viewer** for the
[Windows Package Manager](https://learn.microsoft.com/windows/package-manager/) so
users can `winget install mdferdousalam.MarkdownViewer`.

The files here are regenerated automatically on each release by
[`scripts/update-packages.sh`](../../scripts/update-packages.sh) (version + installer
SHA256 are filled in from the published GitHub Release).

## Submitting to the community repo

winget packages live in [`microsoft/winget-pkgs`](https://github.com/microsoft/winget-pkgs).
A package must be submitted there once, and a new manifest submitted for each release.
The easiest way is [`wingetcreate`](https://github.com/microsoft/winget-create) on Windows:

```powershell
winget install wingetcreate

# Point it at the released installer; it will prompt for metadata and open a PR.
wingetcreate new https://github.com/mdferdousalam/md-viewer/releases/download/v1.0.1/Markdown-Viewer-Setup-1.0.1.exe

# Or, for later releases, update the existing package version + installer:
wingetcreate update mdferdousalam.MarkdownViewer `
  --version 1.0.1 `
  --urls https://github.com/mdferdousalam/md-viewer/releases/download/v1.0.1/Markdown-Viewer-Setup-1.0.1.exe `
  --submit
```

Alternatively, copy the three YAML files in this folder into
`manifests/m/mdferdousalam/MarkdownViewer/<version>/` in a fork of `winget-pkgs`,
validate with `winget validate`, and open a pull request. A Microsoft reviewer /
automated checks must approve it before `winget install` works publicly.
