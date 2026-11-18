// rule: no-non-null-assertion-on-maybe-undefined-result
// weakness: literal-match-capture
// source: synthetic audit regression
export const label = "context-a-b".match(/^context-([\w-]+)$/)![1];
