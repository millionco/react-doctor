import * as fs from "node:fs";
import * as path from "node:path";
import { getClosedJsonSnapshotSourceResolutionPolicy } from "./closed-json-snapshot-config/get-closed-json-snapshot-webpack-config.js";
import { SNAPSHOT_KNOWN_SDK_REQUEST_HEADS } from "./closed-json-snapshot-config/constants.js";
import type { ClosedJsonSnapshotSourceResolutionPolicy } from "./closed-json-snapshot-config/interfaces.js";
import { readClosedJsonSnapshotYarnResolution } from "./read-closed-json-snapshot-yarn-resolution.js";
import { comparePackageVersions } from "./compare-package-versions.js";
import { parsePackageVersion } from "./parse-package-version.js";
import type { ParsedPackageVersion } from "./parse-package-version.js";
import { recordContentProbe, recordExistenceProbe } from "./cross-file-probe-recorder.js";
import {
  SNAPSHOT_ROLE_MAX_FILE_BYTES,
  SNAPSHOT_ROLE_MAX_ANCESTOR_COUNT,
  SNAPSHOT_ROLE_MAX_PUBLIC_ENTRY_DEPTH,
  SNAPSHOT_ROLE_MAX_PUBLIC_ENTRY_VALUES,
  SNAPSHOT_ROLE_MAX_REPLACEMENT_DEPTH,
  SNAPSHOT_ROLE_MAX_REPLACEMENT_VALUES,
  SNAPSHOT_ROLE_MAX_RANGE_CHARACTERS,
  SNAPSHOT_ROLE_REACT_MINIMUM,
  SNAPSHOT_ROLE_REACT_MAXIMUM,
  SNAPSHOT_ROLE_DOM_MINIMUM,
  SNAPSHOT_ROLE_AXIOS_MINIMUM,
  SNAPSHOT_ROLE_AXIOS_MAXIMUM,
  SNAPSHOT_ROLE_ROUTER_MINIMUM,
  SNAPSHOT_ROLE_ROUTER_MAXIMUM,
  SNAPSHOT_ROLE_LEGACY_ROUTER_VERSION,
  SNAPSHOT_ROLE_LODASH_MINIMUM,
  SNAPSHOT_ROLE_LODASH_MAXIMUM,
  SNAPSHOT_ROLE_ANTD_MINIMUM,
  SNAPSHOT_ROLE_ANTD_MAXIMUM,
  SNAPSHOT_ROLE_HISTORICAL_AXIOS_VERSIONS,
} from "./closed-json-snapshot-role/constants.js";

export interface ClosedJsonSnapshotSourceRole {
  projectDirectory: string;
  allowsJavaScriptJsx: boolean;
  hasLodashEmptiness: boolean;
  hasAntdLocaleProvider: boolean;
  axiosVersion: string;
  decoderRole: "browser-native-json";
  sourceResolutionPolicy: ClosedJsonSnapshotSourceResolutionPolicy;
  knownPublicEntryTargets: ReadonlyArray<string>;
}

interface SnapshotVersionBound {
  version: ParsedPackageVersion;
  inclusive: boolean;
}

interface SnapshotVersionInterval {
  lower: SnapshotVersionBound;
  upper: SnapshotVersionBound | null;
}

interface SnapshotDependencyEvidence {
  exactVersion: string | null;
}

interface SnapshotDependencyRole {
  packageName: string;
  minimum?: number[];
  maximum?: number[];
  allowedExactVersions?: readonly string[];
  requireExactVersion?: boolean;
}

const dependencyRoles: SnapshotDependencyRole[] = [
  {
    packageName: "react",
    minimum: SNAPSHOT_ROLE_REACT_MINIMUM,
    maximum: SNAPSHOT_ROLE_REACT_MAXIMUM,
  },
  {
    packageName: "axios",
    minimum: SNAPSHOT_ROLE_AXIOS_MINIMUM,
    maximum: SNAPSHOT_ROLE_AXIOS_MAXIMUM,
    allowedExactVersions: SNAPSHOT_ROLE_HISTORICAL_AXIOS_VERSIONS,
  },
  {
    packageName: "react-router-dom",
    minimum: SNAPSHOT_ROLE_ROUTER_MINIMUM,
    maximum: SNAPSHOT_ROLE_ROUTER_MAXIMUM,
    allowedExactVersions: [SNAPSHOT_ROLE_LEGACY_ROUTER_VERSION],
  },
];

const domRole: SnapshotDependencyRole = {
  packageName: "react-dom",
  minimum: SNAPSHOT_ROLE_DOM_MINIMUM,
  maximum: SNAPSHOT_ROLE_REACT_MAXIMUM,
};
const lodashRole: SnapshotDependencyRole = {
  packageName: "lodash",
  minimum: SNAPSHOT_ROLE_LODASH_MINIMUM,
  maximum: SNAPSHOT_ROLE_LODASH_MAXIMUM,
};
const antdRole: SnapshotDependencyRole = {
  packageName: "antd",
  minimum: SNAPSHOT_ROLE_ANTD_MINIMUM,
  maximum: SNAPSHOT_ROLE_ANTD_MAXIMUM,
};
const sourceRolesByPackageName = new Map(
  [...dependencyRoles, domRole, lodashRole, antdRole].map((role) => [role.packageName, role]),
);

const readFreshBoundedText = (filename: string): string | null => {
  recordContentProbe(filename);
  try {
    const fileStatus = fs.statSync(filename);
    if (!fileStatus.isFile() || fileStatus.size > SNAPSHOT_ROLE_MAX_FILE_BYTES) return null;
    const content = fs.readFileSync(filename, "utf8");
    return Buffer.byteLength(content) <= SNAPSHOT_ROLE_MAX_FILE_BYTES ? content : null;
  } catch {
    return null;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readFreshObjectFile = (filename: string): Record<string, unknown> | null => {
  const content = readFreshBoundedText(filename);
  if (content === null) return null;
  try {
    const manifest: unknown = JSON.parse(content);
    return isRecord(manifest) ? manifest : null;
  } catch {
    return null;
  }
};

const createVersion = (parts: number[]): ParsedPackageVersion => ({
  major: parts[0] ?? 0,
  minor: parts[1] ?? 0,
  patch: parts[2] ?? 0,
  isPrerelease: false,
});

const parseStableVersion = (value: string): ParsedPackageVersion | null => {
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(value)) return null;
  const version = parsePackageVersion(value);
  return version && [version.major, version.minor, version.patch].every(Number.isSafeInteger)
    ? version
    : null;
};

const parseRangeBranch = (branch: string): SnapshotVersionInterval | null => {
  const interval: SnapshotVersionInterval = {
    lower: { version: createVersion([]), inclusive: true },
    upper: null,
  };
  const tokens = branch
    .trim()
    .replace(/(>=|<=|>|<|=|\^|~)\s+/g, "$1")
    .split(/\s+/);
  if (tokens.length === 0) return null;
  for (const token of tokens) {
    const match = /^(>=|<=|>|<|=|\^|~)?((?:0|[1-9]\d*|[xX*])(?:\.(?:0|[1-9]\d*|[xX*])){0,2})$/.exec(
      token,
    );
    if (!match) return null;
    const operator = match[1] ?? "";
    const rawParts = match[2].split(".");
    const wildcardIndex = rawParts.findIndex((part) => /^[xX*]$/.test(part));
    const numericParts = (wildcardIndex < 0 ? rawParts : rawParts.slice(0, wildcardIndex)).map(
      Number,
    );
    if (
      !numericParts.every(Number.isSafeInteger) ||
      (wildcardIndex >= 0 && rawParts.slice(wildcardIndex).some((part) => !/^[xX*]$/.test(part)))
    )
      return null;
    if (numericParts.length === 0) {
      if (operator) return null;
      continue;
    }
    const version = createVersion(numericParts);
    let lower: SnapshotVersionBound | null = null;
    let upper: SnapshotVersionBound | null = null;
    if ([">", ">=", "<", "<="].includes(operator)) {
      if (numericParts.length !== 3 || wildcardIndex >= 0) return null;
      const bound = { version, inclusive: operator.includes("=") };
      if (operator.startsWith(">")) lower = bound;
      else upper = bound;
    } else if (operator === "^" || operator === "~" || numericParts.length < 3) {
      lower = { version, inclusive: true };
      const upperParts = [version.major, version.minor, version.patch];
      const incrementIndex =
        operator === "^"
          ? Math.min(
              numericParts.findIndex((part) => part > 0) < 0
                ? numericParts.length - 1
                : numericParts.findIndex((part) => part > 0),
              numericParts.length - 1,
            )
          : operator === "~"
            ? Math.min(1, numericParts.length - 1)
            : numericParts.length - 1;
      upperParts[incrementIndex] += 1;
      upperParts.fill(0, incrementIndex + 1);
      upper = { version: createVersion(upperParts), inclusive: false };
    } else {
      lower = { version, inclusive: true };
      upper = { version, inclusive: true };
    }
    if (lower) {
      const comparison = comparePackageVersions(lower.version, interval.lower.version);
      if (comparison > 0 || (comparison === 0 && !lower.inclusive)) interval.lower = lower;
    }
    if (upper) {
      const comparison = interval.upper
        ? comparePackageVersions(upper.version, interval.upper.version)
        : -1;
      if (!interval.upper || comparison < 0 || (comparison === 0 && !upper.inclusive))
        interval.upper = upper;
    }
  }
  if (interval.upper) {
    const comparison = comparePackageVersions(interval.lower.version, interval.upper.version);
    if (
      comparison > 0 ||
      (comparison === 0 && !(interval.lower.inclusive && interval.upper.inclusive))
    )
      return null;
  }
  return interval;
};

const parseStableRange = (value: string): SnapshotVersionInterval[] | null => {
  if (!value || value.length > SNAPSHOT_ROLE_MAX_RANGE_CHARACTERS) return null;
  const intervals = value.split("||").map(parseRangeBranch);
  return intervals.every((interval) => interval !== null) ? intervals : null;
};

const intervalContainsVersion = (
  interval: SnapshotVersionInterval,
  version: ParsedPackageVersion,
): boolean => {
  const lowerComparison = comparePackageVersions(version, interval.lower.version);
  if (lowerComparison < 0 || (lowerComparison === 0 && !interval.lower.inclusive)) return false;
  if (!interval.upper) return true;
  const upperComparison = comparePackageVersions(version, interval.upper.version);
  return upperComparison < 0 || (upperComparison === 0 && interval.upper.inclusive);
};

const getDependencyDeclaration = (
  manifest: Record<string, unknown>,
  packageName: string,
): string | null => {
  const declarations = [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.peerDependencies,
    manifest.optionalDependencies,
  ]
    .filter(isRecord)
    .map((section) => section[packageName])
    .filter((declaration) => declaration !== undefined);
  return declarations.length > 0 &&
    declarations.every(
      (declaration) => typeof declaration === "string" && declaration === declarations[0],
    )
    ? String(declarations[0])
    : null;
};

const readUniqueYarnVersion = (
  projectDirectory: string,
  packageName: string,
  declaration: string,
): string | null => {
  const lockText = readFreshBoundedText(path.join(projectDirectory, "yarn.lock"));
  if (lockText === null) return null;
  return (
    readClosedJsonSnapshotYarnResolution({ lockText, packageName, declaration })?.version ?? null
  );
};

const getIntervalExactVersion = (interval: SnapshotVersionInterval): string | null => {
  if (
    !interval.lower.inclusive ||
    !interval.upper?.inclusive ||
    comparePackageVersions(interval.lower.version, interval.upper.version) !== 0
  )
    return null;
  const version = interval.lower.version;
  return `${version.major}.${version.minor}.${version.patch}`;
};

const isReviewedDependencyVersion = (
  version: ParsedPackageVersion,
  role: SnapshotDependencyRole,
): boolean =>
  (role.minimum !== undefined &&
    role.maximum !== undefined &&
    comparePackageVersions(version, createVersion(role.minimum)) >= 0 &&
    comparePackageVersions(version, createVersion(role.maximum)) < 0) ||
  (role.allowedExactVersions?.includes(`${version.major}.${version.minor}.${version.patch}`) ??
    false);

const readSnapshotDependencyEvidence = (
  projectDirectory: string,
  manifest: Record<string, unknown>,
  role: SnapshotDependencyRole,
): SnapshotDependencyEvidence | null => {
  const declaration = getDependencyDeclaration(manifest, role.packageName);
  if (!declaration) return null;
  const intervals = parseStableRange(declaration);
  if (!intervals) return null;
  const declarationContained = intervals.every((interval) => {
    const exactVersion = getIntervalExactVersion(interval);
    if (exactVersion && role.allowedExactVersions?.includes(exactVersion)) return true;
    if (!role.minimum || !role.maximum || !interval.upper) return false;
    return (
      comparePackageVersions(interval.lower.version, createVersion(role.minimum)) >= 0 &&
      (comparePackageVersions(interval.upper.version, createVersion(role.maximum)) < 0 ||
        (comparePackageVersions(interval.upper.version, createVersion(role.maximum)) === 0 &&
          !interval.upper.inclusive))
    );
  });
  const exactDeclaredVersion =
    intervals.length === 1 ? getIntervalExactVersion(intervals[0]) : null;
  if (declarationContained && (!role.requireExactVersion || exactDeclaredVersion))
    return { exactVersion: exactDeclaredVersion };
  for (const competingLock of ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml"]) {
    const lockPath = path.join(projectDirectory, competingLock);
    recordExistenceProbe(lockPath);
    if (fs.existsSync(lockPath)) return null;
  }
  const lockedVersion = readUniqueYarnVersion(projectDirectory, role.packageName, declaration);
  const parsedVersion = lockedVersion === null ? null : parseStableVersion(lockedVersion);
  if (
    !parsedVersion ||
    !intervals.some((interval) => intervalContainsVersion(interval, parsedVersion)) ||
    !isReviewedDependencyVersion(parsedVersion, role)
  )
    return null;
  return { exactVersion: lockedVersion };
};

const hasOrdinaryJsxConvention = (config: unknown): boolean => {
  if (!isRecord(config)) return true;
  const compilerOptions = config.compilerOptions;
  if (isRecord(compilerOptions)) {
    if (
      compilerOptions.jsxFactory !== undefined &&
      compilerOptions.jsxFactory !== "React.createElement"
    )
      return false;
    if (
      compilerOptions.jsxFragmentFactory !== undefined &&
      compilerOptions.jsxFragmentFactory !== "React.Fragment"
    )
      return false;
    if (
      compilerOptions.jsxImportSource !== undefined &&
      compilerOptions.jsxImportSource !== "react"
    )
      return false;
  }
  for (const field of ["presets", "plugins"]) {
    const entries = config[field];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!Array.isArray(entry) || typeof entry[0] !== "string" || !isRecord(entry[1])) continue;
      if (
        ![
          "react",
          "babel-preset-react",
          "@babel/preset-react",
          "transform-react-jsx",
          "babel-plugin-transform-react-jsx",
          "@babel/plugin-transform-react-jsx",
        ].includes(entry[0])
      )
        continue;
      const options = entry[1];
      if (options.pragma !== undefined && options.pragma !== "React.createElement") return false;
      if (options.pragmaFrag !== undefined && options.pragmaFrag !== "React.Fragment") return false;
      if (options.runtime !== undefined && options.runtime !== "classic") return false;
      if (options.importSource !== undefined && options.importSource !== "react") return false;
    }
  }
  if (
    isRecord(config.env) &&
    Object.values(config.env).some((section) => !hasOrdinaryJsxConvention(section))
  )
    return false;
  return !Array.isArray(config.overrides) || config.overrides.every(hasOrdinaryJsxConvention);
};

export const getClosedJsonSnapshotSourceRole = (
  filename: string,
): ClosedJsonSnapshotSourceRole | null => {
  let projectDirectory = path.dirname(path.resolve(filename));
  let manifest: Record<string, unknown> | null = null;
  for (
    let ancestorCount = 0;
    ancestorCount < SNAPSHOT_ROLE_MAX_ANCESTOR_COUNT;
    ancestorCount += 1
  ) {
    const manifestPath = path.join(projectDirectory, "package.json");
    recordExistenceProbe(manifestPath);
    if (fs.existsSync(manifestPath)) {
      manifest = readFreshObjectFile(manifestPath);
      break;
    }
    const parentDirectory = path.dirname(projectDirectory);
    if (parentDirectory === projectDirectory) return null;
    projectDirectory = parentDirectory;
  }
  if (!manifest) return null;
  if (
    Object.hasOwn(manifest, "exports") &&
    typeof manifest.exports !== "string" &&
    !Array.isArray(manifest.exports) &&
    !isRecord(manifest.exports)
  )
    return null;
  const knownPublicEntryTargets = new Set<string>();
  if (!Object.hasOwn(manifest, "exports")) knownPublicEntryTargets.add("./index");
  if (typeof manifest.main === "string" && manifest.main !== "")
    knownPublicEntryTargets.add(manifest.main);
  const pendingEntryValues = ["module", "exports", "browser", "jsnext:main"].map((field) => ({
    value: manifest[field],
    depth: 0,
  }));
  let entryValueCount = 0;
  while (pendingEntryValues.length > 0) {
    const current = pendingEntryValues.pop();
    if (!current) break;
    entryValueCount += 1;
    if (
      entryValueCount > SNAPSHOT_ROLE_MAX_PUBLIC_ENTRY_VALUES ||
      current.depth > SNAPSHOT_ROLE_MAX_PUBLIC_ENTRY_DEPTH
    )
      return null;
    if (typeof current.value === "string" && current.value !== "")
      knownPublicEntryTargets.add(current.value);
    else if (Array.isArray(current.value)) {
      for (const value of current.value)
        pendingEntryValues.push({ value, depth: current.depth + 1 });
    } else if (isRecord(current.value)) {
      for (const value of Object.values(current.value))
        pendingEntryValues.push({ value, depth: current.depth + 1 });
    }
  }

  const pendingReplacements = ["browser", "resolutions", "overrides"].map((field) => ({
    field,
    value: manifest[field],
    depth: 0,
  }));
  let replacementCount = 0;
  while (pendingReplacements.length > 0) {
    const current = pendingReplacements.pop();
    if (!current) break;
    replacementCount += 1;
    if (
      replacementCount > SNAPSHOT_ROLE_MAX_REPLACEMENT_VALUES ||
      current.depth > SNAPSHOT_ROLE_MAX_REPLACEMENT_DEPTH
    )
      return null;
    if (Array.isArray(current.value)) {
      for (const value of current.value)
        pendingReplacements.push({ ...current, value, depth: current.depth + 1 });
      continue;
    }
    if (!isRecord(current.value)) continue;
    for (const [name, replacement] of Object.entries(current.value)) {
      if (SNAPSHOT_KNOWN_SDK_REQUEST_HEADS.includes(name)) {
        const role = sourceRolesByPackageName.get(name);
        if (
          current.field === "browser" ||
          typeof replacement !== "string" ||
          !role ||
          !readSnapshotDependencyEvidence(
            projectDirectory,
            { dependencies: { [name]: replacement } },
            role,
          )
        )
          return null;
      } else if (
        name
          .split(/[*?[\]{}!>\s]+/)
          .some((selector) =>
            SNAPSHOT_KNOWN_SDK_REQUEST_HEADS.some(
              (head) =>
                selector === head ||
                selector.startsWith(`${head}/`) ||
                selector.startsWith(`${head}@`) ||
                selector.endsWith(`/${head}`) ||
                selector.includes(`/${head}@`) ||
                selector.includes(`/${head}/`),
            ),
          )
      )
        return null;
      if (isRecord(replacement) || Array.isArray(replacement))
        pendingReplacements.push({ ...current, value: replacement, depth: current.depth + 1 });
    }
  }
  let axiosVersion = "0.17.0 || 0.17.1 || 0.18.0 || 0.18.1 || >=0.19.0 <0.22.0";
  for (const role of dependencyRoles) {
    const evidence = readSnapshotDependencyEvidence(projectDirectory, manifest, role);
    if (!evidence) return null;
    if (role.packageName === "axios" && evidence.exactVersion) axiosVersion = evidence.exactVersion;
  }
  const domDeclaration = getDependencyDeclaration(manifest, "react-dom");
  const hasDomDeclaration = [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.peerDependencies,
    manifest.optionalDependencies,
  ].some((section) => isRecord(section) && Object.hasOwn(section, "react-dom"));
  if (
    hasDomDeclaration &&
    (!domDeclaration || !readSnapshotDependencyEvidence(projectDirectory, manifest, domRole))
  )
    return null;
  if (manifest.babel !== undefined && !isRecord(manifest.babel)) return null;
  if (!hasOrdinaryJsxConvention(manifest.babel)) return null;
  for (const basename of [
    ".babelrc.js",
    ".babelrc.cjs",
    ".babelrc.mjs",
    "babel.config.js",
    "babel.config.cjs",
    "babel.config.mjs",
  ]) {
    const configPath = path.join(projectDirectory, basename);
    recordExistenceProbe(configPath);
    if (fs.existsSync(configPath)) return null;
  }
  for (const basename of [
    ".babelrc",
    ".babelrc.json",
    "babel.config.json",
    "jsconfig.json",
    "tsconfig.json",
  ]) {
    const configPath = path.join(projectDirectory, basename);
    recordExistenceProbe(configPath);
    if (!fs.existsSync(configPath)) continue;
    const config = readFreshObjectFile(configPath);
    if (!config) return null;
    if (!hasOrdinaryJsxConvention(config) || config.extends !== undefined) return null;
    if (
      basename !== ".babelrc" &&
      config.compilerOptions !== undefined &&
      !isRecord(config.compilerOptions)
    )
      return null;
    if (
      basename !== ".babelrc" &&
      (config.extends !== undefined ||
        config.references !== undefined ||
        (isRecord(config.compilerOptions) &&
          ["baseUrl", "paths", "rootDirs", "moduleSuffixes"].some(
            (key) =>
              config.compilerOptions &&
              isRecord(config.compilerOptions) &&
              config.compilerOptions[key] !== undefined,
          )))
    )
      return null;
  }
  let sourceResolutionPolicy: ClosedJsonSnapshotSourceResolutionPolicy = {
    rootDirectory: projectDirectory,
    extensions: [".js", ".jsx", ".mjs", ".json"],
    aliases: [],
  };
  const scripts = manifest.scripts;
  const command = isRecord(scripts) && typeof scripts.build === "string" ? scripts.build : "";
  const selectors = [...command.matchAll(/(?:^|\s)--config\s+([.\w/-]+\.js)(?=\s|$)/g)];
  const configSwitchCount = [...command.matchAll(/(?:^|\s)--config(?:\s|=|$)/g)].length;
  if (configSwitchCount !== selectors.length || selectors.length > 1) return null;
  const selected = selectors[0]?.[1];
  if (selected?.startsWith("-")) return null;
  const configFilePath = path.resolve(projectDirectory, selected ?? "webpack.config.js");
  const relativeConfigPath = path.relative(projectDirectory, configFilePath);
  if (
    relativeConfigPath === ".." ||
    relativeConfigPath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeConfigPath)
  )
    return null;
  recordExistenceProbe(configFilePath);
  if (selected || fs.existsSync(configFilePath)) {
    const policy = getClosedJsonSnapshotSourceResolutionPolicy({
      rootDirectory: projectDirectory,
      configFilePath,
    });
    if (!policy) return null;
    sourceResolutionPolicy = policy;
  }
  const lodashEvidence = readSnapshotDependencyEvidence(projectDirectory, manifest, lodashRole);
  const antdEvidence = readSnapshotDependencyEvidence(projectDirectory, manifest, antdRole);
  return {
    projectDirectory,
    allowsJavaScriptJsx: true,
    hasLodashEmptiness: lodashEvidence !== null,
    hasAntdLocaleProvider: antdEvidence !== null,
    axiosVersion,
    decoderRole: "browser-native-json",
    sourceResolutionPolicy,
    knownPublicEntryTargets: [...knownPublicEntryTargets],
  };
};
