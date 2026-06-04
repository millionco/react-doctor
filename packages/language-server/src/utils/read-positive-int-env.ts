/**
 * Reads a positive-integer override from an environment variable.
 * Returns `fallback` when the variable is unset or not a positive integer.
 */
export const readPositiveIntEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};
