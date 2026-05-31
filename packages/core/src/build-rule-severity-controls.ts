import type { ReactDoctorConfig, RuleSeverityControls } from "./types/index.js";

/**
 * Assembles the internal `RuleSeverityControls` shape from a user
 * config's top-level `rules` and `categories` fields — the
 * ESLint / oxlint-shaped severity surface.
 *
 * Returns `undefined` when neither field is present so the common
 * path (no severity config at all) stays allocation-free for
 * downstream consumers.
 */
export const buildRuleSeverityControls = (
  config: ReactDoctorConfig | null | undefined,
): RuleSeverityControls | undefined => {
  if (!config) return undefined;
  if (
    config.rules === undefined &&
    config.categories === undefined &&
    config.buckets === undefined
  ) {
    return undefined;
  }
  return {
    ...(config.rules !== undefined ? { rules: config.rules } : {}),
    ...(config.categories !== undefined ? { categories: config.categories } : {}),
    ...(config.buckets !== undefined ? { buckets: config.buckets } : {}),
  };
};
