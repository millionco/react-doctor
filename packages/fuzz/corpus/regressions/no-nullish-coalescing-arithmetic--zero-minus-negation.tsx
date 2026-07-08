// rule: no-nullish-coalescing-arithmetic-precedence
// weakness: paren-shape
// source: PR #1000 corpus sweep (cloudscape timezone math: `?? 0 - fn()` is intentional negation)
export const shiftTimezoneOffset = (isoDate: string, offsetInMinutes?: number): number =>
  offsetInMinutes ?? 0 - new Date(isoDate).getTimezoneOffset();
