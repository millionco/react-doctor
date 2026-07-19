// rule: no-collapsed-literal-or-chain-as-value
// weakness: literal-shape
// source: adversarial audit of PR parsing/string-safety group

export const matchesStatus = (value: string): RegExpMatchArray | null =>
  value.match(/open/ || /closed/);
