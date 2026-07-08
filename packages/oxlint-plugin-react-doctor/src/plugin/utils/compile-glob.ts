/**
 * Compiles a simple glob pattern (only `*` as a wildcard) into an
 * anchored RegExp. Used by allow-list / deny-list rules
 * (`forbid-component-props`, `forbid-elements`, `jsx-handler-names`,
 * `label-has-associated-control`, `no-unstable-nested-components`)
 * for matching component names + prop names against user-supplied
 * patterns.
 *
 * NOT a full picomatch / minimatch — character classes, `?`,
 * `**`, brace expansion, etc. are not handled. The four rule-side
 * call sites only ever pass plain `*` globs (`onClick`, `on*`,
 * `*Handler`), so the cheap escape-then-replace shape is enough
 * and avoids pulling picomatch into the per-file rule path.
 */
// Unbounded by design: every call site passes user-config strings
// (settings/forbid entries), never file-derived data, so the distinct
// pattern set is tiny and fixed per scan. Flagless RegExps carry no
// lastIndex state, so sharing one instance across callers is safe.
const compiledGlobs = new Map<string, RegExp>();

export const compileGlob = (pattern: string): RegExp => {
  const cached = compiledGlobs.get(pattern);
  if (cached) return cached;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  const compiled = new RegExp(`^${escaped}$`);
  compiledGlobs.set(pattern, compiled);
  return compiled;
};
