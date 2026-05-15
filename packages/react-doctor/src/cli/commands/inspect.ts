import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  buildJsonReport,
  filterSourceFiles,
  getDiffInfo,
  highlighter,
  loadConfigWithSource,
  logger,
  resolveConfigRootDir,
  toRelativePath,
} from "@react-doctor/core";
import { inspect } from "../../inspect.js";
import type { Diagnostic, InspectResult } from "@react-doctor/types";
import { STAGED_FILES_TEMP_DIR_PREFIX } from "../utils/constants.js";
import { getStagedSourceFiles, materializeStagedFiles } from "../utils/get-staged-files.js";
import type { InspectFlags } from "../utils/inspect-flags.js";
import { handleError } from "../utils/handle-error.js";
import { isCiEnvironment } from "../utils/is-ci-environment.js";
import {
  enableJsonMode,
  setJsonReportDirectory,
  setJsonReportMode,
  writeJsonErrorReport,
  writeJsonReport,
} from "../utils/json-mode.js";
import { printAnnotations } from "../utils/print-annotations.js";
import { printBrandedHeader } from "../utils/print-branded-header.js";
import { resolveCliInspectOptions } from "../utils/resolve-cli-inspect-options.js";
import { resolveDiffMode } from "../utils/resolve-diff-mode.js";
import { resolveEffectiveDiff } from "../utils/resolve-effective-diff.js";
import { resolveFailOnLevel } from "../utils/resolve-fail-on-level.js";
import { runExplain } from "../utils/run-explain.js";
import { selectProjects } from "../utils/select-projects.js";
import { shouldFailForDiagnostics } from "../utils/should-fail-for-diagnostics.js";
import { shouldSkipPrompts } from "../utils/should-skip-prompts.js";
import { validateModeFlags } from "../utils/validate-mode-flags.js";
import { VERSION } from "../utils/version.js";

export const inspectAction = async (directory: string, flags: InspectFlags): Promise<void> => {
  const isScoreOnly = Boolean(flags.score);
  const isJsonMode = Boolean(flags.json);
  const isQuiet = isScoreOnly || isJsonMode;
  const requestedDirectory = path.resolve(directory);
  const startTime = performance.now();

  if (isJsonMode) {
    enableJsonMode({ compact: Boolean(flags.jsonCompact), directory: requestedDirectory });
  }

  try {
    validateModeFlags(flags);

    const loadedConfig = loadConfigWithSource(requestedDirectory);
    const userConfig = loadedConfig?.config ?? null;
    const redirectedDirectory = resolveConfigRootDir(
      loadedConfig?.config ?? null,
      loadedConfig?.sourceDirectory ?? null,
    );
    const resolvedDirectory = redirectedDirectory ?? requestedDirectory;
    setJsonReportDirectory(resolvedDirectory);
    if (redirectedDirectory && !isQuiet) {
      logger.dim(
        `Redirected to ${highlighter.info(toRelativePath(resolvedDirectory, requestedDirectory))} via react-doctor config "rootDir".`,
      );
      logger.break();
    }

    const explainArgument = flags.explain ?? flags.why;
    if (explainArgument !== undefined) {
      await runExplain(explainArgument, {
        resolvedDirectory,
        userConfig,
        scanOptions: resolveCliInspectOptions(flags, userConfig),
        projectFlag: flags.project,
      });
      return;
    }

    if (!isQuiet) {
      printBrandedHeader();
    }

    const scanOptions = resolveCliInspectOptions(flags, userConfig);
    const skipPrompts = shouldSkipPrompts({ yes: flags.yes, full: flags.full, json: flags.json });

    if (!flags.offline && isCiEnvironment() && !isQuiet) {
      logger.dim("CI detected — scoring locally.");
      logger.break();
    }

    if (flags.staged) {
      setJsonReportMode("staged");
      const stagedFiles = getStagedSourceFiles(resolvedDirectory);
      if (stagedFiles.length === 0) {
        if (isJsonMode) {
          writeJsonReport(
            buildJsonReport({
              version: VERSION,
              directory: resolvedDirectory,
              mode: "staged",
              diff: null,
              scans: [],
              totalElapsedMilliseconds: performance.now() - startTime,
            }),
          );
        } else if (!isScoreOnly) {
          logger.dim("No staged source files found.");
        }
        return;
      }

      if (!isQuiet) {
        logger.log(`Scanning ${highlighter.info(`${stagedFiles.length}`)} staged files...`);
        logger.break();
      }

      const tempDirectory = mkdtempSync(path.join(tmpdir(), STAGED_FILES_TEMP_DIR_PREFIX));
      const snapshot = materializeStagedFiles(resolvedDirectory, stagedFiles, tempDirectory);
      try {
        const scanResult = await inspect(snapshot.tempDirectory, {
          ...scanOptions,
          includePaths: snapshot.stagedFiles,
          configOverride: userConfig,
        });

        const remappedDiagnostics = scanResult.diagnostics.map((diagnostic) => ({
          ...diagnostic,
          filePath: path.isAbsolute(diagnostic.filePath)
            ? diagnostic.filePath.replaceAll(snapshot.tempDirectory, resolvedDirectory)
            : diagnostic.filePath,
        }));

        if (isJsonMode) {
          const remappedInspectResult: InspectResult = {
            ...scanResult,
            diagnostics: remappedDiagnostics,
            project: { ...scanResult.project, rootDirectory: resolvedDirectory },
          };
          writeJsonReport(
            buildJsonReport({
              version: VERSION,
              directory: resolvedDirectory,
              mode: "staged",
              diff: null,
              scans: [{ directory: resolvedDirectory, result: remappedInspectResult }],
              totalElapsedMilliseconds: performance.now() - startTime,
            }),
          );
        }

        if (flags.annotations) {
          printAnnotations(remappedDiagnostics, isJsonMode);
        }

        if (
          !isScoreOnly &&
          shouldFailForDiagnostics(remappedDiagnostics, resolveFailOnLevel(flags, userConfig))
        ) {
          process.exitCode = 1;
        }
      } finally {
        snapshot.cleanup();
      }
      return;
    }

    const projectDirectories = await selectProjects(resolvedDirectory, flags.project, skipPrompts);

    const effectiveDiff = resolveEffectiveDiff(flags, userConfig);
    const explicitBaseBranch = typeof effectiveDiff === "string" ? effectiveDiff : undefined;
    const wantsDiffMode = effectiveDiff !== undefined && effectiveDiff !== false;
    // HACK: also call getDiffInfo when we MIGHT prompt the user — without
    // it, resolveDiffMode short-circuits at !diffInfo and the
    // "Only scan changed files?" prompt never appears for users on a
    // feature branch who didn't explicitly pass --diff.
    const shouldDetectDiff = wantsDiffMode || (!skipPrompts && !isQuiet);
    const diffInfo = shouldDetectDiff ? getDiffInfo(resolvedDirectory, explicitBaseBranch) : null;
    const isDiffMode = await resolveDiffMode(diffInfo, effectiveDiff, skipPrompts, isQuiet);

    // HACK: set the report-mode marker BEFORE the scan loop runs — if the
    // user hits Ctrl-C mid-scan, the SIGINT handler reads it for the JSON
    // cancel report. Setting it after the loop completes means a cancelled
    // diff scan would report mode: "full".
    setJsonReportMode(isDiffMode ? "diff" : "full");

    if (isDiffMode && diffInfo && !isQuiet) {
      if (diffInfo.isCurrentChanges) {
        logger.log("Scanning uncommitted changes");
      } else {
        logger.log(
          `Scanning changes: ${highlighter.info(diffInfo.currentBranch)} → ${highlighter.info(diffInfo.baseBranch)}`,
        );
      }
      logger.break();
    }

    const allDiagnostics: Diagnostic[] = [];
    const completedScans: Array<{ directory: string; result: InspectResult }> = [];

    for (const projectDirectory of projectDirectories) {
      let includePaths: string[] | undefined;
      if (isDiffMode) {
        const projectDiffInfo =
          projectDirectory === resolvedDirectory
            ? diffInfo
            : getDiffInfo(projectDirectory, explicitBaseBranch);
        if (projectDiffInfo) {
          const changedSourceFiles = filterSourceFiles(projectDiffInfo.changedFiles);
          if (changedSourceFiles.length === 0) {
            if (!isQuiet) {
              logger.dim(`No changed source files in ${projectDirectory}, skipping.`);
              logger.break();
            }
            continue;
          }
          includePaths = changedSourceFiles;
        } else if (!isQuiet) {
          logger.dim(
            `Cannot detect diff for ${projectDirectory} (not a git repository?) — scanning all files.`,
          );
          logger.break();
        }
      }

      if (!isQuiet) {
        logger.dim(`Scanning ${projectDirectory}...`);
        logger.break();
      }
      const scanResult = await inspect(projectDirectory, {
        ...scanOptions,
        includePaths,
        configOverride: userConfig,
      });
      allDiagnostics.push(...scanResult.diagnostics);
      completedScans.push({ directory: projectDirectory, result: scanResult });
      if (!isQuiet) {
        logger.break();
      }
    }

    if (isJsonMode) {
      writeJsonReport(
        buildJsonReport({
          version: VERSION,
          directory: resolvedDirectory,
          mode: isDiffMode ? "diff" : "full",
          diff: isDiffMode ? diffInfo : null,
          scans: completedScans,
          totalElapsedMilliseconds: performance.now() - startTime,
        }),
      );
    }

    if (flags.annotations) {
      printAnnotations(allDiagnostics, isJsonMode);
    }

    if (
      !isScoreOnly &&
      shouldFailForDiagnostics(allDiagnostics, resolveFailOnLevel(flags, userConfig))
    ) {
      process.exitCode = 1;
    }
  } catch (error) {
    if (isJsonMode) {
      writeJsonErrorReport(error);
      process.exitCode = 1;
      return;
    }
    handleError(error);
  }
};
