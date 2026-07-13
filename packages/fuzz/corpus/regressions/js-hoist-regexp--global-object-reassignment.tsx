// rule: js-hoist-regexp
// weakness: alias-guard
// source: PR #1189 adversarial review
const CustomRegExp = new Proxy(RegExp, {
  apply: () => /a/g,
  construct: () => /a/g,
});

globalThis.RegExp = CustomRegExp;

export const matchWithFreshState = (words: string[]): boolean[] => {
  const matches: boolean[] = [];
  for (const word of words) {
    matches.push(new RegExp("a", "i").test(word));
  }
  return matches;
};
