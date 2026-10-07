export const clampNumber = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));
