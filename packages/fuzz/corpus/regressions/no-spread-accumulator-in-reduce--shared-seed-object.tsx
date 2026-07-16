// rule: no-spread-accumulator-in-reduce
// weakness: copy-tracking
// source: react-bench corpus audit 2026-07 (json-edit-react compiled styles: the fold is seeded with a shared outer object — mutating the accumulator would corrupt it)
interface StyleFn {
  (nodeData: object): Record<string, string> | undefined;
}

export const compileStyles = (fns: StyleFn[], base: { cell: Record<string, string> }) => {
  const sharedBase = base.cell;
  return (nodeData: object) =>
    fns.reduce((acc, fn) => ({ ...acc, ...(fn(nodeData) ?? {}) }), sharedBase);
};
