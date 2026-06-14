import { isSupabaseMigrationPath } from "./is-supabase-migration-path.js";

export const isSqlPath = (relativePath: string): boolean =>
  relativePath.endsWith(".sql") || isSupabaseMigrationPath(relativePath);
