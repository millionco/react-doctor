---
"react-doctor": patch
---

CLI footgun fixes:

- **`--blocking warning` now wins over `--no-warnings`.** Previously `--no-warnings --blocking warning` silently no-op'd the gate (you can't block on warnings you've hidden); the warning gate now forces warnings on so it actually fires.
- **Hid the deprecated `--fail-on` flag from `--help`.** It still works (mapped to `--blocking`, with a deprecation warning) but is off the visible surface; use `--blocking <level>`.
