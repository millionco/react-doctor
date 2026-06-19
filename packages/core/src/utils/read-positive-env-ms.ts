/**
 * Read a positive-millisecond timeout from an env var, falling back to
 * `defaultMs` when the var is unset, non-finite, or not strictly positive.
 */
export const readPositiveEnvMs = (envVarName: string, defaultMs: number): number => {
  const rawValue = process.env[envVarName];
  if (rawValue === undefined) return defaultMs;
  const parsedValue = Number(rawValue);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) return defaultMs;
  return parsedValue;
};
