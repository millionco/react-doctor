import fg from "fast-glob";

export const extractSupabaseFunctionEntries = (rootDirectory: string): string[] =>
  fg.sync("supabase/functions/*/index.{ts,tsx,js,jsx,mts,mjs,cts,cjs}", {
    cwd: rootDirectory,
    absolute: true,
    onlyFiles: true,
  });
