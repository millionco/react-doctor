import { getClassNameTokens } from "./get-class-name-tokens.js";

const TAILWIND_BREAKPOINT_NAMES = ["", "sm", "md", "lg", "xl", "2xl"];
const HIDDEN_VISIBILITY_UTILITIES = new Set(["hidden", "invisible"]);
const VISIBLE_VISIBILITY_UTILITIES = new Set([
  "block",
  "contents",
  "flex",
  "flow-root",
  "grid",
  "inline",
  "inline-block",
  "inline-flex",
  "inline-grid",
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
  "visible",
]);

export const getTailwindVisibilityAtBreakpoints = (
  className: string,
): ReadonlyArray<boolean> | null => {
  const rawTokens = className.split(/\s+/).filter((token) => token.length > 0);
  const visibilityAtBreakpoints: boolean[] = [];
  let isVisible = true;

  for (const breakpointName of TAILWIND_BREAKPOINT_NAMES) {
    const matchingVisibility = new Set<boolean>();
    for (const rawToken of rawTokens) {
      const segments = rawToken.split(":");
      const variants = segments.slice(0, -1);
      if (breakpointName === "" && variants.length > 0) continue;
      if (breakpointName !== "" && (variants.length !== 1 || variants[0] !== breakpointName)) {
        continue;
      }
      const utility = getClassNameTokens(rawToken)[0];
      if (HIDDEN_VISIBILITY_UTILITIES.has(utility)) matchingVisibility.add(false);
      if (VISIBLE_VISIBILITY_UTILITIES.has(utility)) matchingVisibility.add(true);
    }
    if (matchingVisibility.size > 1) return null;
    const breakpointVisibility = matchingVisibility.values().next().value;
    if (breakpointVisibility !== undefined) isVisible = breakpointVisibility;
    visibilityAtBreakpoints.push(isVisible);
  }

  return visibilityAtBreakpoints;
};
