---
"react-doctor": patch
---

Fix two dead-code / fix-recipe papercuts surfaced on alias-heavy Next.js projects.

**Dead-code no longer mis-flags `@/…` (and other) imports as unused.** The dead-code pass resolves imports through `oxc-resolver`, which returns realpath'd (symlink-free) paths, but built its module graph from the scan root as-is. When the project root sat behind a symlink — e.g. a macOS iCloud-synced `~/Documents` / `~/Desktop`, or a symlinked checkout — the two path spaces diverged, every import edge dropped, and files reachable only through those imports (in an alias-heavy codebase, every `@/…` target) were reported as "unused / unreachable". The scan root is now canonicalized before analysis so the module graph and the resolver agree. This was never specific to `@/*` aliases; relative imports were affected the same way.

**Per-rule fix-recipe URLs are only shown when a recipe exists.** Findings advertised a "fetch the canonical fix recipe" URL (`/prompts/rules/<plugin>/<rule>.md`) for every diagnostic, but recipes are only published for react-doctor's own engine rules. Dead-code (`deslop/*`), the environment / supply-chain checks (`require-reduced-motion`, `require-pnpm-hardening`), and adopted third-party plugins (`eslint`, `unicorn`, `react-hooks-js`, …) have no recipe, so their links 404. The directive is now gated to engine rules, so agents are no longer sent to dead links.
