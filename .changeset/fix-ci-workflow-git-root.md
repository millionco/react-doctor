---
"react-doctor": patch
"@react-doctor/core": patch
---

fix: install GitHub Actions workflow at repository root

GitHub Actions only checks `.github/workflows/` at the repository root. Previously, running `react-doctor ci install` or selecting "add workflow" from a subdirectory would install the workflow at the nearest `package.json` location, which GitHub ignores.

This fix ensures the workflow is always installed at the git repository root (`<git-root>/.github/workflows/react-doctor.yml`), even when the command is run from a subdirectory like `apps/website/` in a monorepo.

Closes #1849
