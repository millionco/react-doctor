import { highlighter } from "../core/highlighter.js";
import { inspect } from "../core/inspect.js";
import { logger } from "../core/logger.js";
import { toRelativePath } from "../core/to-relative-path.js";
import type { Diagnostic, InspectOptions, ReactDoctorConfig } from "../types.js";
import { findOwningProjectDirectory } from "./find-owning-project.js";
import { parseFileLineArgument } from "./parse-file-line-argument.js";
import { selectProjects } from "./select-projects.js";

export interface ExplainContext {
  resolvedDirectory: string;
  userConfig: ReactDoctorConfig | null;
  scanOptions: InspectOptions;
  projectFlag: string | undefined;
}

const colorizeRuleByDiagnostic = (text: string, severity: Diagnostic["severity"]): string =>
  severity === "error" ? highlighter.error(text) : highlighter.warn(text);

const resolveExplainTargetDirectory = async (
  filePath: string,
  context: ExplainContext,
): Promise<string> => {
  if (context.projectFlag) {
    const matchedDirectories = await selectProjects(
      context.resolvedDirectory,
      context.projectFlag,
      true,
    );
    if (matchedDirectories.length === 0) return context.resolvedDirectory;
    if (matchedDirectories.length > 1) {
      throw new Error(
        `--explain takes a single project; --project resolved to ${matchedDirectories.length} projects.`,
      );
    }
    return matchedDirectories[0];
  }
  return findOwningProjectDirectory(context.resolvedDirectory, filePath);
};

export const runExplain = async (
  fileLineArgument: string,
  context: ExplainContext,
): Promise<void> => {
  const { filePath, line } = parseFileLineArgument(fileLineArgument);
  const targetDirectory = await resolveExplainTargetDirectory(filePath, context);

  const scanResult = await inspect(targetDirectory, {
    ...context.scanOptions,
    silent: true,
    offline: true,
    configOverride: context.userConfig,
  });

  const requestedRelativePath = toRelativePath(filePath, targetDirectory);
  const matchingDiagnostics = scanResult.diagnostics.filter(
    (diagnostic) =>
      diagnostic.line === line &&
      toRelativePath(diagnostic.filePath, targetDirectory) === requestedRelativePath,
  );

  if (matchingDiagnostics.length === 0) {
    logger.log(`No react-doctor diagnostics at ${filePath}:${line}.`);
    return;
  }

  for (const diagnostic of matchingDiagnostics) {
    const ruleIdentifier = `${diagnostic.plugin}/${diagnostic.rule}`;
    const severitySymbol = diagnostic.severity === "error" ? "✗" : "⚠";
    const colorizedRule = colorizeRuleByDiagnostic(ruleIdentifier, diagnostic.severity);
    const severityLabel = colorizeRuleByDiagnostic(diagnostic.severity, diagnostic.severity);
    logger.log(
      `${severitySymbol} ${colorizedRule} ${highlighter.dim(`(${severityLabel})`)} — ${diagnostic.message}`,
    );
    if (diagnostic.category) logger.dim(`  Category: ${diagnostic.category}`);
    if (diagnostic.help) logger.dim(`  ${diagnostic.help}`);
    if (diagnostic.suppressionHint) {
      logger.break();
      logger.log(`  Suppression diagnosis: ${diagnostic.suppressionHint}`);
    } else {
      logger.dim(
        "  No nearby react-doctor-disable-next-line comment was detected — add one immediately above this line to suppress.",
      );
    }
    logger.break();
  }
};
