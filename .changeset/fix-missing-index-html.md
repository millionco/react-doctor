---
"@react-doctor/core": patch
---

Fix lint failure on TanStack Start projects without index.html. Added existence check before reading HTML/Astro files to prevent ENOENT errors when index.html is referenced but doesn't exist.
