---
"react-doctor": patch
---

Cleaner scan output and smarter file scoping:

- The post-scan summary now leads with a "Top errors you should fix" block — each error shows a plain-language explanation and an inline code frame, with the rule's human title prefixed by its category (e.g. `Security: Use of eval()`) instead of its id, so it's clear at a glance what kind of problem it is.
- Security rules now read as security findings: `dangerouslySetInnerHTML` (XSS) is categorized under Security, and security messages use explicit vulnerability language (code injection, XSS, reverse tabnabbing, CSRF, secret exposure).
- Every rule's messages were rewritten to be short, plain, and dash-free, and each rule now carries a short `title`.
- Generated bundler output (`*.iife.js`, `*.umd.js`, `*.global.js`, `*.min.js`) is now excluded from scans by default. As a result `project.sourceFileCount` (and the scanned-file totals) no longer count these generated bundles.
- Minified files that carry an ordinary extension (e.g. a one-line `public/inject.js` bundle) are now detected by content and skipped, so they no longer flood the report with noise. Any diagnostic that still lands on an overlong single line falls back to a `file:line` reference instead of rendering an unreadable code frame.
- Multi-project scans now report the number of UNIQUE files scanned, so nested workspace packages (a parent whose tree contains a child package) are no longer double-counted in the "Scanned N files" total.
