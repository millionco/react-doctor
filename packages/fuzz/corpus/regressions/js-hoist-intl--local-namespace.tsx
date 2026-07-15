// rule: js-hoist-intl
// weakness: name-heuristic
// source: ISSUES_TO_FIX_ASAP.md
class LocalNumberFormat {
  constructor(public readonly token: string) {}
}

const Intl = { NumberFormat: LocalNumberFormat };

export const buildLocalFormatters = (tokens: string[]): LocalNumberFormat[] =>
  tokens.map((token) => new Intl.NumberFormat(token));
