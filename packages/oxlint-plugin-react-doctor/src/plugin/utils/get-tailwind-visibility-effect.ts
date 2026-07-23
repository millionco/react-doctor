import { normalizeTailwindArbitraryUtilityValue } from "./normalize-tailwind-arbitrary-utility-value.js";

export interface TailwindVisibilityEffect {
  isVisible: boolean;
  propertyName: "display" | "visibility";
}

export interface TailwindVisibilityEffectResolution {
  isVisible: boolean | null;
  propertyName: TailwindVisibilityEffect["propertyName"] | null;
  status: "known" | "not-relevant" | "unknown";
}

const DISPLAY_VISIBILITY_EFFECTS = new Map<string, TailwindVisibilityEffect>([
  ["hidden", { isVisible: false, propertyName: "display" }],
  ["block", { isVisible: true, propertyName: "display" }],
  ["contents", { isVisible: true, propertyName: "display" }],
  ["flex", { isVisible: true, propertyName: "display" }],
  ["flow-root", { isVisible: true, propertyName: "display" }],
  ["grid", { isVisible: true, propertyName: "display" }],
  ["inline", { isVisible: true, propertyName: "display" }],
  ["inline-block", { isVisible: true, propertyName: "display" }],
  ["inline-flex", { isVisible: true, propertyName: "display" }],
  ["inline-grid", { isVisible: true, propertyName: "display" }],
  ["inline-table", { isVisible: true, propertyName: "display" }],
  ["list-item", { isVisible: true, propertyName: "display" }],
  ["table", { isVisible: true, propertyName: "display" }],
  ["table-caption", { isVisible: true, propertyName: "display" }],
  ["table-cell", { isVisible: true, propertyName: "display" }],
  ["table-column", { isVisible: true, propertyName: "display" }],
  ["table-column-group", { isVisible: true, propertyName: "display" }],
  ["table-footer-group", { isVisible: true, propertyName: "display" }],
  ["table-header-group", { isVisible: true, propertyName: "display" }],
  ["table-row", { isVisible: true, propertyName: "display" }],
  ["table-row-group", { isVisible: true, propertyName: "display" }],
]);
const VISIBILITY_VISIBILITY_EFFECTS = new Map<string, TailwindVisibilityEffect>([
  ["collapse", { isVisible: false, propertyName: "visibility" }],
  ["invisible", { isVisible: false, propertyName: "visibility" }],
  ["visible", { isVisible: true, propertyName: "visibility" }],
]);
const VISIBLE_ARBITRARY_DISPLAY_VALUES = new Set([
  "block",
  "contents",
  "flex",
  "flow-root",
  "grid",
  "inline",
  "inline block",
  "inline flex",
  "inline flow-root",
  "inline grid",
  "inline table",
  "list-item",
  "table",
  "table-caption",
  "table-cell",
  "table-column",
  "table-column-group",
  "table-footer-group",
  "table-header-group",
  "table-row",
  "table-row-group",
]);

const getArbitraryCssPropertyValue = (utility: string, propertyName: string): string | null => {
  const propertyPrefix = `[${propertyName}:`;
  return utility.toLowerCase().startsWith(propertyPrefix) && utility.endsWith("]")
    ? utility.slice(propertyPrefix.length, -1)
    : null;
};

export const getTailwindVisibilityEffect = (
  utility: string,
): TailwindVisibilityEffectResolution => {
  const knownEffect =
    DISPLAY_VISIBILITY_EFFECTS.get(utility) ?? VISIBILITY_VISIBILITY_EFFECTS.get(utility);
  if (knownEffect) return { ...knownEffect, status: "known" };

  const arbitraryDisplayValue = getArbitraryCssPropertyValue(utility, "display");
  if (arbitraryDisplayValue !== null) {
    const displayValue = normalizeTailwindArbitraryUtilityValue(arbitraryDisplayValue)
      .trim()
      .toLowerCase();
    if (displayValue === "none") {
      return { isVisible: false, propertyName: "display", status: "known" };
    }
    return VISIBLE_ARBITRARY_DISPLAY_VALUES.has(displayValue)
      ? { isVisible: true, propertyName: "display", status: "known" }
      : { isVisible: null, propertyName: "display", status: "unknown" };
  }

  const arbitraryVisibilityValue = getArbitraryCssPropertyValue(utility, "visibility");
  if (arbitraryVisibilityValue === null) {
    return { isVisible: null, propertyName: null, status: "not-relevant" };
  }
  const visibilityValue = normalizeTailwindArbitraryUtilityValue(arbitraryVisibilityValue)
    .trim()
    .toLowerCase();
  if (visibilityValue === "visible") {
    return { isVisible: true, propertyName: "visibility", status: "known" };
  }
  return visibilityValue === "hidden" || visibilityValue === "collapse"
    ? { isVisible: false, propertyName: "visibility", status: "known" }
    : { isVisible: null, propertyName: "visibility", status: "unknown" };
};
