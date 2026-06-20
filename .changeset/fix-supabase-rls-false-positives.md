---
"oxlint-plugin-react-doctor": patch
"@react-doctor/core": patch
---

fix: reduce false positives in supabase-rls-policy-risk

Addresses three false-positive classes in the `supabase-rls-policy-risk` rule:

1. **IF EXISTS guards**: `ALTER TABLE IF EXISTS ... DISABLE ROW LEVEL SECURITY` on dropped tables is now recognized as a no-op cleanup and not flagged.

2. **Role-scoped policies**: Policies scoped `TO service_role`, `TO authenticated`, or other specific roles are now recognized as access restrictions (hardening) rather than bypasses. These policies limit who can use them and are not publicly accessible.

3. **Policy body checks**: The rule continues to correctly flag `auth.role() = 'service_role'` checks within policy bodies, which are true bypasses since they test the runtime role rather than restricting policy applicability.

Fixes #910
