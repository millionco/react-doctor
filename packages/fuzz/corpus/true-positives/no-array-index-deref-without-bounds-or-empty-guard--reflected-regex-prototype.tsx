// rule: no-array-index-deref-without-bounds-or-empty-guard
// weakness: alias-guard
// source: independent synthetic review control
// verdict: fail

Object.getPrototypeOf(/x/).exec = () => null;

export const ReadMatch = (input: string) => /^a*/.exec(input)![0].length;
