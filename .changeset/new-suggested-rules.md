---
"oxlint-plugin-react-doctor": minor
"eslint-plugin-react-doctor": minor
"@react-doctor/core": patch
---

feat(rules): add 59 new lint rules with package-version guarding, SSR gating, and corpus-hardened detectors

Adds 59 new AST-only rules (correctness, state-and-effects, performance, security, a11y, bundle-size, architecture, tanstack-query, nextjs, design, react-builtins) authored from curated production-incident rule specs. Each new rule was validated against a large real-world OSS corpus and hardened for false positives; 30 candidate rules were dropped before release after adversarially-verified triage: 19 with false-positive shares of 0.75-1.0 on mature OSS code (e.g. `no-double-cast-through-unknown`, `no-parseint-without-radix`), and 11 more that a post-hardening precision and value review judged still-noisy, premise-weak, or duplicative (e.g. `no-date-string-parsing`, `no-window-size-in-render`, `no-icon-barrel-named-import`).

Highlights:

- **Package-version guarding.** Project discovery now detects `mobxVersion`, `styledComponentsVersion`, and `tanstackQueryVersion` (version strings, not booleans), so library-specific rules only activate when the dependency is actually present.
- **SSR gating.** A new `ssr` capability (Next.js / Remix / Gatsby / TanStack Start) gates rules whose premise is server rendering (unguarded browser globals at module scope or render, impure module-scope calls), so they stay quiet in client-only SPAs.
- **FP hardening.** Detectors were narrowed against the corpus — e.g. array-index dereference now only fires on provably-numeric arithmetic indices, throwing-parse excludes always-valid URL sources, and test-heavy rules carry the `test-noise` tag so they skip test/spec/story files.
- **Shared-util consolidation.** Duplicated AST helpers were extracted into shared `utils/` (`is-inside-try-statement`, `subtree-references-identifier-name`, `is-object-of-member-access`, `walk-own-function-scope`).
