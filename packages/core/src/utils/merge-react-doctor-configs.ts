import type { ReactDoctorConfig } from "../types/config.js";

type ReactDoctorIgnore = NonNullable<ReactDoctorConfig["ignore"]>;

const unionValues = (baseValues: string[], overrideValues: string[]): string[] => [
  ...new Set([...baseValues, ...overrideValues]),
];

// `{ ...base, ...override }` already resolves every key only one side
// defines; the merge helpers below only fix up keys BOTH sides define,
// where layering must be additive instead of override-wins.
const mergeIgnores = (
  baseIgnore: ReactDoctorIgnore,
  overrideIgnore: ReactDoctorIgnore,
): ReactDoctorIgnore => {
  const mergedIgnore: ReactDoctorIgnore = { ...baseIgnore, ...overrideIgnore };
  if (baseIgnore.rules && overrideIgnore.rules) {
    mergedIgnore.rules = unionValues(baseIgnore.rules, overrideIgnore.rules);
  }
  if (baseIgnore.files && overrideIgnore.files) {
    mergedIgnore.files = unionValues(baseIgnore.files, overrideIgnore.files);
  }
  if (baseIgnore.tags && overrideIgnore.tags) {
    mergedIgnore.tags = unionValues(baseIgnore.tags, overrideIgnore.tags);
  }
  if (baseIgnore.overrides && overrideIgnore.overrides) {
    mergedIgnore.overrides = [...baseIgnore.overrides, ...overrideIgnore.overrides];
  }
  return mergedIgnore;
};

/**
 * Layer one `ReactDoctorConfig` on top of another, additively: `rules` /
 * `categories` / `supplyChain` merge per key, `ignore` lists union
 * (`ignore.overrides` concatenate), and every other field is a scalar the
 * override simply wins on when set. Returns the base unchanged when there
 * is no override, and vice versa — so callers can thread `null` /
 * `undefined` through without special-casing.
 */
export const mergeReactDoctorConfigs = (
  baseConfig: ReactDoctorConfig | null,
  overrideConfig: ReactDoctorConfig | undefined,
): ReactDoctorConfig | null => {
  if (overrideConfig === undefined) return baseConfig;
  if (baseConfig === null) return overrideConfig;

  const mergedConfig: ReactDoctorConfig = { ...baseConfig, ...overrideConfig };
  if (baseConfig.rules && overrideConfig.rules) {
    mergedConfig.rules = { ...baseConfig.rules, ...overrideConfig.rules };
  }
  if (baseConfig.categories && overrideConfig.categories) {
    mergedConfig.categories = { ...baseConfig.categories, ...overrideConfig.categories };
  }
  if (baseConfig.supplyChain && overrideConfig.supplyChain) {
    mergedConfig.supplyChain = { ...baseConfig.supplyChain, ...overrideConfig.supplyChain };
  }
  if (baseConfig.ignore && overrideConfig.ignore) {
    mergedConfig.ignore = mergeIgnores(baseConfig.ignore, overrideConfig.ignore);
  }
  return mergedConfig;
};
