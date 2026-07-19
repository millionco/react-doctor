// rule: no-object-or-array-coerced-to-string-in-template-literal
// weakness: other
// source: adversarial audit of PR parsing/string-safety group

export const label = "value=" + {};
