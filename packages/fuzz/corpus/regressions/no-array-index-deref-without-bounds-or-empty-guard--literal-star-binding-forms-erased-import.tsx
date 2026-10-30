// rule: no-array-index-deref-without-bounds-or-empty-guard
// verdict: fail
// weakness: provider-erasure
// source: independently synthetic binding namespace control
import type RegExp = require("provider-types");
RegExp.prototype.exec = () => null;
export const readPrefix = (input: string) => /^x*/.exec(input)![0].length;
