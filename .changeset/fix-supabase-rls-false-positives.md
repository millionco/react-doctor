---
"oxlint-plugin-react-doctor": patch
---

fix: reduce false positives in supabase-rls-policy-risk

The rule now classifies each `CREATE POLICY` statement individually (over
comment/string-sanitized SQL) instead of matching the whole file with one
regex. A permissive `using/with check (true)` policy whose `TO` clause names
**only** server-only roles (`service_role`, `postgres`, `supabase_admin`) is
treated as hardening, not a public bypass — including two-clause `FOR ALL` /
`FOR UPDATE` forms and all-server-only role lists that the previous
negative-lookbehind missed. `anon` / `authenticated` (and a `TO` clause that
mixes one in, or no `TO` clause at all → `PUBLIC`) stay flagged, since those are
client-reachable via a JWT.

`auth.role() = 'service_role'` checks inside policy bodies are still flagged
(true runtime bypasses). The previous `IF EXISTS` suppression on `DISABLE ROW
LEVEL SECURITY` was removed: it silently downgraded a real risk on live tables,
and the dropped-table case it targeted needs cross-migration analysis — deferred
with the issue's cross-migration class.

Fixes #910
