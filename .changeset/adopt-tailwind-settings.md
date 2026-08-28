---
"@react-doctor/core": patch
"react-doctor": patch
---

Adopt settings from existing `.oxlintrc.json` and `.eslintrc.json` configs. React Doctor now reads and merges plugin settings like `tailwindcss.entryPoint` from adopted lint configs alongside its own `react-doctor` settings, preserving third-party plugin configurations when `adoptExistingLintConfig: true`.
