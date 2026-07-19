// rule: no-array-index-deref-without-bounds-or-empty-guard
// weakness: control-flow
// source: React Bench audit of millionco/react-doctor#1000

export const lastLinePrefixLength = (value: string) => value.match(/[^\n]*$/)![0].length;
