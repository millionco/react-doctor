// Per-rule divergences between our TypeScript port of the React-team
// `eslint-plugin-react-hooks` rules and the upstream test fixtures.
// Each entry lists the 0-based index into upstream's `valid:` /
// `invalid:` arrays plus the reason — usually because the upstream
// rule depends on capabilities our visitor-only plugin doesn't have
// (Flow `component` / `hook` syntax, full hermes-eslint scope chain,
// useEffectEvent semantics, deep ref-current write tracking).
//
// Adding a new entry should always include a one-line reason.

export interface UpstreamDivergence {
  validSkips?: ReadonlyArray<number>;
  invalidSkips?: ReadonlyArray<number>;
  reason: string;
}

export const RULES_OF_HOOKS_DIVERGENCES: UpstreamDivergence = {
  reason:
    "No known divergences. Flow `component` / `hook` syntax is normalized by the parity harness before running the rule.",
};

export const EXHAUSTIVE_DEPS_DIVERGENCES: UpstreamDivergence = {
  invalidSkips: [82, 187],
  reason:
    "Intentional: exact props members suppress a synthetic whole-props dependency, and useMemo accepts extra reactive invalidation tokens while useCallback remains strict.",
};
