---
"react-doctor": patch
---

Fix multi-project scans incorrectly recommending GitHub Actions when already configured at root. The CLI now checks for `.github/workflows/react-doctor.yml` at the repository root instead of unconditionally showing the recommendation for all multi-project scans or checking individual project directories.
