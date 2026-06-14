// `supabase/migrations/**` and `supabase/schemas/**` are the directories the
// Supabase CLI applies to the database, so a `create table` there is an
// app-owned table that PostgREST exposes to the public anon key — unlike a
// Drizzle/Prisma `.sql` file for a backend that may not use RLS at all.
export const isSupabaseMigrationPath = (relativePath: string): boolean =>
  /(?:^|\/)supabase\/(?:migrations|schemas)\//.test(relativePath);
