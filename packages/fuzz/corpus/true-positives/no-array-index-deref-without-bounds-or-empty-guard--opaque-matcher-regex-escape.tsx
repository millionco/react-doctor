// rule: no-array-index-deref-without-bounds-or-empty-guard
// weakness: custom-receiver
// source: independent synthetic review control
// verdict: fail

import matcher from "matcher-tools";

matcher.match(/x/);

export const ReadMatch = (input: string) => input.match(/^a*/)![0].length;
