// rule: no-predicate-function-reference-in-boolean-position
// weakness: callback-arity
// source: adversarial audit of guard/optional-access rules
const isAllowed = (user: unknown): boolean => Boolean(user);
export const run = (): void => {
  if (isAllowed) grant();
};
