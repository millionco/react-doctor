/**
 * Read a positive-millisecond timeout from an env var, falling back to
 * `defaultMs` when the var is unset, non-finite, or not strictly positive.
 */
export const readPositiveEnvMs = <DefaultValue extends number | null>(
  envVarName: string,
  defaultMs: DefaultValue,
): number | DefaultValue => {
  const rawValue = process.env[envVarName];
  if (rawValue === undefined) return defaultMs;
  const parsedValue = Number(rawValue);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) return defaultMs;
  return parsedValue;
};
