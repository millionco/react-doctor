import reactDoctorPlugin from "oxlint-plugin-react-doctor";
import type { Diagnostic } from "../types/index.js";
import { STRUCTURAL_FINDING_CATEGORIES } from "../constants.js";

/**
 * Whether a diagnostic's identity is the flagged element itself rather than
 * the flagged line's text. `computeDiagnosticDelta` matches structural
 * findings by `(file, rule)` occurrence count, so reformatting the flagged
 * line (reindentation, prettier reflow) doesn't turn a pre-existing finding
 * into a "new" one. Structural means: every `Accessibility`-category finding
 * (element-level by nature, including adopted third-party a11y rules mapped
 * into that category), plus any react-doctor rule that opts in via its
 * `structuralFinding` metadata flag (e.g. `iframe-missing-sandbox`, which
 * lives under `Security`).
 */
export const isStructuralFinding = (diagnostic: Diagnostic): boolean => {
  if (STRUCTURAL_FINDING_CATEGORIES.has(diagnostic.category)) return true;
  if (diagnostic.plugin !== "react-doctor") return false;
  return Object.hasOwn(reactDoctorPlugin.rules, diagnostic.rule)
    ? Boolean(reactDoctorPlugin.rules[diagnostic.rule]?.structuralFinding)
    : false;
};
