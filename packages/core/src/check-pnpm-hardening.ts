import fs from "node:fs";
import path from "node:path";
import { RECOMMENDED_PNPM_MINIMUM_RELEASE_AGE_MINUTES } from "./constants.js";
import { isFile } from "./project-info/index.js";
import type { Diagnostic } from "./types/index.js";

const PNPM_WORKSPACE_FILE = "pnpm-workspace.yaml";
const NPMRC_FILE = ".npmrc";
const PNPM_LOCKFILE = "pnpm-lock.yaml";
const PACKAGE_JSON_FILE = "package.json";
const PNPM_HARDENING_RULE_KEY = "require-pnpm-hardening";
const UTF8_BOM_CHAR = "\uFEFF";

interface HardeningScalar {
  readonly value: string;
  readonly line: number;
  readonly column: number;
}

interface HardeningSettings {
  readonly minimumReleaseAge: HardeningScalar | null;
  readonly blockExoticSubdeps: HardeningScalar | null;
  readonly trustPolicy: HardeningScalar | null;
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

const parseWorkspaceHardeningSettings = (content: string): HardeningSettings => {
  let minimumReleaseAge: HardeningScalar | null = null;
  let blockExoticSubdeps: HardeningScalar | null = null;
  let trustPolicy: HardeningScalar | null = null;

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
    const scalar: HardeningScalar = {
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

const NPMRC_KEY_TO_SETTING: ReadonlyMap<string, keyof HardeningSettings> = new Map([
  ["minimum-release-age", "minimumReleaseAge"],
  ["block-exotic-subdeps", "blockExoticSubdeps"],
  ["trust-policy", "trustPolicy"],
]);

const parseNpmrcHardeningSettings = (content: string): HardeningSettings => {
  let minimumReleaseAge: HardeningScalar | null = null;
  let blockExoticSubdeps: HardeningScalar | null = null;
  let trustPolicy: HardeningScalar | null = null;

  const lines = stripBom(content).split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const lineText = lines[lineIndex];
    if (lineText === undefined) continue;
    const trimmedLine = lineText.trim();
    if (trimmedLine.length === 0 || trimmedLine.startsWith("#") || trimmedLine.startsWith(";")) {
      continue;
    }
    const equalsIndex = trimmedLine.indexOf("=");
    if (equalsIndex <= 0) continue;
    const rawKey = trimmedLine.slice(0, equalsIndex).trim();
    const settingName = NPMRC_KEY_TO_SETTING.get(rawKey);
    if (settingName === undefined) continue;
    const rawValue = trimmedLine.slice(equalsIndex + 1).trim();
    if (rawValue.length === 0) continue;
    const scalar: HardeningScalar = {
      value: rawValue,
      line: lineIndex + 1,
      column: 1,
    };
    if (settingName === "minimumReleaseAge") minimumReleaseAge = scalar;
    else if (settingName === "blockExoticSubdeps") blockExoticSubdeps = scalar;
    else if (settingName === "trustPolicy") trustPolicy = scalar;
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
  readonly filePath: string;
  readonly message: string;
  readonly help: string;
  readonly line?: number;
  readonly column?: number;
}

const buildHardeningDiagnostic = (input: BuildHardeningDiagnosticInput): Diagnostic => ({
  filePath: input.filePath,
  plugin: "react-doctor",
  rule: PNPM_HARDENING_RULE_KEY,
  severity: "warning",
  message: input.message,
  help: input.help,
  line: input.line ?? 0,
  column: input.column ?? 0,
  category: "Security",
});

interface HardeningSource {
  readonly targetFile: string;
  readonly settings: HardeningSettings;
}

const resolveHardeningSource = (rootDirectory: string): HardeningSource => {
  const workspacePath = path.join(rootDirectory, PNPM_WORKSPACE_FILE);
  if (isFile(workspacePath)) {
    return {
      targetFile: PNPM_WORKSPACE_FILE,
      settings: parseWorkspaceHardeningSettings(fs.readFileSync(workspacePath, "utf-8")),
    };
  }
  const npmrcPath = path.join(rootDirectory, NPMRC_FILE);
  if (isFile(npmrcPath)) {
    return {
      targetFile: NPMRC_FILE,
      settings: parseNpmrcHardeningSettings(fs.readFileSync(npmrcPath, "utf-8")),
    };
  }
  return {
    targetFile: NPMRC_FILE,
    settings: { minimumReleaseAge: null, blockExoticSubdeps: null, trustPolicy: null },
  };
};

const minimumReleaseAgeKeyForFile = (targetFile: string): string =>
  targetFile === PNPM_WORKSPACE_FILE ? "minimumReleaseAge" : "minimum-release-age";

const blockExoticSubdepsKeyForFile = (targetFile: string): string =>
  targetFile === PNPM_WORKSPACE_FILE ? "blockExoticSubdeps" : "block-exotic-subdeps";

const trustPolicyKeyForFile = (targetFile: string): string =>
  targetFile === PNPM_WORKSPACE_FILE ? "trustPolicy" : "trust-policy";

const minimumReleaseAgeValueForFile = (targetFile: string): string =>
  targetFile === PNPM_WORKSPACE_FILE
    ? `minimumReleaseAge: ${RECOMMENDED_PNPM_MINIMUM_RELEASE_AGE_MINUTES}`
    : `minimum-release-age=${RECOMMENDED_PNPM_MINIMUM_RELEASE_AGE_MINUTES}`;

const trustPolicyValueForFile = (targetFile: string): string =>
  targetFile === PNPM_WORKSPACE_FILE ? "trustPolicy: no-downgrade" : "trust-policy=no-downgrade";

export const checkPnpmHardening = (rootDirectory: string): Diagnostic[] => {
  if (!isPnpmManagedProject(rootDirectory)) return [];

  const { targetFile, settings } = resolveHardeningSource(rootDirectory);

  const diagnostics: Diagnostic[] = [];

  if (settings.minimumReleaseAge === null) {
    const settingKey = minimumReleaseAgeKeyForFile(targetFile);
    diagnostics.push(
      buildHardeningDiagnostic({
        filePath: targetFile,
        message: `${targetFile} is missing \`${settingKey}\` — newly published versions can ship malware that gets caught and unpublished within hours`,
        help: `Add \`${minimumReleaseAgeValueForFile(targetFile)}\` (7 days) to ${targetFile} to delay installs until releases have had time to be vetted`,
      }),
    );
  }

  if (
    settings.blockExoticSubdeps !== null &&
    settings.blockExoticSubdeps.value.toLowerCase() === "false"
  ) {
    const settingKey = blockExoticSubdepsKeyForFile(targetFile);
    diagnostics.push(
      buildHardeningDiagnostic({
        filePath: targetFile,
        line: settings.blockExoticSubdeps.line,
        column: settings.blockExoticSubdeps.column,
        message: `\`${settingKey}: false\` allows transitive deps from \`git:\`, \`file:\`, or tarball URLs — a known supply-chain bypass of the npm registry`,
        help: `Set \`${settingKey}: true\` (the default in recent pnpm v11) so transitive deps must come from the registry`,
      }),
    );
  }

  if (settings.trustPolicy === null) {
    const settingKey = trustPolicyKeyForFile(targetFile);
    diagnostics.push(
      buildHardeningDiagnostic({
        filePath: targetFile,
        message: `${targetFile} is missing \`${settingKey}\` — without \`no-downgrade\`, pnpm silently accepts packages whose trust signals (provenance, signatures) weaken between updates`,
        help: `Add \`${trustPolicyValueForFile(targetFile)}\` to ${targetFile}`,
      }),
    );
  } else if (settings.trustPolicy.value !== "no-downgrade") {
    const settingKey = trustPolicyKeyForFile(targetFile);
    diagnostics.push(
      buildHardeningDiagnostic({
        filePath: targetFile,
        line: settings.trustPolicy.line,
        column: settings.trustPolicy.column,
        message: `\`${settingKey}: ${settings.trustPolicy.value}\` is weaker than \`no-downgrade\` — packages may lose trust signals between updates without you noticing`,
        help: `Set \`${trustPolicyValueForFile(targetFile)}\` so pnpm refuses to downgrade trust between resolutions`,
      }),
    );
  }

  return diagnostics;
};
