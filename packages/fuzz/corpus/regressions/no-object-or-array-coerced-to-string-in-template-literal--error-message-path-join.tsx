// rule: no-object-or-array-coerced-to-string-in-template-literal
// weakness: library-idiom
// source: react-bench corpus audit 2026-07 (tRPC invalid-path: comma-joining short route segments into a dev-facing Error message is legible)
export function resolvePath(options: { path: string[] }) {
  const path = [...options.path];
  if (path.length !== 2) {
    throw new Error(`Invalid path ${path}`);
  }
  return path;
}
