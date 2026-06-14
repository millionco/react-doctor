---
"oxlint-plugin-react-doctor": patch
"@react-doctor/core": patch
"react-doctor": patch
---

Add a `supabase-table-missing-rls` security-scan rule. It flags a Supabase migration (`supabase/migrations/**`, `supabase/schemas/**`) that runs `create table` for a public-schema table but never enables Row Level Security — the highest-impact and most common Supabase misconfiguration, because RLS is OFF by default for SQL-created tables, so every row is readable and writable with the public anon key. This is Supabase's own `rls_disabled_in_public` lint, and the gap that turns the public anon key into the service key.

The existing `supabase-rls-policy-risk` only caught an explicit `disable row level security`; this complements it by catching the far more common "never enabled it" case. It stays quiet when the migration enables RLS or declares a policy (those are owned by `supabase-rls-policy-risk`), skips non-public/Supabase-managed schemas (`auth.`, `storage.`, a `private.` schema, …), and is scoped to the `supabase/` directory so plain Drizzle/Prisma `.sql` migrations are not flagged. Like the rest of the family it carries the `security-scan` tag and is silenced by `react-doctor rules ignore-tag security-scan`.
