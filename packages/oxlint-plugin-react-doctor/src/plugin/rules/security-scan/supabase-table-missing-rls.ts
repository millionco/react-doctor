import { defineRule } from "../../utils/define-rule.js";
import { isSupabaseMigrationPath } from "./utils/is-supabase-migration-path.js";
import { scanByPattern } from "./utils/scan-by-pattern.js";

// A `create table` for a public-schema table — the only schema PostgREST
// exposes to the anon key. Unqualified names default to `public`, so they
// count; internal/Supabase-managed schemas (`auth.`, `storage.`, a `private.`
// schema, …) are skipped via the negative lookahead. Requiring `(` or `as`
// after the name keeps `-- create table …` SQL comments (never stripped for
// .sql) and prose out of the match. RLS is OFF by default for SQL-created
// tables, so a migration that creates one and never enables it leaves every
// row readable and writable with the public anon key — Supabase's own
// `rls_disabled_in_public` lint, and the bug shark byte used to walk into
// real YC startups.
const CREATE_PUBLIC_TABLE_PATTERN =
  /create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(?!(?:auth|storage|realtime|vault|extensions|graphql|graphql_public|pgbouncer|net|supabase_functions|supabase_migrations|cron|pgsodium|pgmq|information_schema|pg_catalog|pg_temp|private|internal)\s*\.)(?:public\s*\.\s*)?["`]?[A-Za-z_][\w$]*["`]?(?:\s*\(|\s+as\b)/i;

// Any mention of row level security — or a policy, which presumes RLS is on —
// means the author engaged with row security; an over-broad result is then
// owned by `supabase-rls-policy-risk`, so we step aside to avoid double-firing.
const ROW_LEVEL_SECURITY_HANDLED_PATTERN = /row\s+level\s+security|create\s+policy/i;

export const supabaseTableMissingRls = defineRule({
  id: "supabase-table-missing-rls",
  title: "Supabase table created without Row Level Security",
  severity: "error",
  recommendation:
    "Enable RLS in the same migration (`alter table <name> enable row level security;`) and add `auth.uid()`-scoped policies for select/insert/update/delete. A public table without RLS is fully readable and writable with the public anon key.",
  scan: scanByPattern({
    shouldScan: (file) => isSupabaseMigrationPath(file.relativePath),
    pattern: CREATE_PUBLIC_TABLE_PATTERN,
    suppressWhen: ROW_LEVEL_SECURITY_HANDLED_PATTERN,
    message:
      "Supabase migration creates a public table but never enables Row Level Security, leaving every row exposed to the anon key.",
  }),
});
