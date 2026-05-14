// HACK: only the exact lowercase `"true"` / `"false"` literals are
// coerced to booleans — anything else stays as a (case-sensitive) branch
// name so that real branches like `True-Branch` / `FALSE-vN` aren't
// silently turned into a flag.
export const coerceDiffValue = (value: unknown): boolean | string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length === 0) return undefined;
    if (value === "false") return false;
    if (value === "true") return true;
    return value;
  }
  // HACK: write directly to stderr so the warning is visible even in
  // `--json` mode (where the logger is silenced to keep stdout a
  // single valid JSON document).
  process.stderr.write(
    `[react-doctor] invalid diff value (expected boolean or string): ${typeof value}. Falling back to no diff.\n`,
  );
  return undefined;
};
