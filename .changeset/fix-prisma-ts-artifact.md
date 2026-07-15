---
"oxlint-plugin-react-doctor": patch
"@react-doctor/core": patch
---

fix: don't treat TypeScript source files as browser artifacts (#1318)

Fixes a false positive where `artifact-env-leak` fired on Prisma 7 generated TypeScript client files. TypeScript source files (`.ts`, `.tsx`) cannot be browser artifacts because browsers don't execute TypeScript — they must be compiled to JavaScript first. The minification heuristic was designed to catch large JavaScript bundles, not TypeScript source files with long lines (e.g., Prisma's inlined schema).

This change exempts TypeScript source files from being classified as browser artifacts, even if they look "minified" (have long lines). Generated TypeScript source code (like Prisma's client) is still source code, not a shipped artifact.
