import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type { Command } from "commander";
import { buildJsonReport } from "../../core/build-json-report.js";
import { buildJsonReportError } from "../../core/build-json-report-error.js";
import { loadConfigWithSource } from "../../core/config/load-config.js";
import { resolveConfigRootDir } from "../../core/config/resolve-config-root-dir.js";
import { highlighter } from "../../core/highlighter.js";
import { inspect } from "../../core/inspect.js";
import { logger, setLoggerSilent } from "../../core/logger.js";
import { filterSourceFiles, getDiffInfo } from "../../core/runners/get-diff-files.js";
import { toRelativePath } from "../../core/to-relative-path.js";
import type { Diagnostic } from "../../types/diagnostic.js";
import type { InspectResult, JsonReportMode } from "../../types/inspect.js";
import type { CliFlags } from "../cli-flags.js";
import { cliState } from "../cli-state.js";
import { getStagedSourceFiles, materializeStagedFiles } from "../get-staged-files.js";
import { handleError } from "../handle-error.js";
import { isCiEnvironment } from "../is-ci-environment.js";
import { isNonInteractiveEnvironment } from "../is-non-interactive-environment.js";
import { printAnnotations } from "../print-annotations.js";
import { resolveCliInspectOptions } from "../resolve-cli-inspect-options.js";
import { resolveDiffMode } from "../resolve-diff-mode.js";
import { resolveEffectiveDiff } from "../resolve-effective-diff.js";
import { resolveFailOnLevel } from "../resolve-fail-on-level.js";
import { runExplain } from "../run-explain.js";
import { selectProjects } from "../select-projects.js";
import { shouldFailForDiagnostics } from "../should-fail-for-diagnostics.js";
import { validateModeFlags } from "../validate-mode-flags.js";
import { VERSION } from "../version.js";
import { writeJsonReport } from "../write-json-report.js";

export const createInspectAction =
  (program: Command) =>
  async (directory: string, flags: CliFlags): Promise<void> => {
    const isScoreOnly = flags.score;
    const isJsonMode = flags.json;
    const isQuiet = isScoreOnly || isJsonMode;
    const requestedDirectory = path.resolve(directory);
    const jsonStartTime = performance.now();

    cliState.isJsonModeActive = isJsonMode;
    cliState.isCompactJsonOutput = Boolean(flags.jsonCompact);
    cliState.resolvedDirectoryForCancel = requestedDirectory;
    cliState.cancelStartTime = jsonStartTime;

    if (isJsonMode) {
      setLoggerSilent(true);
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
      cliState.resolvedDirectoryForCancel = resolvedDirectory;
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
          scanOptions: resolveCliInspectOptions(flags, userConfig, program),
          projectFlag: flags.project,
        });
        return;
      }

      if (!isQuiet) {
        logger.log(`react-doctor v${VERSION}`);
        logger.break();
      }

      const scanOptions = resolveCliInspectOptions(flags, userConfig, program);
      const shouldSkipPrompts =
        flags.yes ||
        flags.full ||
        isJsonMode ||
        isNonInteractiveEnvironment() ||
        !process.stdin.isTTY;

      if (!flags.offline && isCiEnvironment() && !isQuiet) {
        logger.dim("CI detected — scoring locally.");
        logger.break();
      }

      if (flags.staged) {
        cliState.currentReportMode = "staged";
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
                totalElapsedMilliseconds: performance.now() - jsonStartTime,
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

        let tempDirectory: string | null = null;
        let cleanupSnapshot: (() => void) | null = null;
        try {
          tempDirectory = mkdtempSync(path.join(tmpdir(), "react-doctor-staged-"));
          const snapshot = materializeStagedFiles(resolvedDirectory, stagedFiles, tempDirectory);
          cleanupSnapshot = snapshot.cleanup;

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
              project: {
                ...scanResult.project,
                rootDirectory: resolvedDirectory,
              },
            };
            writeJsonReport(
              buildJsonReport({
                version: VERSION,
                directory: resolvedDirectory,
                mode: "staged",
                diff: null,
                scans: [{ directory: resolvedDirectory, result: remappedInspectResult }],
                totalElapsedMilliseconds: performance.now() - jsonStartTime,
              }),
            );
          }

          if (flags.annotations) {
            printAnnotations(remappedDiagnostics, isJsonMode);
          }

          if (
            !isScoreOnly &&
            shouldFailForDiagnostics(
              remappedDiagnostics,
              resolveFailOnLevel(program, flags, userConfig),
            )
          ) {
            process.exitCode = 1;
          }
        } finally {
          cleanupSnapshot?.();
        }
        return;
      }

      const projectDirectories = await selectProjects(
        resolvedDirectory,
        flags.project,
        shouldSkipPrompts,
      );

      const effectiveDiff = resolveEffectiveDiff(flags, userConfig, program);
      const explicitBaseBranch = typeof effectiveDiff === "string" ? effectiveDiff : undefined;
      const wantsDiffMode = effectiveDiff !== undefined && effectiveDiff !== false;
      // HACK: also call getDiffInfo when we MIGHT prompt the user — without
      // it, resolveDiffMode short-circuits at !diffInfo and the
      // "Only scan changed files?" prompt never appears for users on a
      // feature branch who didn't explicitly pass --diff.
      const shouldDetectDiff = wantsDiffMode || (!shouldSkipPrompts && !isQuiet);
      const diffInfo = shouldDetectDiff ? getDiffInfo(resolvedDirectory, explicitBaseBranch) : null;
      const isDiffMode = await resolveDiffMode(diffInfo, effectiveDiff, shouldSkipPrompts, isQuiet);

      // HACK: set the cancel-mode marker BEFORE the scan loop runs — if the
      // user hits Ctrl-C mid-scan, the SIGINT handler reads currentReportMode
      // for the JSON cancel report. Setting it after the loop completes
      // means a cancelled diff scan would report mode: "full".
      cliState.currentReportMode = isDiffMode ? "diff" : "full";

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

      const reportMode: JsonReportMode = isDiffMode ? "diff" : "full";

      if (isJsonMode) {
        writeJsonReport(
          buildJsonReport({
            version: VERSION,
            directory: resolvedDirectory,
            mode: reportMode,
            diff: isDiffMode ? diffInfo : null,
            scans: completedScans,
            totalElapsedMilliseconds: performance.now() - jsonStartTime,
          }),
        );
      }

      if (flags.annotations) {
        printAnnotations(allDiagnostics, isJsonMode);
      }

      if (
        !isScoreOnly &&
        shouldFailForDiagnostics(allDiagnostics, resolveFailOnLevel(program, flags, userConfig))
      ) {
        process.exitCode = 1;
      }
    } catch (error) {
      try {
        if (isJsonMode) {
          writeJsonReport(
            buildJsonReportError({
              version: VERSION,
              directory: cliState.resolvedDirectoryForCancel ?? requestedDirectory,
              error,
              elapsedMilliseconds: performance.now() - jsonStartTime,
              mode: cliState.currentReportMode,
            }),
          );
          process.exitCode = 1;
          return;
        }
        handleError(error);
      } catch {
        if (isJsonMode) {
          process.stdout.write(
            '{"schemaVersion":1,"ok":false,"error":{"message":"Internal error","name":"Error","chain":[]}}\n',
          );
        }
        process.exitCode = 1;
      }
    }
  };
