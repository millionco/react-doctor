import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { supabaseTableMissingRls } from "./supabase-table-missing-rls.js";

const MIGRATION_PATH = "supabase/migrations/20240101000000_init.sql";

describe("security-scan/supabase-table-missing-rls — regressions", () => {
  it("flags a public table created without enabling RLS", () => {
    const findings = runScanRule(supabaseTableMissingRls, {
      relativePath: MIGRATION_PATH,
      content: `
        create table public.notes (
          id uuid primary key,
          body text
        );
      `,
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent when the same migration enables RLS after the create", () => {
    const findings = runScanRule(supabaseTableMissingRls, {
      relativePath: MIGRATION_PATH,
      content: `
        create table public.notes (id uuid primary key);
        alter table public.notes enable row level security;
      `,
    });
    expect(findings).toEqual([]);
  });

  it("does not let a sibling table's enable vouch for another table", () => {
    const findings = runScanRule(supabaseTableMissingRls, {
      relativePath: MIGRATION_PATH,
      content: `
        create table public.covered (id uuid primary key);
        alter table public.covered enable row level security;
        create table public.exposed (id uuid primary key);
      `,
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent when RLS is enabled dynamically for every table via a DO loop", () => {
    const findings = runScanRule(supabaseTableMissingRls, {
      relativePath: MIGRATION_PATH,
      content: `
        create table public.users (id uuid primary key);
        create table public.posts (id uuid primary key);
        create table public.comments (id uuid primary key);

        do $$
        declare tbl record;
        begin
          for tbl in select tablename from pg_tables where schemaname = 'public' loop
            execute format('alter table public.%I enable row level security', tbl.tablename);
          end loop;
        end $$;
      `,
    });
    expect(findings).toEqual([]);
  });

  it("recognizes the quoted schema form supabase db diff generates", () => {
    const findings = runScanRule(supabaseTableMissingRls, {
      relativePath: MIGRATION_PATH,
      content: `
        create table "public"."notes" (id uuid primary key);
        alter table "public"."notes" enable row level security;
      `,
    });
    expect(findings).toEqual([]);
  });

  it("accepts a quoted-schema enable for an unquoted create", () => {
    const findings = runScanRule(supabaseTableMissingRls, {
      relativePath: MIGRATION_PATH,
      content: `
        create table public.notes (id uuid primary key);
        alter table "public"."notes" enable row level security;
      `,
    });
    expect(findings).toEqual([]);
  });

  it("still flags a quoted-schema create with no enable anywhere", () => {
    const findings = runScanRule(supabaseTableMissingRls, {
      relativePath: MIGRATION_PATH,
      content: `
        create table "public"."notes" (id uuid primary key);
      `,
    });
    expect(findings).toHaveLength(1);
  });

  it("still skips quoted Supabase-managed schemas", () => {
    const findings = runScanRule(supabaseTableMissingRls, {
      relativePath: MIGRATION_PATH,
      content: `
        create table "auth"."audit_entries" (id uuid primary key);
      `,
    });
    expect(findings).toEqual([]);
  });

  it("does not treat a commented-out enable as a dynamic enable", () => {
    const findings = runScanRule(supabaseTableMissingRls, {
      relativePath: MIGRATION_PATH,
      content: `
        create table public.notes (id uuid primary key);
        -- alter table public.notes enable row level security;
      `,
    });
    expect(findings).toHaveLength(1);
  });

  it("ignores SQL files outside supabase migration directories", () => {
    const findings = runScanRule(supabaseTableMissingRls, {
      relativePath: "db/migrations/001_init.sql",
      content: `
        create table public.notes (id uuid primary key);
      `,
    });
    expect(findings).toEqual([]);
  });
});
