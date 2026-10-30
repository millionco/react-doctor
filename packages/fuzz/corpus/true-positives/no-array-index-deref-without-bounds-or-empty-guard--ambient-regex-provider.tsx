// rule: no-array-index-deref-without-bounds-or-empty-guard
// weakness: shadowed-binding
// source: independent synthetic review control
// verdict: fail

declare const RegExp: any;

RegExp.prototype.exec = () => null;

export const ReadMatch = (input: string) => /^a*/.exec(input)![0].length;
