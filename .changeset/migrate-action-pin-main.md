---
"react-doctor": patch
---

Add a once-per-repo migration that pins a mutable `@main` / `@master` React Doctor GitHub Action reference in `.github/workflows/*.yml` to the recommended floating major (`@v2`).

An unpinned `@main` runs whatever the action's HEAD points to with the workflow's write permissions — a supply-chain risk (#299) — and the rewrite also moves the workflow onto the current install- and scan-cached action release. Pinned tags / commit SHAs are deliberate and left untouched, and a different action on `@main` (e.g. `actions/checkout@main`) is ignored. Runs once per repo like the legacy-config migration, rewrites only the ref (owner, comments, and the action's `version:` input are preserved), and logs the change for the user to review and commit (or revert if they intentionally track main).
