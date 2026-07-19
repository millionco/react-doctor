// rule: no-non-null-assertion-on-maybe-undefined-result
// weakness: regex-semantics
// source: PR review of millionco/react-doctor#1000

export const matchLetters = (value: string) => value.match(/^[a-z]*$/)![0];

export const matchStickySuffix = (value: string) => value.match(/\s*$/y)![0];
