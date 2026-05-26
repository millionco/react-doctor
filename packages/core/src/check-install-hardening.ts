import fs from "node:fs";
import path from "node:path";
import {
  RECOMMENDED_MINIMUM_RELEASE_AGE_DAYS,
  RECOMMENDED_MINIMUM_RELEASE_AGE_MINUTES,
  SECONDS_PER_MINUTE,
} from "./constants.js";
import { isFile } from "./project-info/index.js";
import type { Diagnostic } from "./types/index.js";

const PNPM_WORKSPACE_FILE = "pnpm-workspace.yaml";
const NPMRC_FILE = ".npmrc";
const YARNRC_FILE = ".yarnrc.yml";
const BUNFIG_FILE = "bunfig.toml";
const PNPM_LOCKFILE = "pnpm-lock.yaml";
const NPM_LOCKFILE = "package-lock.json";
const YARN_LOCKFILE = "yarn.lock";
const BUN_LOCKFILE = "bun.lock";
const BUN_LOCKFILE_BINARY = "bun.lockb";
const PACKAGE_JSON_FILE = "package.json";
const INSTALL_HARDENING_RULE_KEY = "require-install-hardening";
const UTF8_BOM_CHAR = "\uFEFF";
const YARN_RELEASE_AGE_KEY = "npmMinimalAgeGate";
const BUN_RELEASE_AGE_KEY = "minimumReleaseAge";

type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

interface HardeningScalar {
  readonly value: string;
  readonly line: number;
  readonly column: number;
}

interface ReleaseAgeResult {
  readonly found: boolean;
  readonly scalar: HardeningScalar | null;
}

interface PnpmExtraSettings {
  readonly blockExoticSubdeps: HardeningScalar | null;
  readonly trustPolicy: HardeningScalar | null;
}

interface HardeningCheckResult {
  readonly packageManager: PackageManager;
  readonly configFile: string;
  readonly releaseAge: ReleaseAgeResult;
  readonly pnpmExtras: PnpmExtraSettings | null;
}

interface ReleaseAgeAdvice {
  readonly settingKey: string;
  readonly recommendedSnippet: string;
}

const stripBom = (rawContent: string): string =>
  rawContent.startsWith(UTF8_BOM_CHAR) ? rawContent.slice(UTF8_BOM_CHAR.length) : rawContent;

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

const PNPM_WORKSPACE_KEYS = new Set(["minimumReleaseAge", "blockExoticSubdeps", "trustPolicy"]);

const parseYamlTopLevelScalars = (
  content: string,
  targetKeys: ReadonlySet<string>,
): ReadonlyMap<string, HardeningScalar> => {
  const results = new Map<string, HardeningScalar>();
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
    if (!targetKeys.has(settingKey)) continue;
    const inlineValue = stripInlineComment(trimmedLine.slice(colonIndex + 1)).trim();
    if (inlineValue.length === 0) continue;
    results.set(settingKey, {
      value: unquote(inlineValue),
      line: lineIndex + 1,
      column: lineText.search(/\S/) + 1,
    });
  }
  return results;
};

const parseIniScalars = (
  content: string,
  keyMap: ReadonlyMap<string, string>,
): ReadonlyMap<string, HardeningScalar> => {
  const results = new Map<string, HardeningScalar>();
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
    const canonicalName = keyMap.get(rawKey);
    if (canonicalName === undefined) continue;
    const rawValue = trimmedLine.slice(equalsIndex + 1).trim();
    if (rawValue.length === 0) continue;
    results.set(canonicalName, {
      value: rawValue,
      line: lineIndex + 1,
      column: 1,
    });
  }
  return results;
};

const parseBunfigInstallScalars = (
  content: string,
  targetKeys: ReadonlySet<string>,
): ReadonlyMap<string, HardeningScalar> => {
  const results = new Map<string, HardeningScalar>();
  const lines = stripBom(content).split(/\r?\n/);
  let insideInstallSection = false;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const lineText = lines[lineIndex];
    if (lineText === undefined) continue;
    const trimmedLine = lineText.trim();
    if (trimmedLine.startsWith("[")) {
      insideInstallSection = trimmedLine === "[install]";
      continue;
    }
    if (!insideInstallSection) continue;
    if (trimmedLine.length === 0 || trimmedLine.startsWith("#")) continue;
    const equalsIndex = trimmedLine.indexOf("=");
    if (equalsIndex <= 0) continue;
    const rawKey = trimmedLine.slice(0, equalsIndex).trim();
    if (!targetKeys.has(rawKey)) continue;
    let rawValue = trimmedLine.slice(equalsIndex + 1).trim();
    const commentIndex = rawValue.indexOf("#");
    if (
      commentIndex > 0 &&
      rawValue[commentIndex - 1] !== undefined &&
      /\s/.test(rawValue[commentIndex - 1]!)
    ) {
      rawValue = rawValue.slice(0, commentIndex).trim();
    }
    if (rawValue.length === 0) continue;
    results.set(rawKey, {
      value: unquote(rawValue),
      line: lineIndex + 1,
      column: 1,
    });
  }
  return results;
};

const readPackageManagerField = (rootDirectory: string): string | null => {
  const packageJsonPath = path.join(rootDirectory, PACKAGE_JSON_FILE);
  if (!isFile(packageJsonPath)) return null;
  try {
    const packageJsonRaw = fs.readFileSync(packageJsonPath, "utf-8");
    const packageJson: unknown = JSON.parse(packageJsonRaw);
    if (
      packageJson !== null &&
      typeof packageJson === "object" &&
      "packageManager" in packageJson &&
      typeof packageJson.packageManager === "string"
    ) {
      return packageJson.packageManager;
    }
  } catch {
    return null;
  }
  return null;
};

const detectPackageManager = (rootDirectory: string): PackageManager | null => {
  const packageManagerField = readPackageManagerField(rootDirectory);
  if (packageManagerField !== null) {
    if (packageManagerField.startsWith("pnpm@")) return "pnpm";
    if (packageManagerField.startsWith("yarn@")) return "yarn";
    if (packageManagerField.startsWith("npm@")) return "npm";
    if (packageManagerField.startsWith("bun@")) return "bun";
  }
  if (isFile(path.join(rootDirectory, PNPM_LOCKFILE))) return "pnpm";
  if (isFile(path.join(rootDirectory, PNPM_WORKSPACE_FILE))) return "pnpm";
  if (isFile(path.join(rootDirectory, BUN_LOCKFILE))) return "bun";
  if (isFile(path.join(rootDirectory, BUN_LOCKFILE_BINARY))) return "bun";
  if (isFile(path.join(rootDirectory, YARN_LOCKFILE))) return "yarn";
  if (isFile(path.join(rootDirectory, NPM_LOCKFILE))) return "npm";
  return null;
};

const PNPM_NPMRC_KEY_MAP: ReadonlyMap<string, string> = new Map([
  ["minimum-release-age", "minimumReleaseAge"],
  ["block-exotic-subdeps", "blockExoticSubdeps"],
  ["trust-policy", "trustPolicy"],
]);

const resolvePnpmHardening = (rootDirectory: string): HardeningCheckResult => {
  const workspacePath = path.join(rootDirectory, PNPM_WORKSPACE_FILE);
  if (isFile(workspacePath)) {
    const scalars = parseYamlTopLevelScalars(
      fs.readFileSync(workspacePath, "utf-8"),
      PNPM_WORKSPACE_KEYS,
    );
    return {
      packageManager: "pnpm",
      configFile: PNPM_WORKSPACE_FILE,
      releaseAge: {
        found: scalars.has("minimumReleaseAge"),
        scalar: scalars.get("minimumReleaseAge") ?? null,
      },
      pnpmExtras: {
        blockExoticSubdeps: scalars.get("blockExoticSubdeps") ?? null,
        trustPolicy: scalars.get("trustPolicy") ?? null,
      },
    };
  }
  const npmrcPath = path.join(rootDirectory, NPMRC_FILE);
  if (isFile(npmrcPath)) {
    const scalars = parseIniScalars(fs.readFileSync(npmrcPath, "utf-8"), PNPM_NPMRC_KEY_MAP);
    return {
      packageManager: "pnpm",
      configFile: NPMRC_FILE,
      releaseAge: {
        found: scalars.has("minimumReleaseAge"),
        scalar: scalars.get("minimumReleaseAge") ?? null,
      },
      pnpmExtras: {
        blockExoticSubdeps: scalars.get("blockExoticSubdeps") ?? null,
        trustPolicy: scalars.get("trustPolicy") ?? null,
      },
    };
  }
  return {
    packageManager: "pnpm",
    configFile: NPMRC_FILE,
    releaseAge: { found: false, scalar: null },
    pnpmExtras: { blockExoticSubdeps: null, trustPolicy: null },
  };
};

const NPM_NPMRC_KEY_MAP: ReadonlyMap<string, string> = new Map([
  ["min-release-age", "minReleaseAge"],
]);

const resolveNpmHardening = (rootDirectory: string): HardeningCheckResult => {
  const npmrcPath = path.join(rootDirectory, NPMRC_FILE);
  if (isFile(npmrcPath)) {
    const scalars = parseIniScalars(fs.readFileSync(npmrcPath, "utf-8"), NPM_NPMRC_KEY_MAP);
    return {
      packageManager: "npm",
      configFile: NPMRC_FILE,
      releaseAge: {
        found: scalars.has("minReleaseAge"),
        scalar: scalars.get("minReleaseAge") ?? null,
      },
      pnpmExtras: null,
    };
  }
  return {
    packageManager: "npm",
    configFile: NPMRC_FILE,
    releaseAge: { found: false, scalar: null },
    pnpmExtras: null,
  };
};

const resolveYarnHardening = (rootDirectory: string): HardeningCheckResult => {
  const yarnrcPath = path.join(rootDirectory, YARNRC_FILE);
  if (isFile(yarnrcPath)) {
    const scalars = parseYamlTopLevelScalars(
      fs.readFileSync(yarnrcPath, "utf-8"),
      new Set([YARN_RELEASE_AGE_KEY]),
    );
    return {
      packageManager: "yarn",
      configFile: YARNRC_FILE,
      releaseAge: {
        found: scalars.has(YARN_RELEASE_AGE_KEY),
        scalar: scalars.get(YARN_RELEASE_AGE_KEY) ?? null,
      },
      pnpmExtras: null,
    };
  }
  return {
    packageManager: "yarn",
    configFile: YARNRC_FILE,
    releaseAge: { found: false, scalar: null },
    pnpmExtras: null,
  };
};

const resolveBunHardening = (rootDirectory: string): HardeningCheckResult => {
  const bunfigPath = path.join(rootDirectory, BUNFIG_FILE);
  if (isFile(bunfigPath)) {
    const scalars = parseBunfigInstallScalars(
      fs.readFileSync(bunfigPath, "utf-8"),
      new Set([BUN_RELEASE_AGE_KEY]),
    );
    return {
      packageManager: "bun",
      configFile: BUNFIG_FILE,
      releaseAge: {
        found: scalars.has(BUN_RELEASE_AGE_KEY),
        scalar: scalars.get(BUN_RELEASE_AGE_KEY) ?? null,
      },
      pnpmExtras: null,
    };
  }
  return {
    packageManager: "bun",
    configFile: BUNFIG_FILE,
    releaseAge: { found: false, scalar: null },
    pnpmExtras: null,
  };
};

const releaseAgeAdviceForResult = (result: HardeningCheckResult): ReleaseAgeAdvice => {
  switch (result.packageManager) {
    case "pnpm": {
      if (result.configFile === PNPM_WORKSPACE_FILE) {
        return {
          settingKey: "minimumReleaseAge",
          recommendedSnippet: `minimumReleaseAge: ${RECOMMENDED_MINIMUM_RELEASE_AGE_MINUTES}`,
        };
      }
      return {
        settingKey: "minimum-release-age",
        recommendedSnippet: `minimum-release-age=${RECOMMENDED_MINIMUM_RELEASE_AGE_MINUTES}`,
      };
    }
    case "npm":
      return {
        settingKey: "min-release-age",
        recommendedSnippet: `min-release-age=${RECOMMENDED_MINIMUM_RELEASE_AGE_DAYS}`,
      };
    case "yarn":
      return {
        settingKey: YARN_RELEASE_AGE_KEY,
        recommendedSnippet: `${YARN_RELEASE_AGE_KEY}: ${RECOMMENDED_MINIMUM_RELEASE_AGE_MINUTES}`,
      };
    case "bun":
      return {
        settingKey: BUN_RELEASE_AGE_KEY,
        recommendedSnippet: `${BUN_RELEASE_AGE_KEY} = ${RECOMMENDED_MINIMUM_RELEASE_AGE_MINUTES * SECONDS_PER_MINUTE}`,
      };
  }
};

const buildDiagnostic = (input: {
  readonly filePath: string;
  readonly message: string;
  readonly help: string;
  readonly line?: number;
  readonly column?: number;
}): Diagnostic => ({
  filePath: input.filePath,
  plugin: "react-doctor",
  rule: INSTALL_HARDENING_RULE_KEY,
  severity: "warning",
  message: input.message,
  help: input.help,
  line: input.line ?? 0,
  column: input.column ?? 0,
  category: "Security",
});

const buildPnpmExtraDiagnostics = (result: HardeningCheckResult): Diagnostic[] => {
  if (result.pnpmExtras === null) return [];
  const diagnostics: Diagnostic[] = [];
  const isWorkspaceFile = result.configFile === PNPM_WORKSPACE_FILE;
  const blockExoticKey = isWorkspaceFile ? "blockExoticSubdeps" : "block-exotic-subdeps";
  const trustPolicyKey = isWorkspaceFile ? "trustPolicy" : "trust-policy";

  const { blockExoticSubdeps, trustPolicy } = result.pnpmExtras;

  if (blockExoticSubdeps !== null && blockExoticSubdeps.value.toLowerCase() === "false") {
    diagnostics.push(
      buildDiagnostic({
        filePath: result.configFile,
        line: blockExoticSubdeps.line,
        column: blockExoticSubdeps.column,
        message: `\`${blockExoticKey}: false\` allows transitive deps from \`git:\`, \`file:\`, or tarball URLs — a known supply-chain bypass of the npm registry`,
        help: `Set \`${blockExoticKey}: true\` (the default in recent pnpm v11) so transitive deps must come from the registry`,
      }),
    );
  }

  if (trustPolicy === null) {
    const trustPolicySnippet = isWorkspaceFile
      ? "trustPolicy: no-downgrade"
      : "trust-policy=no-downgrade";
    diagnostics.push(
      buildDiagnostic({
        filePath: result.configFile,
        message: `${result.configFile} is missing \`${trustPolicyKey}\` — without \`no-downgrade\`, pnpm silently accepts packages whose trust signals (provenance, signatures) weaken between updates`,
        help: `Add \`${trustPolicySnippet}\` to ${result.configFile}`,
      }),
    );
  } else if (trustPolicy.value !== "no-downgrade") {
    diagnostics.push(
      buildDiagnostic({
        filePath: result.configFile,
        line: trustPolicy.line,
        column: trustPolicy.column,
        message: `\`${trustPolicyKey}: ${trustPolicy.value}\` is weaker than \`no-downgrade\` — packages may lose trust signals between updates without you noticing`,
        help: `Set \`${isWorkspaceFile ? "trustPolicy: no-downgrade" : "trust-policy=no-downgrade"}\` so pnpm refuses to downgrade trust between resolutions`,
      }),
    );
  }

  return diagnostics;
};

const RESOLVERS: Record<PackageManager, (rootDir: string) => HardeningCheckResult> = {
  pnpm: resolvePnpmHardening,
  npm: resolveNpmHardening,
  yarn: resolveYarnHardening,
  bun: resolveBunHardening,
};

export const checkInstallHardening = (rootDirectory: string): Diagnostic[] => {
  const packageManager = detectPackageManager(rootDirectory);
  if (packageManager === null) return [];

  const result = RESOLVERS[packageManager](rootDirectory);
  const diagnostics: Diagnostic[] = [];

  if (!result.releaseAge.found) {
    const advice = releaseAgeAdviceForResult(result);
    diagnostics.push(
      buildDiagnostic({
        filePath: result.configFile,
        message: `${result.configFile} is missing \`${advice.settingKey}\` — newly published versions can ship malware that gets caught and unpublished within hours`,
        help: `Add \`${advice.recommendedSnippet}\` (7 days) to ${result.configFile} to delay installs until releases have had time to be vetted`,
      }),
    );
  }

  diagnostics.push(...buildPnpmExtraDiagnostics(result));

  return diagnostics;
};
