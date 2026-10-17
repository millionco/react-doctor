// rule: no-non-null-assertion-on-maybe-undefined-result
// weakness: shadowed-binding
// source: independent synthetic review control
// verdict: fail

declare const RegExp: any;
RegExp.prototype.exec = () => null;

export const ReadMatch = (input: string) => input.match(/^a*/)![0].length;
