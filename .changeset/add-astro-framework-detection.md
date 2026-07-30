---
"oxlint-plugin-react-doctor": patch
"@react-doctor/core": patch
"react-doctor": patch
---

feat: add Astro framework detection

Astro projects are now correctly detected as `framework: "astro"` instead of `"unknown"`. Astro is checked before Vite in the detection order since Astro projects typically depend on both `astro` and `vite` packages, and the more specific framework should take precedence.

This change also adds `.astro` file extension to the lintable source file pattern, though full rule support for Astro template syntax is not yet complete.
