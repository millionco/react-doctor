import { TAILWIND_BREAKPOINT_NAMES } from "../constants/tailwind.js";
import { getTailwindVisibilityEffect } from "./get-tailwind-visibility-effect.js";
import type { TailwindVisibilityEffect } from "./get-tailwind-visibility-effect.js";
import { parseTailwindClassNameToken } from "./parse-tailwind-class-name-token.js";
import type { TailwindClassNameToken } from "./parse-tailwind-class-name-token.js";
import { splitTailwindClassName } from "./split-tailwind-class-name.js";

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
    return null;
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
    const resolution = getTailwindVisibilityEffect(token.utility);
    if (resolution.status === "not-relevant") continue;
    const scope = getResponsiveVariantScope(token.variants);
    if (scope === null) return null;
    if (!scope || scope.minimumBreakpointIndex >= scope.maximumBreakpointIndex) continue;
    if (
      resolution.status === "unknown" ||
      resolution.propertyName === null ||
      resolution.isVisible === null
    ) {
      return null;
    }
    const effect: TailwindVisibilityEffect = {
      isVisible: resolution.isVisible,
      propertyName: resolution.propertyName,
    };
    scopedEffects.push({ effect, scope, token });
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
