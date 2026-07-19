// rule: no-nullish-coalescing-arithmetic-precedence
// weakness: operator-coverage
// source: adversarial audit of guard/optional-access rules
export const discounted = (total?: number): number => total ?? 0 - discount();
export const scaled = (value?: number, exponent = 2): number => value ?? 0 ** exponent;
