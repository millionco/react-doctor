---
"oxlint-plugin-react-doctor": patch
"@react-doctor/core": patch
---

fix: reduce false positives in supabase-rls-policy-risk

Addresses two false-positive classes in the `supabase-rls-policy-risk` rule:

1. **IF EXISTS guards**: `ALTER TABLE IF EXISTS ... DISABLE ROW LEVEL SECURITY` on dropped tables is now recognized as a no-op cleanup and not flagged.

2. **Server-only role scoping**: A permissive `using/with check (true)` policy scoped to a server-only role (`service_role`, `postgres`, `supabase_admin`) is recognized as hardening rather than a public bypass, since those roles are never reachable from a browser client. `anon` and `authenticated` are intentionally _not_ treated as safe — both are client-reachable via a JWT, so `(true)` scoped to them still grants write-anything to untrusted callers and remains flagged.

The rule continues to flag `auth.role() = 'service_role'` checks inside policy bodies, which are true bypasses (they test the runtime role rather than restricting policy applicability). Cross-migration DROP/REPLACE tracking (the issue's third class) requires whole-migration-set analysis and is left as a follow-up.

Fixes #910
