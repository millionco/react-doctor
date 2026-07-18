---
"oxlint-plugin-react-doctor": patch
---

Skip `supabase-client-owned-authz-field` on files with `'use server'` directive. Server actions with top-level `'use server'` are framework-enforced server-only code, so the rule's client-side threat model does not apply.
