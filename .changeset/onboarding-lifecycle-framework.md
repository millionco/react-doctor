---
"react-doctor": patch
---

Rework the CLI's per-user state tracking into a small lifecycle framework. All onboarding, growth, and migration state now lives behind one store (`cli-state-store.ts`) and one set of primitives (`cli-lifecycle.ts`): **gates** (fire once per machine or per repo, with an outcome and a version), **migrations** (run a code/config update once per repo, tracked), and **invalidation** (bump a gate's/migration's version to re-fire). Onboarding, the CI pitch, the action-upgrade offer, the agent install hint, and the legacy `react-doctor.config.json` → `doctor.config.ts` migration are all expressed on it. The on-disk state file upgrades itself in place on first read, preserving every recorded answer — no user is re-prompted. No change to commands, flags, or output.
