---
"oxlint-plugin-react-doctor": patch
---

Fix `artifact-baas-authority-surface` false positives on `next-sanity` / `@sanity/client` studio bundles (#840).

The rule's "BaaS client config present" gate paired the generic `createClient` token with Firebase's `projectId` field. But that pairing is the _Sanity_ client signature — `createClient({ projectId, dataset, apiVersion })` — not a Firebase or Supabase one, so every Sanity Studio browser chunk tripped the gate and then matched the second factor on a shipped `roles`/`administrator` string. `createClient` now only counts as a BaaS signal next to a Supabase marker (`supabase` / `SUPABASE_URL`); Firebase is still detected by its own verbs (`initializeApp`, `firebase`, `firestore`), so genuine Firebase/Supabase authority maps keep firing.
