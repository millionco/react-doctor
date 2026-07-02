---
"@react-doctor/core": patch
"react-doctor": patch
---

feat(core): package-version detection and SSR capability for library-gated rules

Project discovery now detects `mobxVersion`, `styledComponentsVersion`, and `tanstackQueryVersion` as version strings (replacing the boolean `hasTanStackQuery`), and a new `ssr` capability (Next.js / Remix / Gatsby / TanStack Start) lets rules whose premise is server rendering stay quiet in client-only SPAs. Adds shared AST utils (`is-inside-try-statement`, `subtree-references-identifier-name`, `is-object-of-member-access`, `walk-own-function-scope`, `strip-grouping-parens`) used by upcoming rule batches.
