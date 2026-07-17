// rule: no-nullish-coalescing-arithmetic-precedence
// weakness: library-idiom
// source: adversarial audit of guard/optional-access rules
export const width = (value?: number): string | number => value ?? 0 + "px";
