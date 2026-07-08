import { defineRule } from "../../utils/define-rule.js";
import type { FileScan, ScanFinding } from "../../utils/file-scan.js";
import { isConfigOrCiPath } from "./utils/is-config-or-ci-path.js";
import { scanByPattern } from "./utils/scan-by-pattern.js";

const CI_INSTALL_NEAR_SECRET_PATTERN =
  /(?:npm|pnpm|yarn|bun)\s+(?:install|ci)\b(?:(?!--ignore-scripts)[\s\S]){0,700}\bsecrets\.[A-Z0-9_]+|\bsecrets\.[A-Z0-9_]+(?:(?!--ignore-scripts)[\s\S]){0,700}(?:npm|pnpm|yarn|bun)\s+(?:install|ci)\b/i;

const INSTALL_COMMAND_PATTERN = /(?:npm|pnpm|yarn|bun)\s+(?:install|ci)\b/i;
const SECRET_REFERENCE_PATTERN = /\bsecrets\.[A-Z0-9_]+/;
const IGNORE_SCRIPTS_FLAG_PATTERN = /--ignore-scripts\b/;

const MESSAGE =
  "The build or install pipeline can execute package lifecycle code while CI secrets may be present.";

const isWorkflowPath = (relativePath: string): boolean =>
  /(?:^|\/)\.github\/workflows\/[^/]+\.ya?ml$/i.test(relativePath);

interface WorkflowStepChunk {
  readonly startLineIndex: number;
  readonly lines: string[];
}

// GitHub Actions injects `${{ secrets.X }}` only into the step that
// references it, so an install's lifecycle scripts can read a secret only
// when the reference lives in the SAME step or in a shared (workflow/job
// level) scope — not when it is step-scoped to a later publish/deploy step.
// A light indentation walk separates step chunks from shared scope; the
// proximity regex stays for config files without step isolation.
const scanWorkflowContent = (content: string): ScanFinding[] => {
  const lines = content.split("\n");
  const sharedScopeLines: string[] = [];
  const steps: WorkflowStepChunk[] = [];
  let stepsKeyIndent: number | undefined;
  let stepItemIndent: number | undefined;
  let currentStep: WorkflowStepChunk | undefined;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const trimmedLine = line.trim();
    if (trimmedLine === "" || trimmedLine.startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;

    if (stepsKeyIndent !== undefined && indent <= stepsKeyIndent) {
      stepsKeyIndent = undefined;
      stepItemIndent = undefined;
      currentStep = undefined;
    }

    if (stepsKeyIndent === undefined) {
      if (/^steps:\s*(?:#.*)?$/.test(trimmedLine)) {
        stepsKeyIndent = indent;
      } else {
        sharedScopeLines.push(line);
      }
      continue;
    }

    const startsStepItem = trimmedLine === "-" || trimmedLine.startsWith("- ");
    if (startsStepItem && (stepItemIndent === undefined || indent === stepItemIndent)) {
      stepItemIndent = indent;
      currentStep = { startLineIndex: lineIndex, lines: [line] };
      steps.push(currentStep);
      continue;
    }

    if (currentStep !== undefined) {
      currentStep.lines.push(line);
    } else {
      sharedScopeLines.push(line);
    }
  }

  const sharedScopeHasSecret = SECRET_REFERENCE_PATTERN.test(sharedScopeLines.join("\n"));

  for (const step of steps) {
    const stepText = step.lines.join("\n");
    if (!INSTALL_COMMAND_PATTERN.test(stepText)) continue;
    if (IGNORE_SCRIPTS_FLAG_PATTERN.test(stepText)) continue;
    if (!sharedScopeHasSecret && !SECRET_REFERENCE_PATTERN.test(stepText)) continue;
    const installLineOffset = Math.max(
      step.lines.findIndex((stepLine) => INSTALL_COMMAND_PATTERN.test(stepLine)),
      0,
    );
    const installLine = step.lines[installLineOffset];
    const installColumnIndex = installLine.search(INSTALL_COMMAND_PATTERN);
    return [
      {
        message: MESSAGE,
        line: step.startLineIndex + installLineOffset + 1,
        column: (installColumnIndex === -1 ? 0 : installColumnIndex) + 1,
      },
    ];
  }
  return [];
};

const scanNonWorkflowConfig = scanByPattern({
  // The CI-install pattern only describes workflow files; package.json
  // (also a config path) never matches its shape.
  shouldScan: (file) =>
    isConfigOrCiPath(file.relativePath) &&
    !file.relativePath.endsWith("package.json") &&
    !isWorkflowPath(file.relativePath),
  pattern: CI_INSTALL_NEAR_SECRET_PATTERN,
  message: MESSAGE,
});

const scan: FileScan = (file) => {
  if (isWorkflowPath(file.relativePath)) return scanWorkflowContent(file.content);
  return scanNonWorkflowConfig(file);
};

export const buildPipelineSecretBoundary = defineRule({
  id: "build-pipeline-secret-boundary",
  title: "Build pipeline runs code near secrets",
  severity: "warn",
  recommendation:
    "Run dependency installs with scripts disabled before exposing secrets, isolate untrusted build code, and move signing/deploy authority into a narrow privileged step.",
  scan,
});
