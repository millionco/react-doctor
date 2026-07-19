// rule: no-collapsed-literal-or-chain-as-value
// weakness: wrapper-transparency
// source: adversarial audit of PR parsing/string-safety group

declare const text: string;

text.includes(("open" || "closed") as string);
