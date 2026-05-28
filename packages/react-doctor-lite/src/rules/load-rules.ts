import reactDoctorPlugin from "oxlint-plugin-react-doctor";
import { shouldEnableRule } from "./should-enable-rule.js";
import type { DiagnosticSeverity, LiteRuleContext, LoadedRule, RuleSelection } from "../types.js";
import type { RuleVisitors } from "oxlint-plugin-react-doctor";

// The host-rule shape exposed by the plugin's default export. Rules are
// already wrapped with the semantic-context provider, so `context.scopes` /
// `context.cfg` build lazily without any work here.
interface HostRule {
  severity: "error" | "warn";
  category?: string;
  framework?: string;
  requires?: ReadonlyArray<string>;
  disabledBy?: ReadonlyArray<string>;
  tags?: ReadonlyArray<string>;
  defaultEnabled?: boolean;
  recommendation?: string;
  create: (context: LiteRuleContext) => RuleVisitors;
}

const toDiagnosticSeverity = (severity: "error" | "warn"): DiagnosticSeverity =>
  severity === "warn" ? "warning" : "error";

const hostRules = reactDoctorPlugin.rules as unknown as Record<string, HostRule>;

const toLoadedRule = (
  id: string,
  rule: HostRule,
  severityOverride: DiagnosticSeverity | undefined,
): LoadedRule => ({
  id,
  key: `react-doctor/${id}`,
  severity: severityOverride ?? toDiagnosticSeverity(rule.severity),
  category: rule.category ?? "Correctness",
  recommendation: rule.recommendation,
  create: rule.create,
});

// Reconstructs runnable rules from bare ids and a severity map. Worker threads
// use this to rebuild the rule set the main thread already gated — visitor
// functions cannot cross the thread boundary, only ids can.
export const loadRulesByIds = (
  ids: ReadonlyArray<string>,
  severityById: Record<string, DiagnosticSeverity>,
): LoadedRule[] => {
  const loaded: LoadedRule[] = [];
  for (const id of ids) {
    const rule = hostRules[id];
    if (rule) loaded.push(toLoadedRule(id, rule, severityById[id]));
  }
  return loaded;
};

export interface LoadRulesInput {
  capabilities: ReadonlySet<string>;
  selection?: RuleSelection;
}

// Resolves the full set of runnable rules for a project: every react-doctor
// rule, capability-gated, with caller overrides (allowlist, disables, severity
// remaps, default-disabled opt-in) applied.
export const loadRules = ({ capabilities, selection = {} }: LoadRulesInput): LoadedRule[] => {
  const ignoredTags = new Set(selection.ignoreTags ?? []);
  const onlyIds = selection.only ? new Set(selection.only) : null;
  const disabledIds = new Set(selection.disable ?? []);
  const severityOverrides = selection.severity ?? {};

  const loaded: LoadedRule[] = [];
  for (const [id, rule] of Object.entries(hostRules)) {
    if (onlyIds && !onlyIds.has(id)) continue;
    if (disabledIds.has(id)) continue;

    const override = severityOverrides[id];
    if (override === "off") continue;

    if (rule.defaultEnabled === false && !selection.includeDefaultDisabled && !onlyIds?.has(id)) {
      continue;
    }

    if (!shouldEnableRule(rule, capabilities, ignoredTags)) continue;

    loaded.push(toLoadedRule(id, rule, override));
  }
  return loaded;
};
