import type {
  DependencyGraph,
  DeslopConfig,
  DeslopError,
  MisclassifiedDependency,
  RedundantAlias,
  UnusedClassMember,
  UnusedEnumMember,
  UnusedType,
} from "../types.js";
import { TypeScriptError, describeUnknownError } from "../errors.js";
import { runSafeDetector } from "../utils/run-safe-detector.js";
import { createSemanticContext } from "./program.js";
import { buildReferenceIndex } from "./references.js";
import { detectUnusedTypes } from "./unused-types.js";
import { detectUnusedEnumMembers } from "./unused-enum-members.js";
import { detectUnusedClassMembers } from "./unused-class-members.js";
import { detectMisclassifiedDependencies } from "./misclassified-dependencies.js";
import { detectRedundantVariableAliases } from "./variable-aliases.js";
import { detectRoundTripAliases } from "./redundant-reexports.js";

export interface SemanticAnalysisResult {
  unusedTypes: UnusedType[];
  unusedEnumMembers: UnusedEnumMember[];
  unusedClassMembers: UnusedClassMember[];
  misclassifiedDependencies: MisclassifiedDependency[];
  redundantAliases: RedundantAlias[];
  errors: DeslopError[];
  contextStatus:
    | "disabled"
    | "ready"
    | "no-context-required"
    | "no-tsconfig"
    | "tsconfig-parse-error"
    | "program-creation-failed"
    | "too-many-files"
    | "typescript-load-failed";
  contextMessage?: string;
}

const createDisabledSemanticResult = (): SemanticAnalysisResult => ({
  unusedTypes: [],
  unusedEnumMembers: [],
  unusedClassMembers: [],
  misclassifiedDependencies: [],
  redundantAliases: [],
  errors: [],
  contextStatus: "disabled",
});

export const runSemanticAnalysis = (
  graph: DependencyGraph,
  config: DeslopConfig,
): SemanticAnalysisResult => {
  const semanticConfig = config.semantic;
  if (!semanticConfig?.enabled) return createDisabledSemanticResult();

  const errors: DeslopError[] = [];

  const safeDetector = <ResultType>(
    detectorName: string,
    detector: () => ResultType,
    fallback: ResultType,
  ): ResultType =>
    runSafeDetector({
      detectorName,
      detector,
      fallback,
      errorSink: errors,
      module: "semantic",
      contextDescription: "during semantic analysis",
    });

  const misclassifiedDependencies = semanticConfig.reportMisclassifiedDependencies
    ? safeDetector(
        "detectMisclassifiedDependencies",
        () => detectMisclassifiedDependencies(graph, config),
        [],
      )
    : [];

  const needsTsContext =
    semanticConfig.reportUnusedTypes ||
    semanticConfig.reportUnusedEnumMembers ||
    semanticConfig.reportUnusedClassMembers ||
    semanticConfig.reportRedundantVariableAliases ||
    semanticConfig.reportRoundTripAliases;
  if (!needsTsContext) {
    return {
      unusedTypes: [],
      unusedEnumMembers: [],
      unusedClassMembers: [],
      misclassifiedDependencies,
      redundantAliases: [],
      errors,
      contextStatus: "no-context-required",
    };
  }

  let contextResult: ReturnType<typeof createSemanticContext>;
  try {
    contextResult = createSemanticContext(config.rootDir, config.tsConfigPath);
  } catch (contextError) {
    return {
      unusedTypes: [],
      unusedEnumMembers: [],
      unusedClassMembers: [],
      misclassifiedDependencies,
      redundantAliases: [],
      errors: [
        ...errors,
        new TypeScriptError({
          code: "ts-not-loadable",
          message: "createSemanticContext threw before returning a result",
          detail: describeUnknownError(contextError),
        }),
      ],
      contextStatus: "typescript-load-failed",
    };
  }

  if (!contextResult.ok) {
    return {
      unusedTypes: [],
      unusedEnumMembers: [],
      unusedClassMembers: [],
      misclassifiedDependencies,
      redundantAliases: [],
      errors: [...errors, contextResult.failure.error],
      contextStatus: contextResult.failure.reason,
      contextMessage: contextResult.failure.message,
    };
  }

  const { context } = contextResult;
  let referenceIndex: ReturnType<typeof buildReferenceIndex> | undefined;
  const getReferenceIndex = (): ReturnType<typeof buildReferenceIndex> => {
    if (!referenceIndex) {
      referenceIndex = buildReferenceIndex(context.program, context.checker);
    }
    return referenceIndex;
  };

  const unusedTypes = semanticConfig.reportUnusedTypes
    ? safeDetector(
        "detectUnusedTypes",
        () => detectUnusedTypes(graph, config, context, getReferenceIndex()),
        [],
      )
    : [];
  const unusedEnumMembers = semanticConfig.reportUnusedEnumMembers
    ? safeDetector(
        "detectUnusedEnumMembers",
        () => detectUnusedEnumMembers(graph, config, context, getReferenceIndex()),
        [],
      )
    : [];
  const unusedClassMembers = semanticConfig.reportUnusedClassMembers
    ? safeDetector(
        "detectUnusedClassMembers",
        () =>
          detectUnusedClassMembers(
            graph,
            config,
            context,
            getReferenceIndex(),
            semanticConfig.decoratorAllowlist,
          ),
        [],
      )
    : [];
  const variableAliases = semanticConfig.reportRedundantVariableAliases
    ? safeDetector(
        "detectRedundantVariableAliases",
        () => detectRedundantVariableAliases(graph, context, getReferenceIndex()),
        [],
      )
    : [];
  const roundTripAliases = semanticConfig.reportRoundTripAliases
    ? safeDetector("detectRoundTripAliases", () => detectRoundTripAliases(graph, context), [])
    : [];

  return {
    unusedTypes,
    unusedEnumMembers,
    unusedClassMembers,
    misclassifiedDependencies,
    redundantAliases: [...variableAliases, ...roundTripAliases],
    errors,
    contextStatus: "ready",
  };
};
