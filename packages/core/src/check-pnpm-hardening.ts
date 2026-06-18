import * as fs from "node:fs";
import * as path from "node:path";
import { RECOMMENDED_PNPM_MINIMUM_RELEASE_AGE_MINUTES } from "./constants.js";
import { isFile, findMonorepoRoot } from "./project-info/index.js";
import type { Diagnostic } from "./types/index.js";

const PNPM_WORKSPACE_FILE = "pnpm-workspace.yaml";
const PNPM_LOCKFILE = "pnpm-lock.yaml";
const PACKAGE_JSON_FILE = "package.json";
const PNPM_HARDENING_RULE_KEY = "require-pnpm-hardening";
const UTF8_BOM_CHAR = "\uFEFF";

interface PnpmWorkspaceScalar {
  readonly value: string;
  readonly line: number;
  readonly column: number;
}

interface PnpmWorkspaceHardeningSettings {
  readonly minimumReleaseAge: PnpmWorkspaceScalar | null;
  readonly blockExoticSubdeps: PnpmWorkspaceScalar | null;
  readonly trustPolicy: PnpmWorkspaceScalar | null;
}

const HARDENING_SETTING_KEYS = new Set(["minimumReleaseAge", "blockExoticSubdeps", "trustPolicy"]);

const stripInlineComment = (rawValue: string): string => {
  let activeQuote: '"' | "'" | null = null;
  for (let charIndex = 0; charIndex < rawValue.length; charIndex += 1) {
    const currentChar = rawValue[charIndex];
    if (activeQuote !== null) {
      if (currentChar === activeQuote) activeQuote = null;
      continue;
    }
    if (currentChar === '"' || currentChar === "'") {
      activeQuote = currentChar;
      continue;
    }
    if (currentChar !== "#") continue;
    const previousChar = rawValue[charIndex - 1];
    if (charIndex === 0 || (previousChar !== undefined && /\s/.test(previousChar))) {
      return rawValue.slice(0, charIndex);
    }
  }
  return rawValue;
};

const unquote = (rawValue: string): string => rawValue.replace(/^["']|["']$/g, "");

const stripBom = (rawContent: string): string =>
  rawContent.startsWith(UTF8_BOM_CHAR) ? rawContent.slice(UTF8_BOM_CHAR.length) : rawContent;

const parseHardeningSettings = (content: string): PnpmWorkspaceHardeningSettings => {
  let minimumReleaseAge: PnpmWorkspaceScalar | null = null;
  let blockExoticSubdeps: PnpmWorkspaceScalar | null = null;
  let trustPolicy: PnpmWorkspaceScalar | null = null;

  const lines = stripBom(content).split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const lineText = lines[lineIndex];
    if (lineText === undefined) continue;
    if (lineText.search(/\S/) !== 0) continue;
    const trimmedLine = lineText.trim();
    if (trimmedLine.startsWith("#")) continue;
    const colonIndex = trimmedLine.indexOf(":");
    if (colonIndex <= 0) continue;
    const settingKey = unquote(trimmedLine.slice(0, colonIndex).trim());
    if (!HARDENING_SETTING_KEYS.has(settingKey)) continue;
    const inlineValue = stripInlineComment(trimmedLine.slice(colonIndex + 1)).trim();
    if (inlineValue.length === 0) continue;
    const scalar: PnpmWorkspaceScalar = {
      value: unquote(inlineValue),
      line: lineIndex + 1,
      column: lineText.search(/\S/) + 1,
    };
    if (settingKey === "minimumReleaseAge") minimumReleaseAge = scalar;
    else if (settingKey === "blockExoticSubdeps") blockExoticSubdeps = scalar;
    else if (settingKey === "trustPolicy") trustPolicy = scalar;
  }
  return { minimumReleaseAge, blockExoticSubdeps, trustPolicy };
};

const isPnpmManagedProject = (rootDirectory: string): boolean => {
  if (isFile(path.join(rootDirectory, PNPM_LOCKFILE))) return true;
  if (isFile(path.join(rootDirectory, PNPM_WORKSPACE_FILE))) return true;
  const packageJsonPath = path.join(rootDirectory, PACKAGE_JSON_FILE);
  if (!isFile(packageJsonPath)) return false;
  try {
    const packageJsonRaw = fs.readFileSync(packageJsonPath, "utf-8");
    const packageJson: unknown = JSON.parse(packageJsonRaw);
    if (
      packageJson !== null &&
      typeof packageJson === "object" &&
      "packageManager" in packageJson &&
      typeof packageJson.packageManager === "string" &&
      packageJson.packageManager.startsWith("pnpm@")
    ) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
};

interface BuildHardeningDiagnosticInput {
  readonly message: string;
  readonly help: string;
  readonly line?: number;
  readonly column?: number;
}

const buildHardeningDiagnostic = (input: BuildHardeningDiagnosticInput): Diagnostic => ({
  filePath: PNPM_WORKSPACE_FILE,
  plugin: "react-doctor",
  rule: PNPM_HARDENING_RULE_KEY,
  severity: "warning",
  message: input.message,
  help: input.help,
  line: input.line ?? 0,
  column: input.column ?? 0,
  category: "Security",
});

export const checkPnpmHardening = (scanDirectory: string): Diagnostic[] => {
  if (!isPnpmManagedProject(scanDirectory)) return [];

  const workspacePath = path.join(scanDirectory, PNPM_WORKSPACE_FILE);
  const hasWorkspaceFile = isFile(workspacePath);

  if (!hasWorkspaceFile) {
    const monorepoRoot = findMonorepoRoot(scanDirectory);
    if (monorepoRoot !== null && isFile(path.join(monorepoRoot, PNPM_WORKSPACE_FILE))) {
      return [];
    }
  }

  const workspaceContent = hasWorkspaceFile ? fs.readFileSync(workspacePath, "utf-8") : "";
  const settings = parseHardeningSettings(workspaceContent);

  const diagnostics: Diagnostic[] = [];

  if (settings.minimumReleaseAge === null) {
    diagnostics.push(
      buildHardeningDiagnostic({
        message:
          "pnpm-workspace.yaml is missing `minimumReleaseAge` — newly published versions can ship malware that gets caught and unpublished within hours",
        help: `Add \`minimumReleaseAge: ${RECOMMENDED_PNPM_MINIMUM_RELEASE_AGE_MINUTES}\` (7 days) to pnpm-workspace.yaml to delay installs until releases have had time to be vetted`,
      }),
    );
  }

  if (
    settings.blockExoticSubdeps !== null &&
    settings.blockExoticSubdeps.value.toLowerCase() === "false"
  ) {
    diagnostics.push(
      buildHardeningDiagnostic({
        line: settings.blockExoticSubdeps.line,
        column: settings.blockExoticSubdeps.column,
        message:
          "`blockExoticSubdeps: false` allows transitive deps from `git:`, `file:`, or tarball URLs — a known supply-chain bypass of the npm registry",
        help: "Set `blockExoticSubdeps: true` (the default in recent pnpm v11) so transitive deps must come from the registry",
      }),
    );
  }

  if (settings.trustPolicy === null) {
    diagnostics.push(
      buildHardeningDiagnostic({
        message:
          "pnpm-workspace.yaml is missing `trustPolicy` — without `no-downgrade`, pnpm silently accepts packages whose trust signals (provenance, signatures) weaken between updates",
        help: "Add `trustPolicy: no-downgrade` to pnpm-workspace.yaml",
      }),
    );
  } else if (settings.trustPolicy.value !== "no-downgrade") {
    diagnostics.push(
      buildHardeningDiagnostic({
        line: settings.trustPolicy.line,
        column: settings.trustPolicy.column,
        message: `\`trustPolicy: ${settings.trustPolicy.value}\` is weaker than \`no-downgrade\` — packages may lose trust signals between updates without you noticing`,
        help: "Set `trustPolicy: no-downgrade` so pnpm refuses to downgrade trust between resolutions",
      }),
    );
  }

  return diagnostics;
};
