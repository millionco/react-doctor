import { defineRule } from "../../utils/define-rule.js";
import type { ScanFinding } from "../../utils/file-scan.js";
import { escapeRegExp } from "./utils/escape-reg-exp.js";
import { getLocationAtIndex } from "./utils/get-location-at-index.js";
import { isSupabaseMigrationPath } from "./utils/is-supabase-migration-path.js";
import { sanitizeSqlForScan } from "./utils/sanitize-sql-for-scan.js";

// A `create table` for a public-schema table — the only schema PostgREST
// exposes to the anon key. Unqualified names default to `public`, so they
// count; internal/Supabase-managed schemas (`auth.`, `storage.`, a `private.`
// schema, …) are skipped via the negative lookahead. Requiring `(` or `as`
// after the name keeps `-- create table …` SQL comments and prose out of the
// match. Group 1 captures the table name for the per-table RLS check.
const CREATE_PUBLIC_TABLE_PATTERN =
  /create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(?!(?:auth|storage|realtime|vault|extensions|graphql|graphql_public|pgbouncer|net|supabase_functions|supabase_migrations|cron|pgsodium|pgmq|information_schema|pg_catalog|pg_temp|private|internal)\s*\.)(?:public\s*\.\s*)?["`]?([A-Za-z_][\w$]*)["`]?(?:\s*\(|\s+as\b)/gi;

// Only `alter table <name> enable row level security` makes a public table
// safe. A `create policy` alone does NOT — policies are inert until RLS is
// enabled — so RLS must be checked per table rather than file-wide (a sibling
// table enabling RLS must not vouch for this one). The enable keyword must
// follow the table name directly so a nearby unrelated `enable` cannot match.
const enableRlsForTablePattern = (tableName: string): RegExp =>
  new RegExp(
    `alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?(?:public\\s*\\.\\s*)?["\`]?${escapeRegExp(tableName)}["\`]?\\s+(?:force\\s+)?enable\\s+row\\s+level\\s+security`,
    "i",
  );

export const supabaseTableMissingRls = defineRule({
  id: "supabase-table-missing-rls",
  title: "Supabase table created without Row Level Security",
  severity: "error",
  recommendation:
    "Enable RLS in the same migration (`alter table <name> enable row level security;`) and add `auth.uid()`-scoped policies for select/insert/update/delete. A public table without RLS is fully readable and writable with the public anon key.",
  scan: (file) => {
    if (!isSupabaseMigrationPath(file.relativePath)) return [];
    // The scan runs per migration file (one `ScannedFile` at a time), so RLS
    // enabled in a *different* migration than the `create table` is not seen;
    // the supported (and Supabase-tooling-default) pattern is same-file enable.
    // Blank SQL comments and string literals first so a commented-out or
    // string-embedded `create table … (` is not scanned as live DDL (and a
    // commented/quoted `enable row level security` cannot falsely vouch for a
    // real table). Offsets are preserved so locations stay correct.
    const content = sanitizeSqlForScan(file.content);
    if (!/create\s+(?:unlogged\s+)?table/i.test(content)) return [];

    const findings: ScanFinding[] = [];
    CREATE_PUBLIC_TABLE_PATTERN.lastIndex = 0;
    for (
      let match = CREATE_PUBLIC_TABLE_PATTERN.exec(content);
      match !== null;
      match = CREATE_PUBLIC_TABLE_PATTERN.exec(content)
    ) {
      const tableName = match[1];
      if (tableName === undefined) continue;
      // The enable must come AFTER this `create table` — an `alter table if
      // exists <name> enable …` before it is a no-op on a not-yet-created
      // table, so only scan from the create position onward.
      if (enableRlsForTablePattern(tableName).test(content.slice(match.index))) continue;
      const location = getLocationAtIndex(content, match.index);
      findings.push({
        message:
          "Supabase migration creates a public table but never enables Row Level Security, leaving every row exposed to the anon key.",
        line: location.line,
        column: location.column,
      });
    }
    return findings;
  },
});
