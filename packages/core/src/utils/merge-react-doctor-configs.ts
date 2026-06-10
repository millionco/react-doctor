import type { ReactDoctorConfig } from "../types/config.js";

type ReactDoctorIgnore = NonNullable<ReactDoctorConfig["ignore"]>;

const mergeUniqueArrays = (
  baseValues: string[] | undefined,
  overrideValues: string[] | undefined,
): string[] | undefined => {
  if (baseValues === undefined) return overrideValues;
  if (overrideValues === undefined) return baseValues;
  return [...new Set([...baseValues, ...overrideValues])];
};

const mergeRecords = <Value>(
  baseRecord: Record<string, Value> | undefined,
  overrideRecord: Record<string, Value> | undefined,
): Record<string, Value> | undefined => {
  if (baseRecord === undefined) return overrideRecord;
  if (overrideRecord === undefined) return baseRecord;
  return { ...baseRecord, ...overrideRecord };
};

const mergeIgnoreConfigs = (
  baseIgnore: ReactDoctorIgnore | undefined,
  overrideIgnore: ReactDoctorIgnore | undefined,
): ReactDoctorIgnore | undefined => {
  if (baseIgnore === undefined) return overrideIgnore;
  if (overrideIgnore === undefined) return baseIgnore;

  const mergedIgnore: ReactDoctorIgnore = {};
  const rules = mergeUniqueArrays(baseIgnore.rules, overrideIgnore.rules);
  const files = mergeUniqueArrays(baseIgnore.files, overrideIgnore.files);
  const tags = mergeUniqueArrays(baseIgnore.tags, overrideIgnore.tags);
  if (rules !== undefined) mergedIgnore.rules = rules;
  if (files !== undefined) mergedIgnore.files = files;
  if (tags !== undefined) mergedIgnore.tags = tags;
  if (baseIgnore.overrides !== undefined || overrideIgnore.overrides !== undefined) {
    mergedIgnore.overrides = [...(baseIgnore.overrides ?? []), ...(overrideIgnore.overrides ?? [])];
  }
  return mergedIgnore;
};

/**
 * Layer one `ReactDoctorConfig` on top of another, additively:
 *
 * - `rules` / `categories` merge per key — the override restamps or
 *   disables individual rules without discarding the base map.
 * - `ignore.rules` / `ignore.files` / `ignore.tags` union (deduplicated);
 *   `ignore.overrides` concatenate.
 * - `supplyChain` merges per field.
 * - Every other field is a scalar (or positional value) where layering
 *   has no additive meaning, so the override simply wins when set.
 *
 * Returns the base unchanged when there is no override, and vice versa —
 * so callers can thread `null`/`undefined` through without special-casing.
 */
export const mergeReactDoctorConfigs = (
  baseConfig: ReactDoctorConfig | null,
  overrideConfig: ReactDoctorConfig | undefined,
): ReactDoctorConfig | null => {
  if (overrideConfig === undefined) return baseConfig;
  if (baseConfig === null) return overrideConfig;

  const mergedConfig: ReactDoctorConfig = { ...baseConfig, ...overrideConfig };

  const ignore = mergeIgnoreConfigs(baseConfig.ignore, overrideConfig.ignore);
  if (ignore !== undefined) mergedConfig.ignore = ignore;

  const rules = mergeRecords(baseConfig.rules, overrideConfig.rules);
  if (rules !== undefined) mergedConfig.rules = rules;

  const categories = mergeRecords(baseConfig.categories, overrideConfig.categories);
  if (categories !== undefined) mergedConfig.categories = categories;

  if (baseConfig.supplyChain !== undefined && overrideConfig.supplyChain !== undefined) {
    mergedConfig.supplyChain = { ...baseConfig.supplyChain, ...overrideConfig.supplyChain };
  }

  return mergedConfig;
};
