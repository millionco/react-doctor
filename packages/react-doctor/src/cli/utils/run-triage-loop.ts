import * as path from "node:path";
import { highlighter } from "@react-doctor/core";
import type { Diagnostic } from "@react-doctor/core";
import { buildTriageRulePrompt } from "./build-triage-rule-prompt.js";
import { cliLogger as logger } from "./cli-logger.js";
import { TRIAGE_DISPLAY_MAX_FILES } from "./constants.js";
import { buildSortedRuleGroups, formatLearnMoreLine } from "./diagnostic-grouping.js";
import { copyToClipboard } from "./launch-agent.js";
import { prompts } from "./prompts.js";
import { resolveRuleConfigTarget, writeRuleConfig } from "./rule-config-file.js";
import { setRuleSeverity } from "./update-rule-config.js";
import {
  pruneTriageState,
  readTriageState,
  updateTriageState,
  writeTriageState,
  type TriageState,
} from "./triage-state.js";

export interface RunTriageLoopInput {
  readonly diagnostics: readonly Diagnostic[];
  readonly outputDirectory: string;
  readonly projectName: string;
  readonly rootDirectory: string;
  readonly rulePriority?: ReadonlyMap<string, number>;
}

export interface TriageLoopResult {
  readonly totalRules: number;
  readonly rulesPrompted: number;
  readonly rulesSkipped: number;
  readonly rulesDisabled: number;
  readonly rulesRemaining: number;
}

const COPY_PROMPT_CHOICE = "copy-prompt";
const SKIP_CHOICE = "skip";
const DISABLE_CHOICE = "disable";

const colorizeBySeverity = (text: string, severity: Diagnostic["severity"]): string =>
  severity === "error" ? highlighter.error(text) : highlighter.warn(text);

const getRuleGroupSeverityRank = (diagnostics: readonly Diagnostic[]): number =>
  diagnostics.some((diagnostic) => diagnostic.severity === "error") ? 0 : 1;

const sortRuleGroupsForTriage = (groups: [string, Diagnostic[]][]): [string, Diagnostic[]][] =>
  groups.toSorted(
    ([, diagnosticsA], [, diagnosticsB]) =>
      getRuleGroupSeverityRank(diagnosticsA) - getRuleGroupSeverityRank(diagnosticsB),
  );

const formatRuleLocation = (diagnostic: Diagnostic): string => {
  if (diagnostic.line > 0) return `${diagnostic.filePath}:${diagnostic.line}`;
  return diagnostic.filePath;
};

const collectDisplayFileEntries = (diagnostics: readonly Diagnostic[]): string[] => {
  const locationByFilePath = new Map<string, string>();
  for (const diagnostic of diagnostics) {
    if (!locationByFilePath.has(diagnostic.filePath)) {
      locationByFilePath.set(diagnostic.filePath, formatRuleLocation(diagnostic));
    }
  }
  return [...locationByFilePath.values()].slice(0, TRIAGE_DISPLAY_MAX_FILES);
};

const disableRuleInConfig = async (ruleKey: string, rootDirectory: string): Promise<boolean> => {
  const target = await resolveRuleConfigTarget(rootDirectory);
  const nextConfig = setRuleSeverity(target.config, ruleKey, "off");
  const result = await writeRuleConfig(target, nextConfig);
  return result.written;
};

const renderRuleCard = (
  ruleIndex: number,
  totalRules: number,
  ruleKey: string,
  diagnostics: readonly Diagnostic[],
  state: TriageState,
): void => {
  const representative = diagnostics[0];
  if (representative === undefined) return;
  const title = representative.title ?? ruleKey;
  const docsLine = formatLearnMoreLine(representative);
  const findingLabel = diagnostics.length === 1 ? "finding" : "findings";
  const severityLabel = representative.severity === "error" ? "ERROR" : "WARNING";
  const severityIcon = representative.severity === "error" ? "x" : "!";
  logger.break();
  logger.log(highlighter.bold(`Rule ${ruleIndex} of ${totalRules}`));
  logger.log(
    `${colorizeBySeverity(`${severityIcon} ${severityLabel}`, representative.severity)} ${highlighter.info(ruleKey)}`,
  );
  if (state.prompted.includes(ruleKey)) {
    logger.dim("  Still failing after a prompt was copied earlier");
  }
  logger.log(
    `  ${highlighter.bold("Type:")} ${highlighter.dim(`${representative.category} / ${diagnostics.length} ${findingLabel}`)}`,
  );
  logger.log(`  ${highlighter.bold("Title:")} ${highlighter.dim(title)}`);
  logger.log(`  ${highlighter.bold("Impact:")} ${highlighter.dim(representative.message)}`);
  const fileEntries = collectDisplayFileEntries(diagnostics);
  if (fileEntries.length > 0) {
    logger.log(`  ${highlighter.bold("Files:")}`);
    for (const fileEntry of fileEntries) {
      logger.log(`    ${highlighter.dim(fileEntry)}`);
    }
    const remainingFileCount =
      new Set(diagnostics.map((diagnostic) => diagnostic.filePath)).size - fileEntries.length;
    if (remainingFileCount > 0) {
      logger.log(`    ${highlighter.dim(`+${remainingFileCount} more in full diagnostics`)}`);
    }
  }
  if (docsLine) {
    logger.log(`  ${highlighter.bold("Docs:")} ${highlighter.info(docsLine)}`);
  }
  logger.break();
};

export const runTriageLoop = async (input: RunTriageLoopInput): Promise<TriageLoopResult> => {
  const groups = sortRuleGroupsForTriage(
    buildSortedRuleGroups(input.diagnostics, input.rulePriority),
  );
  const activeRuleKeys = new Set(groups.map(([ruleKey]) => ruleKey));
  let state = pruneTriageState(readTriageState(input.outputDirectory), activeRuleKeys);
  writeTriageState(input.outputDirectory, state);

  const skippedRuleKeys = new Set([...state.skipped, ...state.disabled]);
  const handledThisSession = new Set<string>();
  let rulesPrompted = 0;
  let rulesSkipped = 0;
  let rulesDisabled = 0;

  for (const [ruleKey, diagnostics] of groups) {
    if (skippedRuleKeys.has(ruleKey) || handledThisSession.has(ruleKey)) continue;
    const ruleIndex = groups.findIndex(([candidateRuleKey]) => candidateRuleKey === ruleKey) + 1;
    renderRuleCard(ruleIndex, groups.length, ruleKey, diagnostics, state);

    const { triageAction } = await prompts<"triageAction">(
      {
        type: "select",
        name: "triageAction",
        message: "Choose an action for this rule",
        hint: "Press c, s, or d. Return submits the highlighted option.",
        choices: [
          {
            title: "Copy fix prompt (c)",
            description: "Paste into Cursor or another coding agent",
            value: COPY_PROMPT_CHOICE,
          },
          {
            title: "Skip in triage (s)",
            description: "Keep the rule enabled, but stop asking in this session",
            value: SKIP_CHOICE,
          },
          {
            title: "Disable in doctor.config (d)",
            description: "Set this rule to off so it stops running",
            value: DISABLE_CHOICE,
          },
        ],
        initial: 0,
      },
      { onCancel: () => true },
    );

    if (triageAction === undefined) break;

    if (triageAction === COPY_PROMPT_CHOICE) {
      const prompt = buildTriageRulePrompt({
        ruleKey,
        diagnostics,
        projectName: input.projectName,
        outputDirectory: input.outputDirectory,
      });
      const didCopy = await copyToClipboard(prompt);
      if (didCopy) {
        logger.log("Copied the focused prompt to your clipboard.");
      } else {
        logger.break();
        logger.log(highlighter.dim("---- Triage prompt ----"));
        logger.log(prompt);
        logger.log(highlighter.dim("-----------------------"));
      }
      state = updateTriageState(state, { prompted: [ruleKey] });
      rulesPrompted += 1;
    } else if (triageAction === SKIP_CHOICE) {
      state = updateTriageState(state, { skipped: [ruleKey] });
      skippedRuleKeys.add(ruleKey);
      rulesSkipped += 1;
    } else if (triageAction === DISABLE_CHOICE) {
      const didDisable = await disableRuleInConfig(ruleKey, input.rootDirectory);
      if (didDisable) {
        logger.log(`Disabled ${highlighter.info(ruleKey)} in doctor.config.`);
      } else {
        logger.warn(
          `Could not edit doctor.config automatically. Add "${ruleKey}": "off" manually.`,
        );
      }
      state = updateTriageState(state, { disabled: [ruleKey] });
      skippedRuleKeys.add(ruleKey);
      rulesDisabled += 1;
    }

    handledThisSession.add(ruleKey);
    writeTriageState(input.outputDirectory, state);
    logger.dim(`  Full diagnostics: ${path.relative(process.cwd(), input.outputDirectory)}`);
  }

  const rulesRemaining = groups.filter(
    ([ruleKey]) => !skippedRuleKeys.has(ruleKey) && !handledThisSession.has(ruleKey),
  ).length;

  return {
    totalRules: groups.length,
    rulesPrompted,
    rulesSkipped,
    rulesDisabled,
    rulesRemaining,
  };
};
