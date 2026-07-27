import { CROSS_FILE_RULE_IDS } from "../plugin/constants/cross-file-rule-ids.js";
import reactDoctorPlugin from "../plugin/react-doctor-plugin.js";
import { hasCapability } from "../plugin/utils/get-react-doctor-setting.js";
import { getNodeEndIndex } from "../plugin/utils/get-node-end-index.js";
import { getNodeStartIndex } from "../plugin/utils/get-node-start-index.js";
import type { Rule } from "../plugin/utils/rule.js";
import {
  NO_CROSS_FILE_RULE_IDS,
  VIRTUAL_PROJECT_CROSS_FILE_RULE_IDS,
} from "./evaluator-constants.js";
import { createOxlintSuppressionIndex } from "./create-oxlint-suppression-index.js";
import { executeRule } from "./execute-rule.js";
import type { ExecutedRuleDiagnostic } from "./execute-rule.js";
import { getSourcePosition } from "./get-source-position.js";
import { parseSource } from "./parse-source.js";
import type { ParseSourceError } from "./parse-source.js";
import { createInMemoryResourceHost } from "./resource-host/in-memory-resource-host.js";
import type { InMemoryResourcePackageInput, ResourceHost } from "./resource-host/resource-host.js";

interface EvaluateRulesInput {
  readonly ruleIds: ReadonlyArray<string>;
  readonly settings?: Readonly<Record<string, unknown>>;
  readonly forceJsx?: boolean;
}

export interface EvaluateSourceInput extends EvaluateRulesInput {
  readonly sourceText: string;
  readonly filename: string;
}

export interface EvaluateProjectInput extends EvaluateRulesInput {
  readonly files: ReadonlyMap<string, string>;
  readonly resourceHost: ResourceHost;
}

export interface EvaluateVirtualProjectInput extends EvaluateRulesInput {
  readonly rootDirectory: string;
  readonly files: ReadonlyMap<string, string>;
  readonly packages?: ReadonlyArray<InMemoryResourcePackageInput>;
}

export interface EvaluatorDiagnostic {
  readonly filePath: string;
  readonly plugin: "react-doctor";
  readonly rule: string;
  readonly severity: "error" | "warning";
  readonly title?: string;
  readonly message: string;
  readonly help: string;
  readonly line: number;
  readonly column: number;
  readonly offset?: number;
  readonly length?: number;
  readonly endLine?: number;
  readonly endColumn?: number;
  readonly category: string;
  readonly matchByOccurrence?: boolean;
}

export interface EvaluatorFailure {
  readonly kind: "parse" | "unknown-rule" | "unsupported-rule" | "rule-crash";
  readonly filePath: string;
  readonly message: string;
  readonly rule?: string;
  readonly line?: number;
  readonly column?: number;
  readonly offset?: number;
  readonly length?: number;
}

export interface EvaluateSourceResult {
  readonly diagnostics: ReadonlyArray<EvaluatorDiagnostic>;
  readonly failures: ReadonlyArray<EvaluatorFailure>;
}

interface EvaluatorRule {
  readonly ruleId: string;
  readonly rule: Rule;
}

interface EvaluateFileInput {
  readonly sourceText: string;
  readonly displayFilename: string;
  readonly runtimeFilename: string;
  readonly ruleIds: ReadonlyArray<string>;
  readonly settings?: Readonly<Record<string, unknown>>;
  readonly forceJsx?: boolean;
  readonly resourceHost?: ResourceHost;
  readonly supportedCrossFileRuleIds: ReadonlySet<string>;
}

const byteOffsetAt = (sourceText: string, sourceIndex: number): number =>
  Buffer.byteLength(sourceText.slice(0, sourceIndex));

const describeThrownValue = (thrownValue: unknown): string =>
  thrownValue instanceof Error ? thrownValue.message : String(thrownValue);

const resolveRuleRecommendation = (rule: Rule, settings: EvaluateFileInput["settings"]): string => {
  const conditionalRecommendation = rule.recommendationFor?.((capability) =>
    hasCapability(settings, capability),
  );
  return conditionalRecommendation ?? rule.recommendation ?? "";
};

const resolveEvaluatorRule = (
  ruleId: string,
  filename: string,
  supportedCrossFileRuleIds: ReadonlySet<string>,
): EvaluatorRule | EvaluatorFailure => {
  if (!Object.hasOwn(reactDoctorPlugin.rules, ruleId)) {
    return {
      kind: "unknown-rule",
      filePath: filename,
      rule: ruleId,
      message: `Unknown React Doctor rule: ${ruleId}`,
    };
  }
  const rule = reactDoctorPlugin.rules[ruleId];
  if (rule.scan || (CROSS_FILE_RULE_IDS.has(ruleId) && !supportedCrossFileRuleIds.has(ruleId))) {
    return {
      kind: "unsupported-rule",
      filePath: filename,
      rule: ruleId,
      message: `Rule requires a project host: ${ruleId}`,
    };
  }
  return { ruleId, rule };
};

const isEvaluatorFailure = (
  resolvedRule: EvaluatorRule | EvaluatorFailure,
): resolvedRule is EvaluatorFailure => "kind" in resolvedRule;

const buildParseFailure = (
  parseError: ParseSourceError,
  sourceText: string,
  filename: string,
): EvaluatorFailure => {
  if (parseError.start === undefined || parseError.end === undefined) {
    return {
      kind: "parse",
      filePath: filename,
      message: parseError.message,
    };
  }
  const location = getSourcePosition(sourceText, parseError.start);
  return {
    kind: "parse",
    filePath: filename,
    message: parseError.message,
    line: location.line,
    column: location.column,
    offset: byteOffsetAt(sourceText, parseError.start),
    length: Buffer.byteLength(sourceText.slice(parseError.start, parseError.end)),
  };
};

const buildEvaluatorDiagnostic = (
  diagnostic: ExecutedRuleDiagnostic,
  ruleId: string,
  rule: Rule,
  input: EvaluateFileInput,
): EvaluatorDiagnostic => {
  const node = diagnostic.node;
  const category = rule.category ?? "Bugs";
  const nodeStart = getNodeStartIndex(node);
  const nodeEnd = getNodeEndIndex(node);
  const startPosition = getSourcePosition(input.sourceText, nodeStart);
  const endPosition = getSourcePosition(input.sourceText, nodeEnd);
  const matchByOccurrence = category === "Accessibility" || Boolean(rule.matchByOccurrence);
  return {
    filePath: input.displayFilename,
    plugin: "react-doctor",
    rule: ruleId,
    severity: rule.severity === "warn" ? "warning" : "error",
    ...(rule.title ? { title: rule.title } : {}),
    message: diagnostic.message,
    help: resolveRuleRecommendation(rule, input.settings),
    line: startPosition.line,
    column: startPosition.column,
    offset: byteOffsetAt(input.sourceText, nodeStart),
    length: Buffer.byteLength(input.sourceText.slice(nodeStart, nodeEnd)),
    endLine: endPosition.line,
    endColumn: endPosition.column,
    category,
    ...(matchByOccurrence ? { matchByOccurrence: true } : {}),
  };
};

const evaluateFile = (input: EvaluateFileInput): EvaluateSourceResult => {
  const resolvedRules = input.ruleIds.map((ruleId) =>
    resolveEvaluatorRule(ruleId, input.displayFilename, input.supportedCrossFileRuleIds),
  );
  const failures = resolvedRules.filter(isEvaluatorFailure);
  const evaluatorRules = resolvedRules.filter(
    (resolvedRule): resolvedRule is EvaluatorRule => !isEvaluatorFailure(resolvedRule),
  );
  const parsedSource = parseSource(input.sourceText, {
    filename: input.runtimeFilename,
    forceJsx: input.forceJsx,
  });
  if (parsedSource.errors.length > 0) {
    return {
      diagnostics: [],
      failures: [
        ...failures,
        ...parsedSource.errors.map((parseError) =>
          buildParseFailure(parseError, input.sourceText, input.displayFilename),
        ),
      ],
    };
  }

  const diagnostics: EvaluatorDiagnostic[] = [];
  const suppressionIndex = createOxlintSuppressionIndex({
    sourceText: input.sourceText,
    comments: parsedSource.comments,
  });
  for (const evaluatorRule of evaluatorRules) {
    try {
      const result = executeRule(evaluatorRule.rule, input.sourceText, parsedSource, {
        filename: input.runtimeFilename,
        resourceHost: input.resourceHost,
        settings: input.settings,
        forceJsx: input.forceJsx,
      });
      diagnostics.push(
        ...result.diagnostics
          .filter((diagnostic) => {
            const nodeStart = getNodeStartIndex(diagnostic.node);
            const nodeEnd = getNodeEndIndex(diagnostic.node);
            return !suppressionIndex.isSuppressed(evaluatorRule.ruleId, nodeStart, nodeEnd);
          })
          .map((diagnostic) =>
            buildEvaluatorDiagnostic(diagnostic, evaluatorRule.ruleId, evaluatorRule.rule, input),
          ),
      );
    } catch (thrownValue) {
      failures.push({
        kind: "rule-crash",
        filePath: input.displayFilename,
        rule: evaluatorRule.ruleId,
        message: describeThrownValue(thrownValue),
      });
    }
  }
  diagnostics.sort(
    (firstDiagnostic, secondDiagnostic) =>
      firstDiagnostic.line - secondDiagnostic.line ||
      firstDiagnostic.column - secondDiagnostic.column,
  );
  return { diagnostics, failures };
};

export const evaluateSource = (input: EvaluateSourceInput): EvaluateSourceResult =>
  evaluateFile({
    sourceText: input.sourceText,
    displayFilename: input.filename,
    runtimeFilename: input.filename,
    ruleIds: input.ruleIds,
    settings: input.settings,
    forceJsx: input.forceJsx,
    supportedCrossFileRuleIds: NO_CROSS_FILE_RULE_IDS,
  });

export const evaluateProject = (input: EvaluateProjectInput): EvaluateSourceResult => {
  const diagnostics: EvaluatorDiagnostic[] = [];
  const failures: EvaluatorFailure[] = [];
  for (const [filename, sourceText] of input.files) {
    const result = evaluateFile({
      sourceText,
      displayFilename: filename,
      runtimeFilename: input.resourceHost.normalizePath(filename),
      ruleIds: input.ruleIds,
      settings: input.settings,
      forceJsx: input.forceJsx,
      resourceHost: input.resourceHost,
      supportedCrossFileRuleIds: VIRTUAL_PROJECT_CROSS_FILE_RULE_IDS,
    });
    diagnostics.push(...result.diagnostics);
    failures.push(...result.failures);
  }
  return { diagnostics, failures };
};

export const evaluateVirtualProject = (
  input: EvaluateVirtualProjectInput,
): EvaluateSourceResult => {
  const resourceHost = createInMemoryResourceHost({
    rootDirectory: input.rootDirectory,
    files: input.files,
    packages: input.packages,
  });
  return evaluateProject({
    files: input.files,
    resourceHost,
    ruleIds: input.ruleIds,
    settings: input.settings,
    forceJsx: input.forceJsx,
  });
};
