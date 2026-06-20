---
"deslop-js": minor
---

Add `scramble`, an AST-based code anonymizer that rewrites a snippet into a stable, still-re-parseable form: every identifier (including React APIs, component names, JSX tags, and DOM/a11y attributes) becomes a role-prefixed placeholder applied consistently so aliasing survives (`h`ook / `s`etter / `g`etter / `C`omponent / host `e`lement / `p`rop / `v`ar), and every string / numeric / template / regex literal is blinded. Returns the readable scrambled `source`, an FNV-1a `hash` of it (a naming-invariant dedup key), and the `nodeType` the optional minimal-node extraction settled on.
