---
"oxlint-plugin-react-doctor": patch
"@react-doctor/deslop-js": patch
"@react-doctor/core": patch
"react-doctor": patch
---

Align 30+ rules with their documented behavior, fixing the false-positive clusters confirmed by a validation pass of 2,143 sampled diagnostics against the official rule prompts. Highlights: `jsx-key` now flags key-after-spread (the documented hazard) instead of the safe key-before-spread shape and exempts props rest parameters; `no-did-update-set-state` honors the prop-comparison guard exemption; `no-console` skips Node CLI scripts; `circular-dependency` skips type-only, lazy-import, and render-time-only cycles; `query-mutation-missing-invalidation` exempts read-only mutations; `insecure-crypto-risk` requires cryptographic context instead of matching identifier names; `no-unknown-property` allows valid hyphenated SVG attributes; `no-aria-hidden-on-focusable` verifies the element is actually focusable; `no-flush-sync` implements the documented DOM-measurement carve-out.
