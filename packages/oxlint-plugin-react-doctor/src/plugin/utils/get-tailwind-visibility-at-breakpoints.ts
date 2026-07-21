import { getTailwindArbitraryUtilityValue } from "./get-tailwind-arbitrary-utility-value.js";
import { normalizeTailwindArbitraryUtilityValue } from "./normalize-tailwind-arbitrary-utility-value.js";
import { parseTailwindClassNameToken } from "./parse-tailwind-class-name-token.js";
import type { TailwindClassNameToken } from "./parse-tailwind-class-name-token.js";
import { splitTailwindClassName } from "./split-tailwind-class-name.js";

interface TailwindVisibilityEffect {
  isVisible: boolean;
  propertyName: "display" | "visibility";
}

interface TailwindResponsiveVariantScope {
  maximumBreakpointIndex: number;
  minimumBreakpointIndex: number;
  specificity: number;
}

interface TailwindScopedVisibilityEffect {
  effect: TailwindVisibilityEffect;
  scope: TailwindResponsiveVariantScope;
  token: TailwindClassNameToken;
}

const TAILWIND_BREAKPOINT_NAMES = ["", "sm", "md", "lg", "xl", "2xl"];
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

const getVisibilityEffect = (utility: string): TailwindVisibilityEffect | null => {
  const knownEffect =
    DISPLAY_VISIBILITY_EFFECTS.get(utility) ?? VISIBILITY_VISIBILITY_EFFECTS.get(utility);
  if (knownEffect) return knownEffect;

  const arbitraryDisplayValue = getTailwindArbitraryUtilityValue(utility, "[display:");
  if (arbitraryDisplayValue !== null) {
    const displayValue = normalizeTailwindArbitraryUtilityValue(arbitraryDisplayValue)
      .trim()
      .toLowerCase();
    if (displayValue === "none") return { isVisible: false, propertyName: "display" };
    return VISIBLE_ARBITRARY_DISPLAY_VALUES.has(displayValue)
      ? { isVisible: true, propertyName: "display" }
      : null;
  }

  const arbitraryVisibilityValue = getTailwindArbitraryUtilityValue(utility, "[visibility:");
  if (arbitraryVisibilityValue === null) return null;
  const visibilityValue = normalizeTailwindArbitraryUtilityValue(arbitraryVisibilityValue)
    .trim()
    .toLowerCase();
  if (visibilityValue === "visible") return { isVisible: true, propertyName: "visibility" };
  return visibilityValue === "hidden" || visibilityValue === "collapse"
    ? { isVisible: false, propertyName: "visibility" }
    : null;
};

const getResponsiveVariantScope = (
  variants: ReadonlyArray<string>,
): TailwindResponsiveVariantScope | null | undefined => {
  let minimumBreakpointIndex = 0;
  let maximumBreakpointIndex = TAILWIND_BREAKPOINT_NAMES.length;
  for (const variant of variants) {
    const minimumVariantIndex = TAILWIND_BREAKPOINT_NAMES.indexOf(variant);
    if (minimumVariantIndex > 0) {
      minimumBreakpointIndex = Math.max(minimumBreakpointIndex, minimumVariantIndex);
      continue;
    }
    if (variant.startsWith("max-")) {
      const maximumVariantIndex = TAILWIND_BREAKPOINT_NAMES.indexOf(variant.slice("max-".length));
      if (maximumVariantIndex > 0) {
        maximumBreakpointIndex = Math.min(maximumBreakpointIndex, maximumVariantIndex);
        continue;
      }
    }
    if (variant.startsWith("min-[") || variant.startsWith("max-[")) return null;
    return undefined;
  }
  return {
    maximumBreakpointIndex,
    minimumBreakpointIndex,
    specificity: variants.length,
  };
};

const resolveVisibilityProperty = (
  scopedEffects: ReadonlyArray<TailwindScopedVisibilityEffect>,
  breakpointIndex: number,
  propertyName: TailwindVisibilityEffect["propertyName"],
): boolean | null => {
  const applicableEffects = scopedEffects.filter(
    ({ effect, scope }) =>
      effect.propertyName === propertyName &&
      breakpointIndex >= scope.minimumBreakpointIndex &&
      breakpointIndex < scope.maximumBreakpointIndex,
  );
  if (applicableEffects.length === 0) return true;
  const hasImportantEffect = applicableEffects.some(({ token }) => token.isImportant);
  const highestImportanceEffects = hasImportantEffect
    ? applicableEffects.filter(({ token }) => token.isImportant)
    : applicableEffects;
  const maximumSpecificity = Math.max(
    ...highestImportanceEffects.map(({ scope }) => scope.specificity),
  );
  const highestSpecificityEffects = highestImportanceEffects.filter(
    ({ scope }) => scope.specificity === maximumSpecificity,
  );
  const maximumMinimumBreakpoint = Math.max(
    ...highestSpecificityEffects.map(({ scope }) => scope.minimumBreakpointIndex),
  );
  const latestMinimumEffects = highestSpecificityEffects.filter(
    ({ scope }) => scope.minimumBreakpointIndex === maximumMinimumBreakpoint,
  );
  const minimumMaximumBreakpoint = Math.min(
    ...latestMinimumEffects.map(({ scope }) => scope.maximumBreakpointIndex),
  );
  const highestPriorityStates = new Set(
    latestMinimumEffects
      .filter(({ scope }) => scope.maximumBreakpointIndex === minimumMaximumBreakpoint)
      .map(({ effect }) => effect.isVisible),
  );
  return highestPriorityStates.size === 1
    ? (highestPriorityStates.values().next().value ?? null)
    : null;
};

export const getTailwindVisibilityAtBreakpoints = (
  className: string,
): ReadonlyArray<boolean> | null => {
  const scopedEffects: TailwindScopedVisibilityEffect[] = [];
  for (const token of splitTailwindClassName(className).map(parseTailwindClassNameToken)) {
    const effect = getVisibilityEffect(token.utility);
    if (!effect) continue;
    const scope = getResponsiveVariantScope(token.variants);
    if (scope === null) return null;
    if (scope) scopedEffects.push({ effect, scope, token });
  }

  const visibilityAtBreakpoints: boolean[] = [];
  for (
    let breakpointIndex = 0;
    breakpointIndex < TAILWIND_BREAKPOINT_NAMES.length;
    breakpointIndex += 1
  ) {
    const displayVisibility = resolveVisibilityProperty(scopedEffects, breakpointIndex, "display");
    const visibilityVisibility = resolveVisibilityProperty(
      scopedEffects,
      breakpointIndex,
      "visibility",
    );
    if (displayVisibility === null || visibilityVisibility === null) return null;
    visibilityAtBreakpoints.push(displayVisibility && visibilityVisibility);
  }
  return visibilityAtBreakpoints;
};
