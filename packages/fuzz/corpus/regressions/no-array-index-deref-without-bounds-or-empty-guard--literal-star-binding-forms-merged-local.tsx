// rule: no-array-index-deref-without-bounds-or-empty-guard
// verdict: pass
// weakness: provider-erasure
// source: independently synthetic binding namespace control
const RegExp = { note: 0 };
interface RegExp {}
RegExp.note = 1;
export const readPrefix = (input: string) => /^x*/.exec(input)![0].length;
