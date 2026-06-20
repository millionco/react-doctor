// A TypeScript declaration file (`.d.ts` / `.d.mts` / `.d.cts`) is pure
// ambient type space — erased at compile time with no runtime execution — so
// runtime value rules (TDZ, dead code, …) never apply. The ESM/CJS variants
// are handled too so they don't slip through.
export const isDeclarationFile = (filename: string | undefined): boolean => {
  if (!filename) return false;
  return filename.endsWith(".d.ts") || filename.endsWith(".d.mts") || filename.endsWith(".d.cts");
};
