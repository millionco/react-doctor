import coreRuleRegistryData from "./core-rule-registry-data.json" with { type: "json" };
import { resolveClientSecretRecommendation } from "./utils/resolve-client-secret-recommendation.js";
import { resolveStaticExportRedirectRecommendation } from "./utils/resolve-static-export-redirect-recommendation.js";
import type { CoreRuleMetadata, CoreRuleRegistryEntry } from "./utils/core-rule-metadata.js";

interface CoreRuleMetadataData extends Omit<CoreRuleMetadata, "recommendationFor"> {
  readonly recommendationOverride?: "client-secret" | "static-export-redirect";
}

interface CoreRuleRegistryDataEntry extends Omit<CoreRuleRegistryEntry, "rule"> {
  readonly rule: CoreRuleMetadataData;
}

const resolveRecommendationFor = (
  recommendationOverride: CoreRuleMetadataData["recommendationOverride"],
): CoreRuleMetadata["recommendationFor"] => {
  if (recommendationOverride === "client-secret") return resolveClientSecretRecommendation;
  if (recommendationOverride === "static-export-redirect") {
    return resolveStaticExportRedirectRecommendation;
  }
  return undefined;
};

// HACK: TypeScript widens JSON string literals, while this generated file is
// checked against the source registry in tests and regenerated on every build.
const coreRuleRegistryDataEntries =
  coreRuleRegistryData as ReadonlyArray<CoreRuleRegistryDataEntry>;

export const CORE_REACT_DOCTOR_RULES: ReadonlyArray<CoreRuleRegistryEntry> =
  coreRuleRegistryDataEntries.map((entry) => {
    const { recommendationOverride, ...rule } = entry.rule;
    const recommendationFor = resolveRecommendationFor(recommendationOverride);
    return {
      ...entry,
      rule: {
        ...rule,
        ...(recommendationFor ? { recommendationFor } : {}),
      },
    };
  });

export const CORE_RULE_REGISTRY: Readonly<Record<string, CoreRuleMetadata>> = Object.fromEntries(
  CORE_REACT_DOCTOR_RULES.map((entry) => [entry.id, entry.rule]),
);
