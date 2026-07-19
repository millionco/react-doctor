// rule: no-whole-object-dep-with-member-reads
// weakness: alias-guard
// source: PR #1000 deep precision review

const useMemo = <Value,>(callback: () => Value, _dependencies: unknown[]): Value => callback();

export const LocalMemoPanel = (props: { value: string }) => useMemo(() => props.value, [props]);
