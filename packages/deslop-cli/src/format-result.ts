import type { ScanResult } from "deslop-js";

const formatIssueCount = (count: number, singularLabel: string, pluralLabel: string): string => {
  const label = count === 1 ? singularLabel : pluralLabel;
  return `${count} unused ${label}`;
};

const formatFindingCount = (
  count: number,
  singularLabel: string,
  pluralLabel: string,
  prefix: string,
): string => {
  const prefixText = prefix.length > 0 ? `${prefix} ` : "";
  return `${count} ${prefixText}${count === 1 ? singularLabel : pluralLabel}`;
};

const countReportFindings = (result: ScanResult): number =>
  result.unusedFiles.length +
  result.unusedExports.length +
  result.unusedDependencies.length +
  result.circularDependencies.length +
  result.unusedTypes.length +
  result.unusedEnumMembers.length +
  result.unusedClassMembers.length +
  result.misclassifiedDependencies.length +
  result.redundantAliases.length +
  result.duplicateExports.length +
  result.duplicateImports.length +
  result.redundantTypePatterns.length +
  result.identityWrappers.length +
  result.duplicateTypeDefinitions.length +
  result.duplicateInlineTypes.length +
  result.simplifiableFunctions.length +
  result.simplifiableExpressions.length +
  result.duplicateConstants.length +
  result.crossFileDuplicateExports.length +
  result.duplicateBlocks.length +
  result.duplicateBlockClusters.length +
  result.shadowedDirectoryPairs.length +
  result.reExportCycles.length +
  result.featureFlags.length +
  result.complexFunctions.length +
  result.privateTypeLeaks.length +
  result.unnecessaryAssertions.length +
  result.lazyImportsAtTopLevel.length +
  result.commonjsInEsm.length +
  result.typeScriptEscapeHatches.length;

export const formatHumanReadableResult = (result: ScanResult): string => {
  const lines: string[] = [];

  lines.push(
    `Analyzed ${result.totalFiles} files (${result.totalExports} exports) in ${result.analysisTimeMs.toFixed(0)}ms`,
  );
  lines.push("");

  if (result.unusedFiles.length > 0) {
    lines.push(formatIssueCount(result.unusedFiles.length, "file", "files"));
    for (const unusedFile of result.unusedFiles) {
      lines.push(`  ${unusedFile.path}`);
    }
    lines.push("");
  }

  if (result.unusedExports.length > 0) {
    lines.push(formatIssueCount(result.unusedExports.length, "export", "exports"));
    for (const unusedExport of result.unusedExports) {
      lines.push(`  ${unusedExport.path}:${unusedExport.line}  ${unusedExport.name}`);
    }
    lines.push("");
  }

  if (result.unusedDependencies.length > 0) {
    lines.push(formatIssueCount(result.unusedDependencies.length, "dependency", "dependencies"));
    for (const unusedDependency of result.unusedDependencies) {
      const dependencyKind = unusedDependency.isDevDependency ? "dev" : "prod";
      lines.push(`  ${unusedDependency.name} (${dependencyKind})`);
    }
    lines.push("");
  }

  if (result.circularDependencies.length > 0) {
    const cycleLabel = result.circularDependencies.length === 1 ? "cycle" : "cycles";
    lines.push(`${result.circularDependencies.length} circular ${cycleLabel}`);
    for (const circularDependency of result.circularDependencies) {
      lines.push(`  ${circularDependency.files.join(" → ")}`);
    }
    lines.push("");
  }

  if (result.unusedTypes.length > 0) {
    const typeLabel = result.unusedTypes.length === 1 ? "type" : "types";
    lines.push(`${result.unusedTypes.length} unused ${typeLabel}`);
    for (const unusedType of result.unusedTypes) {
      lines.push(
        `  ${unusedType.path}:${unusedType.line}  ${unusedType.name} (${unusedType.kind}, ${unusedType.confidence})`,
      );
    }
    lines.push("");
  }

  if (result.unusedEnumMembers.length > 0) {
    const memberLabel = result.unusedEnumMembers.length === 1 ? "enum member" : "enum members";
    lines.push(`${result.unusedEnumMembers.length} unused ${memberLabel}`);
    for (const unusedMember of result.unusedEnumMembers) {
      lines.push(
        `  ${unusedMember.path}:${unusedMember.line}  ${unusedMember.enumName}.${unusedMember.memberName} (${unusedMember.confidence})`,
      );
    }
    lines.push("");
  }

  if (result.unusedClassMembers.length > 0) {
    const classLabel = result.unusedClassMembers.length === 1 ? "class member" : "class members";
    lines.push(`${result.unusedClassMembers.length} unused ${classLabel}`);
    for (const unusedMember of result.unusedClassMembers) {
      lines.push(
        `  ${unusedMember.path}:${unusedMember.line}  ${unusedMember.className}.${unusedMember.memberName} (${unusedMember.memberKind}, ${unusedMember.confidence})`,
      );
    }
    lines.push("");
  }

  if (result.misclassifiedDependencies.length > 0) {
    const depLabel = result.misclassifiedDependencies.length === 1 ? "dependency" : "dependencies";
    lines.push(`${result.misclassifiedDependencies.length} misclassified ${depLabel}`);
    for (const finding of result.misclassifiedDependencies) {
      lines.push(
        `  ${finding.name}  ${finding.declaredAs} → ${finding.suggestedAs} (${finding.confidence})`,
      );
    }
    lines.push("");
  }

  if (result.redundantAliases.length > 0) {
    const aliasLabel = result.redundantAliases.length === 1 ? "alias" : "aliases";
    lines.push(`${result.redundantAliases.length} redundant ${aliasLabel}`);
    for (const finding of result.redundantAliases) {
      lines.push(`  ${finding.path}:${finding.line}  [${finding.kind}] ${finding.name}`);
    }
    lines.push("");
  }

  if (result.duplicateExports.length > 0) {
    const exportLabel = result.duplicateExports.length === 1 ? "export" : "exports";
    lines.push(`${result.duplicateExports.length} duplicate ${exportLabel}`);
    for (const finding of result.duplicateExports) {
      lines.push(`  ${finding.path}  ${finding.name} (${finding.occurrences.length}x)`);
    }
    lines.push("");
  }

  if (result.duplicateImports.length > 0) {
    const importLabel = result.duplicateImports.length === 1 ? "import" : "imports";
    lines.push(`${result.duplicateImports.length} duplicate ${importLabel}`);
    for (const finding of result.duplicateImports) {
      lines.push(`  ${finding.path}  ${finding.specifier} (${finding.occurrences.length}x)`);
    }
    lines.push("");
  }

  if (result.redundantTypePatterns.length > 0) {
    const patternLabel =
      result.redundantTypePatterns.length === 1 ? "type pattern" : "type patterns";
    lines.push(`${result.redundantTypePatterns.length} redundant ${patternLabel}`);
    for (const finding of result.redundantTypePatterns) {
      lines.push(
        `  ${finding.path}:${finding.line}  ${finding.typeName} [${finding.kind}] → ${finding.suggestion}`,
      );
    }
    lines.push("");
  }

  if (result.identityWrappers.length > 0) {
    const wrapperLabel = result.identityWrappers.length === 1 ? "wrapper" : "wrappers";
    lines.push(`${result.identityWrappers.length} identity ${wrapperLabel}`);
    for (const finding of result.identityWrappers) {
      lines.push(
        `  ${finding.path}:${finding.line}  ${finding.wrapperName} → ${finding.wrappedExpression}`,
      );
    }
    lines.push("");
  }

  if (result.duplicateTypeDefinitions.length > 0) {
    const defLabel =
      result.duplicateTypeDefinitions.length === 1
        ? "type definition group"
        : "type definition groups";
    lines.push(`${result.duplicateTypeDefinitions.length} duplicate ${defLabel}`);
    for (const finding of result.duplicateTypeDefinitions) {
      const instanceLabels = finding.instances
        .map((instance) => `${instance.typeName}@${instance.path}:${instance.line}`)
        .join(", ");
      lines.push(`  [${finding.confidence}] ${instanceLabels}`);
    }
    lines.push("");
  }

  if (result.analysisErrors.length > 0) {
    const fatalCount = result.analysisErrors.filter((error) => error.severity === "fatal").length;
    const warningCount = result.analysisErrors.filter(
      (error) => error.severity === "warning",
    ).length;
    const infoCount = result.analysisErrors.filter((error) => error.severity === "info").length;
    const counts = [
      fatalCount > 0 ? `${fatalCount} fatal` : null,
      warningCount > 0 ? `${warningCount} warning` : null,
      infoCount > 0 ? `${infoCount} info` : null,
    ]
      .filter((entry) => entry !== null)
      .join(", ");
    lines.push(
      `${result.analysisErrors.length} analysis ${result.analysisErrors.length === 1 ? "error" : "errors"} (${counts})`,
    );
    for (const error of result.analysisErrors.slice(0, 20)) {
      const location = error.path ? ` ${error.path}` : "";
      lines.push(
        `  [${error.severity}/${error.module}/${error.code}]${location}  ${error.message}`,
      );
    }
    if (result.analysisErrors.length > 20) {
      lines.push(`  … and ${result.analysisErrors.length - 20} more`);
    }
    lines.push("");
  }

  if (result.duplicateInlineTypes.length > 0) {
    const inlineLabel =
      result.duplicateInlineTypes.length === 1 ? "inline type group" : "inline type groups";
    lines.push(`${result.duplicateInlineTypes.length} duplicate ${inlineLabel}`);
    for (const finding of result.duplicateInlineTypes) {
      lines.push(
        `  [${finding.confidence}] ${finding.preview} (${finding.occurrences.length} sites)`,
      );
      for (const occurrence of finding.occurrences) {
        lines.push(
          `    ${occurrence.path}:${occurrence.line}  ${occurrence.context}${occurrence.nearestName ? `  ${occurrence.nearestName}` : ""}`,
        );
      }
    }
    lines.push("");
  }

  if (result.simplifiableFunctions.length > 0) {
    const fnLabel = result.simplifiableFunctions.length === 1 ? "function" : "functions";
    lines.push(`${result.simplifiableFunctions.length} simplifiable ${fnLabel}`);
    for (const finding of result.simplifiableFunctions) {
      lines.push(
        `  ${finding.path}:${finding.line}  [${finding.kind}, ${finding.confidence}] ${finding.functionName ?? "?"} → ${finding.suggestion}`,
      );
    }
    lines.push("");
  }

  if (result.simplifiableExpressions.length > 0) {
    const exprLabel = result.simplifiableExpressions.length === 1 ? "expression" : "expressions";
    lines.push(`${result.simplifiableExpressions.length} simplifiable ${exprLabel}`);
    for (const finding of result.simplifiableExpressions) {
      lines.push(
        `  ${finding.path}:${finding.line}  [${finding.kind}, ${finding.confidence}] ${finding.snippet} → ${finding.suggestion}`,
      );
    }
    lines.push("");
  }

  if (result.duplicateConstants.length > 0) {
    const constLabel =
      result.duplicateConstants.length === 1 ? "constant group" : "constant groups";
    lines.push(`${result.duplicateConstants.length} duplicate ${constLabel}`);
    for (const finding of result.duplicateConstants) {
      lines.push(
        `  [${finding.confidence}] ${finding.literalPreview} (${finding.occurrences.length} copies)`,
      );
      for (const occurrence of finding.occurrences.slice(0, 3)) {
        lines.push(`    ${occurrence.path}:${occurrence.line}  const ${occurrence.constantName}`);
      }
      if (finding.occurrences.length > 3) {
        lines.push(`    … and ${finding.occurrences.length - 3} more`);
      }
    }
    lines.push("");
  }

  if (result.crossFileDuplicateExports.length > 0) {
    lines.push(
      formatFindingCount(
        result.crossFileDuplicateExports.length,
        "cross-file duplicate export",
        "cross-file duplicate exports",
        "",
      ),
    );
    for (const finding of result.crossFileDuplicateExports) {
      lines.push(`  ${finding.name} (${finding.locations.length} files, ${finding.confidence})`);
    }
    lines.push("");
  }

  if (result.duplicateBlocks.length > 0) {
    lines.push(
      formatFindingCount(result.duplicateBlocks.length, "block", "blocks", "duplicate"),
    );
    for (const finding of result.duplicateBlocks) {
      const firstInstance = finding.instances[0];
      const location = firstInstance
        ? `${firstInstance.path}:${firstInstance.startLine}-${firstInstance.endLine}`
        : "unknown";
      lines.push(
        `  ${location}  ${finding.instances.length} copies, ${finding.lineCount} lines (${finding.confidence})`,
      );
    }
    lines.push("");
  }

  if (result.duplicateBlockClusters.length > 0) {
    lines.push(
      formatFindingCount(
        result.duplicateBlockClusters.length,
        "block cluster",
        "block clusters",
        "duplicate",
      ),
    );
    for (const finding of result.duplicateBlockClusters) {
      lines.push(
        `  ${finding.files.join(", ")}  ${finding.totalDuplicatedLines} duplicated lines`,
      );
    }
    lines.push("");
  }

  if (result.shadowedDirectoryPairs.length > 0) {
    lines.push(
      formatFindingCount(
        result.shadowedDirectoryPairs.length,
        "directory pair",
        "directory pairs",
        "shadowed",
      ),
    );
    for (const finding of result.shadowedDirectoryPairs) {
      lines.push(
        `  ${finding.directoryA} ↔ ${finding.directoryB} (${finding.sharedFiles.length} shared files)`,
      );
    }
    lines.push("");
  }

  if (result.reExportCycles.length > 0) {
    lines.push(formatFindingCount(result.reExportCycles.length, "cycle", "cycles", "re-export"));
    for (const finding of result.reExportCycles) {
      lines.push(`  ${finding.files.join(" → ")} (${finding.kind}, ${finding.confidence})`);
    }
    lines.push("");
  }

  if (result.featureFlags.length > 0) {
    lines.push(formatFindingCount(result.featureFlags.length, "feature flag", "feature flags", ""));
    for (const finding of result.featureFlags) {
      lines.push(`  ${finding.path}:${finding.line}  ${finding.name} [${finding.kind}]`);
    }
    lines.push("");
  }

  if (result.complexFunctions.length > 0) {
    lines.push(formatFindingCount(result.complexFunctions.length, "function", "functions", "complex"));
    for (const finding of result.complexFunctions) {
      lines.push(
        `  ${finding.path}:${finding.line}  ${finding.functionName} (cyclomatic ${finding.cyclomatic}, cognitive ${finding.cognitive})`,
      );
    }
    lines.push("");
  }

  if (result.privateTypeLeaks.length > 0) {
    lines.push(
      formatFindingCount(result.privateTypeLeaks.length, "type leak", "type leaks", "private"),
    );
    for (const finding of result.privateTypeLeaks) {
      lines.push(`  ${finding.path}:${finding.line}  ${finding.exportName} leaks ${finding.typeName}`);
    }
    lines.push("");
  }

  if (result.unnecessaryAssertions.length > 0) {
    lines.push(
      formatFindingCount(
        result.unnecessaryAssertions.length,
        "assertion",
        "assertions",
        "unnecessary",
      ),
    );
    for (const finding of result.unnecessaryAssertions) {
      lines.push(
        `  ${finding.path}:${finding.line}  [${finding.kind}, ${finding.confidence}] ${finding.suggestion}`,
      );
    }
    lines.push("");
  }

  if (result.lazyImportsAtTopLevel.length > 0) {
    lines.push(
      formatFindingCount(
        result.lazyImportsAtTopLevel.length,
        "top-level lazy import",
        "top-level lazy imports",
        "",
      ),
    );
    for (const finding of result.lazyImportsAtTopLevel) {
      lines.push(`  ${finding.path}:${finding.line}  ${finding.specifier} [${finding.kind}]`);
    }
    lines.push("");
  }

  if (result.commonjsInEsm.length > 0) {
    lines.push(formatFindingCount(result.commonjsInEsm.length, "CommonJS use", "CommonJS uses", ""));
    for (const finding of result.commonjsInEsm) {
      lines.push(`  ${finding.path}:${finding.line}  [${finding.kind}] ${finding.snippet}`);
    }
    lines.push("");
  }

  if (result.typeScriptEscapeHatches.length > 0) {
    lines.push(
      formatFindingCount(
        result.typeScriptEscapeHatches.length,
        "TypeScript escape hatch",
        "TypeScript escape hatches",
        "",
      ),
    );
    for (const finding of result.typeScriptEscapeHatches) {
      lines.push(
        `  ${finding.path}:${finding.line}  [${finding.kind}, ${finding.confidence}] ${finding.suggestion}`,
      );
    }
    lines.push("");
  }

  const totalIssues = countReportFindings(result);

  if (totalIssues === 0 && result.analysisErrors.length === 0) {
    lines.push("No findings.");
  }

  return lines.join("\n").trimEnd() + "\n";
};

export const hasUnusedIssues = (result: ScanResult): boolean =>
  result.unusedFiles.length > 0 ||
  result.unusedExports.length > 0 ||
  result.unusedDependencies.length > 0 ||
  result.unusedTypes.length > 0 ||
  result.unusedEnumMembers.length > 0 ||
  result.unusedClassMembers.length > 0 ||
  result.misclassifiedDependencies.length > 0 ||
  result.redundantAliases.length > 0 ||
  result.duplicateExports.length > 0 ||
  result.duplicateImports.length > 0 ||
  result.redundantTypePatterns.length > 0 ||
  result.identityWrappers.length > 0 ||
  result.duplicateTypeDefinitions.length > 0 ||
  result.duplicateInlineTypes.length > 0 ||
  result.simplifiableFunctions.length > 0 ||
  result.simplifiableExpressions.length > 0 ||
  result.duplicateConstants.length > 0 ||
  result.crossFileDuplicateExports.length > 0 ||
  result.duplicateBlocks.length > 0 ||
  result.duplicateBlockClusters.length > 0 ||
  result.shadowedDirectoryPairs.length > 0 ||
  result.reExportCycles.length > 0 ||
  result.featureFlags.length > 0 ||
  result.complexFunctions.length > 0 ||
  result.privateTypeLeaks.length > 0 ||
  result.unnecessaryAssertions.length > 0 ||
  result.lazyImportsAtTopLevel.length > 0 ||
  result.commonjsInEsm.length > 0 ||
  result.typeScriptEscapeHatches.length > 0;

export const hasCircularIssues = (result: ScanResult): boolean =>
  result.circularDependencies.length > 0;
