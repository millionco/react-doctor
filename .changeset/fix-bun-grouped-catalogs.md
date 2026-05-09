---
"react-doctor": patch
---

Resolve React version from Bun grouped catalogs (`workspaces.catalogs.<group>`). Previously, dependencies declared as `"react": "catalog:<group>"` against a Bun grouped catalog at `workspaces.catalogs` failed with "No React dependency found"; only the default `workspaces.catalog` was supported.
