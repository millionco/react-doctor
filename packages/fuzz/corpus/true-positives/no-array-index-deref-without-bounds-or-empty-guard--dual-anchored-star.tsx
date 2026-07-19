// rule: no-array-index-deref-without-bounds-or-empty-guard
// weakness: regex-semantics
// source: PR review of millionco/react-doctor#1000

export const matchWhitespace = (value: string) => value.match(/^\s*$/)[0].length;

export const matchStickySuffix = (value: string) => value.match(/[^\n]*$/y)[0].length;
