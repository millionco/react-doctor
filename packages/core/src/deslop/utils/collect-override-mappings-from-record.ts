import { extractOverrideTargetPackage } from "./extract-override-target.js";

interface OverrideMapping {
  fromPackage: string;
  toPackage: string;
}

const collectOverrideMappingsFromUnknown = (
  fromPackage: string,
  overrideValue: unknown,
  mappings: OverrideMapping[],
): void => {
  if (typeof overrideValue === "string") {
    const toPackage = extractOverrideTargetPackage(overrideValue);
    if (!toPackage) return;
    mappings.push({ fromPackage, toPackage });
    return;
  }

  if (!overrideValue || typeof overrideValue !== "object" || Array.isArray(overrideValue)) {
    return;
  }

  for (const [nestedFromPackage, nestedValue] of Object.entries(overrideValue)) {
    collectOverrideMappingsFromUnknown(nestedFromPackage, nestedValue, mappings);
  }
};

export const collectOverrideMappingsFromRecord = (
  overrideRecord: Record<string, unknown>,
): OverrideMapping[] => {
  const mappings: OverrideMapping[] = [];

  for (const [fromPackage, overrideValue] of Object.entries(overrideRecord)) {
    collectOverrideMappingsFromUnknown(fromPackage, overrideValue, mappings);
  }

  return mappings;
};
