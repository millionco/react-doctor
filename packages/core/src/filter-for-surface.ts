import type {
  Diagnostic,
  DiagnosticSurface,
  ReactDoctorConfig,
  SurfaceControls,
} from "./types/index.js";
import { DEFAULT_SURFACE_EXCLUDED_TAGS } from "./diagnostic-surface.js";
import { getDiagnosticRuleIdentity } from "./get-diagnostic-rule-identity.js";

interface ResolvedSurfaceControls {
  includeTags: ReadonlySet<string>;
  excludeTags: ReadonlySet<string>;
  includeCategories: ReadonlySet<string>;
  excludeCategories: ReadonlySet<string>;
  includeRuleKeys: ReadonlySet<string>;
  excludeRuleKeys: ReadonlySet<string>;
}

const toStringSet = (values: ReadonlyArray<string> | undefined): ReadonlySet<string> => {
  if (!values || values.length === 0) return new Set<string>();
  return new Set(values.filter((value) => typeof value === "string" && value.length > 0));
};

const buildResolvedControls = (
  surface: DiagnosticSurface,
  userControls: SurfaceControls | undefined,
): ResolvedSurfaceControls => {
  const excludeTags = new Set<string>(DEFAULT_SURFACE_EXCLUDED_TAGS[surface]);
  const includeTags = toStringSet(userControls?.includeTags);
  for (const tag of includeTags) excludeTags.delete(tag);
  for (const tag of toStringSet(userControls?.excludeTags)) excludeTags.add(tag);

  return {
    includeTags,
    excludeTags,
    includeCategories: toStringSet(userControls?.includeCategories),
    excludeCategories: toStringSet(userControls?.excludeCategories),
    includeRuleKeys: toStringSet(userControls?.includeRules),
    excludeRuleKeys: toStringSet(userControls?.excludeRules),
  };
};

const intersects = (values: ReadonlyArray<string>, candidates: ReadonlySet<string>): boolean =>
  values.some((value) => candidates.has(value));

export const isDiagnosticOnSurface = (
  diagnostic: Diagnostic,
  surface: DiagnosticSurface,
  config: ReactDoctorConfig | null,
): boolean => {
  const resolved = buildResolvedControls(surface, config?.surfaces?.[surface]);
  const { ruleKey, category, tags } = getDiagnosticRuleIdentity(diagnostic);

  // Include wins over exclude — checked first so a single rule can be
  // promoted back into a surface even when its tag / category is hidden.
  if (resolved.includeRuleKeys.has(ruleKey)) return true;
  if (resolved.includeCategories.has(category)) return true;
  if (intersects(tags, resolved.includeTags)) return true;

  if (resolved.excludeRuleKeys.has(ruleKey)) return false;
  if (resolved.excludeCategories.has(category)) return false;
  if (intersects(tags, resolved.excludeTags)) return false;

  return true;
};

export const filterDiagnosticsForSurface = (
  diagnostics: Diagnostic[],
  surface: DiagnosticSurface,
  config: ReactDoctorConfig | null,
): Diagnostic[] =>
  diagnostics.filter((diagnostic) => isDiagnosticOnSurface(diagnostic, surface, config));
