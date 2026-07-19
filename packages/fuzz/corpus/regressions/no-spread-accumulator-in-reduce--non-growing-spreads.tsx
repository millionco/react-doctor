// rule: no-spread-accumulator-in-reduce
// weakness: semantic
// source: PR #1344 deep audit
export const preserveItems = (items: string[]) =>
  items.reduce((accumulator) => [...accumulator, ...[]], [] as string[]);

export const preserveMetadata = (items: string[]) =>
  items.reduce((accumulator) => ({ ...accumulator, ...{} }), {} as Record<string, string>);
