---
"react-doctor": patch
---

Scope React subproject discovery so running `react-doctor` from a home directory no longer reports unrelated, vendored projects as ambiguous candidates. When the scan root has no `package.json` or workspace manifest, the filesystem crawl now skips OS/editor app-data directories (`AppData`, `Library`, …) and stops descending past a fixed depth. Previously a home-directory scan could surface React packages bundled inside editor installs (e.g. a VS Code extension under `AppData`) alongside real projects, aborting with `Multiple React projects found`. See #545.
