// rule: js-hoist-regexp
// weakness: control-flow
// source: ISSUES_TO_FIX_ASAP.md
export const matchEveryOccurrence = (words: string[]): boolean[] => {
  const matches: boolean[] = [];
  for (const word of words) {
    matches.push(new RegExp("a", "g").test(word));
  }
  return matches;
};
