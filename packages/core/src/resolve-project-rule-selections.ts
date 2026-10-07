import {
  REACT_DOCTOR_OPT_IN_PROJECT_RULE_IDS,
  REACT_DOCTOR_PROJECT_RULES,
} from "oxlint-plugin-react-doctor/core";
import { buildRuleSeverityControls } from "./build-rule-severity-controls.js";
import type { ReactDoctorConfig, RuleSeverityControls } from "./types/index.js";
import { resolveRuleSeverityOverride } from "./resolve-rule-severity-override.js";
import { shouldEnableRuleByDefaultStatus } from "./utils/should-enable-rule-by-default-status.js";

export interface ProjectRuleSelection {
  readonly ruleId: string;
  readonly ruleKey: string;
  readonly severity: "error" | "warn";
  readonly hasExplicitSeverity: boolean;
}

export interface ShouldUseMaintainabilityLayerInput {
  readonly shouldRunDuplicateJsx: boolean;
  readonly userConfig: ReactDoctorConfig | null;
}

export const resolveProjectRuleSelections = (
  severityControls: RuleSeverityControls | undefined,
): ReadonlyArray<ProjectRuleSelection> =>
  REACT_DOCTOR_PROJECT_RULES.flatMap((entry) => {
    const explicitRuleOverride = resolveRuleSeverityOverride(
      { ruleKey: entry.key },
      severityControls,
    );
    if (
      !shouldEnableRuleByDefaultStatus({
        defaultEnabled: entry.rule.defaultEnabled,
        includeTagDefaults: false,
        hasIncludedTags: false,
        hasExplicitOverride: explicitRuleOverride !== undefined,
      })
    ) {
      return [];
    }
    const severity =
      explicitRuleOverride ??
      resolveRuleSeverityOverride(
        { ruleKey: entry.key, category: entry.rule.category },
        severityControls,
      ) ??
      entry.rule.severity;
    if (severity === "off") return [];
    return [
      {
        ruleId: entry.id,
        ruleKey: entry.key,
        severity,
        hasExplicitSeverity:
          explicitRuleOverride !== undefined ||
          severityControls?.categories?.[entry.rule.category] !== undefined,
      },
    ];
  });

export const projectRuleSelectionsMaySurfaceWhenWarningsAreHidden = (
  selections: ReadonlyArray<ProjectRuleSelection>,
): boolean =>
  selections.some((selection) => selection.severity === "error" || selection.hasExplicitSeverity);

export const countOptInProjectRuleSelections = (
  severityControls: RuleSeverityControls | undefined,
): number =>
  resolveProjectRuleSelections(severityControls).filter((selection) =>
    REACT_DOCTOR_OPT_IN_PROJECT_RULE_IDS.has(selection.ruleId),
  ).length;

export const shouldUseMaintainabilityLayer = (input: ShouldUseMaintainabilityLayerInput): boolean =>
  input.shouldRunDuplicateJsx ||
  countOptInProjectRuleSelections(buildRuleSeverityControls(input.userConfig)) > 0;
