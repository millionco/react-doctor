---
"react-doctor": patch
---

Update agent-install to 0.0.8 and remove shamefully-hoist from pnpm config

This improves dependency hygiene in two ways:

1. **Updated agent-install**: Bumped from 0.0.5 to 0.0.8 (latest) to stay current with upstream improvements in the skill installation library.

2. **Removed shamefully-hoist**: Removed `shamefully-hoist=true` from `.npmrc` to restore pnpm's phantom dependency protection. This strengthens supply-chain safety by ensuring packages cannot accidentally import dependencies they don't explicitly declare.

Both changes maintain backward compatibility—all builds, lint checks, and tests pass without modification.
