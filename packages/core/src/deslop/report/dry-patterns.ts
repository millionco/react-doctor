import type {
  DependencyGraph,
  DuplicateConstant,
  DuplicateConstantOccurrence,
  DuplicateImport,
  DuplicateImportOccurrence,
  DuplicateInlineType,
  DuplicateTypeDefinition,
  DuplicateTypeDefinitionInstance,
  IdentityWrapper,
  InlineTypeOccurrence,
  RedundantTypePattern,
  SimplifiableExpression,
  SimplifiableFunction,
} from "../types.js";
import {
  DUPLICATE_INLINE_TYPE_HIGH_MEMBER_COUNT,
  MIN_FILES_FOR_DUPLICATE_CONSTANT,
} from "../constants.js";

export const detectDuplicateImports = (graph: DependencyGraph): DuplicateImport[] => {
  const findings: DuplicateImport[] = [];

  for (const module of graph.modules) {
    if (module.isDeclarationFile) continue;

    const groupedByKindAndSpecifier = new Map<string, DuplicateImportOccurrence[]>();
    for (const importInfo of module.imports) {
      if (importInfo.isSideEffect) continue;
      if (importInfo.isDynamic) continue;
      if (importInfo.isGlob) continue;
      const occurrence: DuplicateImportOccurrence = {
        line: importInfo.line,
        column: importInfo.column,
        importedNames: importInfo.importedNames.map((binding) =>
          binding.isNamespace ? `* as ${binding.alias ?? ""}` : (binding.alias ?? binding.name),
        ),
        isTypeOnly: importInfo.isTypeOnly,
      };
      const groupKey = `${importInfo.isTypeOnly ? "type" : "value"}:${importInfo.specifier}`;
      const existing = groupedByKindAndSpecifier.get(groupKey);
      if (existing) {
        existing.push(occurrence);
      } else {
        groupedByKindAndSpecifier.set(groupKey, [occurrence]);
      }
    }

    for (const [groupKey, occurrences] of groupedByKindAndSpecifier) {
      if (occurrences.length < 2) continue;
      const specifier = groupKey.slice(groupKey.indexOf(":") + 1);
      const kindLabel = groupKey.startsWith("type:") ? "type-only " : "";
      findings.push({
        path: module.fileId.path,
        specifier,
        occurrences,
        confidence: "high",
        reason: `"${specifier}" is imported ${occurrences.length} times in this file as ${kindLabel}imports — merge into a single statement`,
      });
    }
  }

  return findings;
};

export const detectRedundantTypePatterns = (graph: DependencyGraph): RedundantTypePattern[] => {
  const findings: RedundantTypePattern[] = [];

  for (const module of graph.modules) {
    if (module.isDeclarationFile) continue;
    for (const parsedPattern of module.redundantTypePatterns) {
      findings.push({
        path: module.fileId.path,
        typeName: parsedPattern.typeName,
        kind: parsedPattern.kind,
        line: parsedPattern.line,
        column: parsedPattern.column,
        confidence: "high",
        reason: parsedPattern.reason,
        suggestion: parsedPattern.suggestion,
      });
    }
  }

  return findings;
};

export const detectIdentityWrappers = (graph: DependencyGraph): IdentityWrapper[] => {
  const findings: IdentityWrapper[] = [];

  for (const module of graph.modules) {
    if (module.isDeclarationFile) continue;
    for (const parsedWrapper of module.identityWrappers) {
      findings.push({
        path: module.fileId.path,
        wrapperName: parsedWrapper.wrapperName,
        wrappedExpression: parsedWrapper.wrappedExpression,
        line: parsedWrapper.line,
        column: parsedWrapper.column,
        confidence: "high",
        reason: `\`${parsedWrapper.wrapperName}\` is a thin wrapper that forwards every argument to \`${parsedWrapper.wrappedExpression}\` unchanged`,
      });
    }
  }

  return findings;
};

export const detectDuplicateTypeDefinitions = (
  graph: DependencyGraph,
): DuplicateTypeDefinition[] => {
  const hashToInstances = new Map<string, DuplicateTypeDefinitionInstance[]>();

  for (const module of graph.modules) {
    if (module.isDeclarationFile) continue;
    for (const typeHash of module.typeDefinitionHashes) {
      const instance: DuplicateTypeDefinitionInstance = {
        path: module.fileId.path,
        typeName: typeHash.typeName,
        line: typeHash.line,
        column: typeHash.column,
      };
      const existing = hashToInstances.get(typeHash.structuralHash);
      if (existing) {
        existing.push(instance);
      } else {
        hashToInstances.set(typeHash.structuralHash, [instance]);
      }
    }
  }

  const findings: DuplicateTypeDefinition[] = [];
  for (const [structuralHash, instances] of hashToInstances) {
    if (instances.length < 2) continue;
    const uniquePaths = new Set(instances.map((instance) => instance.path));
    if (uniquePaths.size < 2) continue;
    const uniqueNames = new Set(instances.map((instance) => instance.typeName));
    const isAllSameName = uniqueNames.size === 1;
    findings.push({
      structuralHash,
      instances,
      confidence: isAllSameName ? "high" : "medium",
      reason: isAllSameName
        ? `${instances.length} identically-named type definitions of the same shape across ${uniquePaths.size} files — extract a shared definition`
        : `${instances.length} structurally-identical type definitions detected across ${uniquePaths.size} files under different names (${[...uniqueNames].join(", ")}) — confirm whether the rename is intentional`,
    });
  }

  return findings;
};

export const detectDuplicateConstants = (graph: DependencyGraph): DuplicateConstant[] => {
  const hashToBuckets = new Map<
    string,
    { literalPreview: string; occurrences: DuplicateConstantOccurrence[] }
  >();

  for (const module of graph.modules) {
    if (module.isDeclarationFile) continue;
    for (const candidate of module.duplicateConstantCandidates) {
      const occurrence: DuplicateConstantOccurrence = {
        path: module.fileId.path,
        constantName: candidate.constantName,
        line: candidate.line,
        column: candidate.column,
      };
      const existing = hashToBuckets.get(candidate.literalHash);
      if (existing) {
        existing.occurrences.push(occurrence);
      } else {
        hashToBuckets.set(candidate.literalHash, {
          literalPreview: candidate.literalPreview,
          occurrences: [occurrence],
        });
      }
    }
  }

  const findings: DuplicateConstant[] = [];
  for (const [literalHash, bucket] of hashToBuckets) {
    const uniqueFilePaths = new Set(bucket.occurrences.map((occurrence) => occurrence.path));
    if (uniqueFilePaths.size < MIN_FILES_FOR_DUPLICATE_CONSTANT) continue;
    const uniqueNames = new Set(bucket.occurrences.map((occurrence) => occurrence.constantName));
    if (uniqueNames.size > 1 && hasDistinctUnitSuffixes([...uniqueNames])) continue;
    findings.push({
      literalHash,
      literalPreview: bucket.literalPreview,
      occurrences: bucket.occurrences,
      confidence: uniqueNames.size === 1 ? "high" : "medium",
      reason:
        uniqueNames.size === 1
          ? `${bucket.occurrences.length} copies of \`const ${[...uniqueNames][0]} = ${bucket.literalPreview}\` across ${uniqueFilePaths.size} files — extract to a shared module`
          : `${bucket.occurrences.length} constants across ${uniqueFilePaths.size} files share the same literal value ${bucket.literalPreview} under different names (${[...uniqueNames].join(", ")}) — consider extracting`,
    });
  }
  return findings;
};

const TRAILING_NAME_TOKEN_PATTERN = /_([A-Z][A-Z0-9]*)$/;

const extractTrailingNameToken = (constantName: string): string | undefined => {
  const match = constantName.match(TRAILING_NAME_TOKEN_PATTERN);
  return match ? match[1] : undefined;
};

/**
 * AGENTS.md requires magic numbers to use trailing unit suffixes (`_MS`, `_PX`,
 * `_TOKENS`, `_WIDTH`, …). When same-value constants carry DIFFERENT trailing
 * tokens (e.g. `STEP_DELAY_MS = 1000` vs `MINIMUM_TOKENS = 1000`), they
 * represent semantically distinct quantities that cannot be consolidated —
 * flagging them as duplicates is misleading. Constants sharing the same
 * trailing token (e.g. `CACHE_INTERVAL_MS` + `RECONNECT_DELAY_MS`, both `_MS`)
 * stay flagged because they are at least same-unit and might be extractable.
 */
const hasDistinctUnitSuffixes = (constantNames: string[]): boolean => {
  const trailingTokens = new Set<string>();
  for (const name of constantNames) {
    const token = extractTrailingNameToken(name);
    if (!token) return false;
    trailingTokens.add(token);
  }
  return trailingTokens.size > 1;
};

export const detectSimplifiableExpressions = (graph: DependencyGraph): SimplifiableExpression[] => {
  const findings: SimplifiableExpression[] = [];
  for (const module of graph.modules) {
    if (module.isDeclarationFile) continue;
    for (const parsedExpression of module.simplifiableExpressions) {
      findings.push({
        path: module.fileId.path,
        kind: parsedExpression.kind,
        snippet: parsedExpression.snippet,
        line: parsedExpression.line,
        column: parsedExpression.column,
        confidence:
          parsedExpression.kind === "double-bang-boolean" ||
          parsedExpression.kind === "ternary-returns-boolean" ||
          parsedExpression.kind === "redundant-null-and-undefined-check"
            ? "high"
            : "medium",
        reason: parsedExpression.reason,
        suggestion: parsedExpression.suggestion,
      });
    }
  }
  return findings;
};

export const detectSimplifiableFunctions = (graph: DependencyGraph): SimplifiableFunction[] => {
  const findings: SimplifiableFunction[] = [];
  for (const module of graph.modules) {
    if (module.isDeclarationFile) continue;
    for (const parsedFunction of module.simplifiableFunctions) {
      findings.push({
        path: module.fileId.path,
        kind: parsedFunction.kind,
        functionName: parsedFunction.functionName,
        line: parsedFunction.line,
        column: parsedFunction.column,
        confidence: parsedFunction.kind === "useless-async-no-await" ? "low" : "high",
        reason: parsedFunction.reason,
        suggestion: parsedFunction.suggestion,
      });
    }
  }
  return findings;
};

export const detectDuplicateInlineTypes = (graph: DependencyGraph): DuplicateInlineType[] => {
  const hashToOccurrences = new Map<
    string,
    { memberCount: number; preview: string; occurrences: InlineTypeOccurrence[] }
  >();

  for (const module of graph.modules) {
    if (module.isDeclarationFile) continue;
    for (const inlineLiteral of module.inlineTypeLiterals) {
      const occurrence: InlineTypeOccurrence = {
        path: module.fileId.path,
        line: inlineLiteral.line,
        column: inlineLiteral.column,
        context: inlineLiteral.context,
        nearestName: inlineLiteral.nearestName,
      };
      const existing = hashToOccurrences.get(inlineLiteral.structuralHash);
      if (existing) {
        existing.occurrences.push(occurrence);
      } else {
        hashToOccurrences.set(inlineLiteral.structuralHash, {
          memberCount: inlineLiteral.memberCount,
          preview: inlineLiteral.preview,
          occurrences: [occurrence],
        });
      }
    }
  }

  const findings: DuplicateInlineType[] = [];
  for (const [structuralHash, group] of hashToOccurrences) {
    if (group.occurrences.length < 2) continue;
    const uniqueSiteKeys = new Set(
      group.occurrences.map((occurrence) => `${occurrence.path}:${occurrence.line}`),
    );
    if (uniqueSiteKeys.size < 2) continue;
    const uniquePaths = new Set(group.occurrences.map((occurrence) => occurrence.path));
    const confidence =
      uniquePaths.size >= 2 || group.memberCount >= DUPLICATE_INLINE_TYPE_HIGH_MEMBER_COUNT
        ? "medium"
        : "low";
    findings.push({
      structuralHash,
      memberCount: group.memberCount,
      preview: group.preview,
      occurrences: group.occurrences,
      confidence,
      reason: `inline object shape ${group.preview} appears at ${group.occurrences.length} sites across ${uniquePaths.size} file(s) — extract a named type`,
    });
  }

  return findings;
};
