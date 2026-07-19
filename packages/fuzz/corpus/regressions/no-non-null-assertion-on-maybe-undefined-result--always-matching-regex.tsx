// rule: no-non-null-assertion-on-maybe-undefined-result
// weakness: control-flow
// source: React Bench audit of millionco/react-doctor#1000

export const lastLine = (value: string) => value.match(/[^\n]*$/)![0];
