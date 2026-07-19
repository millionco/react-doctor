// rule: no-predicate-function-reference-in-boolean-position
// weakness: alias-guard
// source: adversarial audit of guard/optional-access rules
const hasValue = Boolean;
export const run = (): void => {
  if (hasValue) consume();
};
