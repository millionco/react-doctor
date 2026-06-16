---
"oxlint-plugin-react-doctor": patch
---

Fix `artifact-baas-authority-surface` false positive on Sanity studio bundles (#840).

The rule treated a bare `createClient(...)` near any Firebase/Supabase config key as BaaS config, so a minified `@sanity/client` / `next-sanity` chunk — which calls `createClient({ projectId, dataset })` and ships prose like "ask the studio administrator" and `roles` — was wrongly flagged as a leaked Firebase/Supabase authority map. `createClient` now only counts as BaaS config when paired with a Supabase-specific token (`supabase`, `SUPABASE_URL`), not a shared key like `projectId`. Genuine Firebase configs and Supabase clients that expose authority fields keep firing.
