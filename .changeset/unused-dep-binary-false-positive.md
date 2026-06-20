---
"deslop-js": patch
---

Stop flagging an installed dependency as "unused" when it ships a CLI binary. A package that declares a `bin` is routinely invoked outside what a static scan can see — Makefiles, CI steps, git hooks, ad-hoc `npx` — so the unused-dependency check previously only kept such packages when a `package.json` script named the binary, and false-positively flagged them otherwise. The bin scan (which already reads every declared package's installed `package.json`) now records which packages provide a binary and treats providing one as sufficient evidence of use, independent of any script reference. Empty `bin` fields (`""` / `{}`) don't count.
