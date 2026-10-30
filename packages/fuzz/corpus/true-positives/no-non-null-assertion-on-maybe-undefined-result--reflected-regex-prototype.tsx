// rule: no-non-null-assertion-on-maybe-undefined-result
// weakness: alias-guard
// source: independent synthetic review control
// verdict: fail

Object.getPrototypeOf(/x/).exec = () => null;

export const ReadMatch = (input: string) => input.match(/^a*/)![0].length;
