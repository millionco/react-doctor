import type {
  Diagnostic,
  DiagnosticSurface,
  ReactDoctorConfig,
  SurfaceControls,
} from "./types/index.js";
import { DEFAULT_SURFACE_EXCLUDED_TAGS } from "./diagnostic-surface.js";
import { getDiagnosticRuleIdentity } from "./get-diagnostic-rule-identity.js";
import { isSameRuleKey } from "./rule-key-aliases.js";

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

const containsRuleKey = (ruleKeys: ReadonlySet<string>, ruleKey: string): boolean =>
  [...ruleKeys].some((candidateRuleKey) => isSameRuleKey(candidateRuleKey, ruleKey));

const isDiagnosticOnResolvedSurface = (
  diagnostic: Diagnostic,
  resolved: ResolvedSurfaceControls,
): boolean => {
  const { ruleKey, category, tags } = getDiagnosticRuleIdentity(diagnostic);

  // Include wins over exclude — checked first so a single rule can be
  // promoted back into a surface even when its tag / category is hidden.
  if (containsRuleKey(resolved.includeRuleKeys, ruleKey)) return true;
  if (resolved.includeCategories.has(category)) return true;
  if (intersects(tags, resolved.includeTags)) return true;

  if (containsRuleKey(resolved.excludeRuleKeys, ruleKey)) return false;
  if (resolved.excludeCategories.has(category)) return false;
  if (intersects(tags, resolved.excludeTags)) return false;

  return true;
};

export const isDiagnosticOnSurface = (
  diagnostic: Diagnostic,
  surface: DiagnosticSurface,
  config: ReactDoctorConfig | null,
): boolean =>
  isDiagnosticOnResolvedSurface(
    diagnostic,
    buildResolvedControls(surface, config?.surfaces?.[surface]),
  );

export const filterDiagnosticsForSurface = (
  diagnostics: Diagnostic[],
  surface: DiagnosticSurface,
  config: ReactDoctorConfig | null,
): Diagnostic[] => {
  const resolved = buildResolvedControls(surface, config?.surfaces?.[surface]);
  return diagnostics.filter((diagnostic) => isDiagnosticOnResolvedSurface(diagnostic, resolved));
};
