// rule: no-nullish-coalescing-arithmetic-precedence
// weakness: wrapper-transparency
// source: adversarial audit of guard/optional-access rules
export const scale = (value?: number, divisor = 2): number => value ?? (0 as number) / divisor;
export const offset = (value?: bigint, amount = 1n): bigint => value ?? 0n + amount;
