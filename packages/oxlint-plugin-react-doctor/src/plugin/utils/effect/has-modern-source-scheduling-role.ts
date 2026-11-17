import * as fs from "node:fs";
import * as path from "node:path";
import { CROSS_FILE_DIRECTORY_WALK_MAX_LEVELS } from "../../constants/thresholds.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import type { SourceProjectIndex, SourceProjectModule } from "../build-source-project-index.js";
import { comparePackageVersions } from "../compare-package-versions.js";
import { getContainedDependencyMajor } from "../dependency-version/get-contained-dependency-major.js";
import { recordContentProbe, recordExistenceProbe } from "../cross-file-probe-recorder.js";
import { findTransparentExpressionRoot } from "../find-transparent-expression-root.js";
import type { EsTreeNode } from "../es-tree-node.js";
import { getStaticPropertyKeyName } from "../get-static-property-key-name.js";
import { getStaticPropertyName } from "../get-static-property-name.js";
import { isNodeOfType } from "../is-node-of-type.js";
import { isPathInside } from "../is-path-inside.js";
import { isTypeOnlyImport } from "../is-type-only-import.js";
import { normalizeFilename } from "../normalize-filename.js";
import { parsePackageVersion } from "../parse-package-version.js";
import { parseSourceFile } from "../parse-source-file.js";
import {
  findNearestPackageDirectory,
  readNearestPackageManifest,
  readPackageManifest,
} from "../read-nearest-package-manifest.js";
import type { PackageManifest } from "../read-nearest-package-manifest.js";
import { resolveImportedApiReference } from "../resolve-imported-api-reference.js";
import { resolveModulePath } from "../resolve-module-path.js";
import { resolvePackageVersion } from "../resolve-package-version.js";
import {
  hasStandardReactJsxConfiguration,
  hasTsconfigAliasMapping,
  hasTypeOnlyDefaultExportErasureConfiguration,
} from "../resolve-tsconfig-alias.js";
import type { RuleContext } from "../rule-context.js";
import { stripParenExpression } from "../strip-paren-expression.js";
import { walkAst } from "../walk-ast.js";
import {
  readPnpmLockedRuntimePackageRole,
  type PnpmRuntimeRoleProject,
} from "./read-pnpm-locked-runtime-package-role.js";
import { getPnpmRoleSelectorPackage } from "./modern-source-scheduling-role/get-pnpm-role-selector-package.js";
import {
  MODERN_NEXT_MAJOR,
  TYPE_ONLY_DEFAULT_EXPORT_NEXT_VERSION,
  MODERN_NEXT_CONFIG_NAMES,
  MODERN_NEXT_OUTPUT_MODES,
  MODERN_NEXT_CONST_EXPORT_STATEMENT_COUNT,
  MARKED_RENDERER_MAJOR,
  MARKED_RENDERER_VERSION,
  MARKED_RENDERER_INTEGRITY,
  MARKED_RENDERER_DECLARED_RANGES,
  MARKED_RENDERER_ESM_PATH,
  MARKED_RENDERER_BROWSER_PATH,
  MARKED_RENDERER_TYPES_PATH,
  MARKED_RENDERER_EXPORT_PATHS,
  MARKED_RENDERER_METHOD_NAMES,
  NATIVE_UI_SDK_MAJOR,
  NATIVE_UI_SDK_PACKAGE_BY_SOURCE,
  NATIVE_UI_SDK_MAPPING_FIELDS,
  NATIVE_UI_SDK_MAPPING_CONFIG_NAMES,
  PNPM_ROLE_MAX_BYTES,
  PNPM_ROLE_MAX_LINES,
  PNPM_ROLE_MAX_DEPTH,
  PNPM_ROLE_INDENT_SPACES,
  PNPM_ROLE_MIN_PRINTABLE_CODE_POINT,
  PNPM_ROLE_PROTECTED_PACKAGES,
  RUNTIME_ROLE_DEPENDENCY_FIELDS,
  MODERN_REACT_MAJOR,
  MODERN_REACT_EXPORTS,
  MODERN_REACT_DOM_EXPORTS,
  MODERN_REACT_DOM_CLIENT_EXPORTS,
  MODERN_ROLE_BABEL_CONFIG_NAMES,
  MODERN_ROLE_FORBIDDEN_IMPORTS,
  MODERN_ROLE_LEGACY_METHODS,
  MODERN_ROLE_PACKAGES,
  MODERN_ROLE_ROOT_METHODS,
  MODERN_ROLE_REACT_ONLY_HOOKS,
  PACKAGE_VERSION_SEGMENT_COUNT,
} from "./modern-source-scheduling-role/constants.js";

interface RuntimePackageMappingOptions {
  readonly includeInstalledManifests?: boolean;
}

interface SchedulingRangeBranch {
  readonly minimumMajor: number;
  readonly maximumMajor: number;
}

interface PnpmRoleYamlLine {
  readonly indentation: number;
  readonly text: string;
}

interface PnpmRoleWorkspace {
  readonly directory: string;
  readonly settings: Record<string, unknown>;
}

const parseSchedulingRangeBranch = (branch: string): SchedulingRangeBranch | null => {
  const plainRange = branch.match(/^[~^]?(\d+)(?:\.(\d+|x|\*)){0,2}$/i);
  if (plainRange) {
    const segments = branch.replace(/^[~^]/, "").split(".");
    let didSeeWildcard = false;
    for (const segment of segments) {
      if (/^[x*]$/i.test(segment)) didSeeWildcard = true;
      else if (
        didSeeWildcard ||
        (segment.length > 1 && segment.startsWith("0")) ||
        !Number.isSafeInteger(Number(segment))
      )
        return null;
    }
    const version = parsePackageVersion(branch.replace(/^[~^]/, "").replace(/[x*]/gi, "0"));
    return version ? { minimumMajor: version.major, maximumMajor: version.major } : null;
  }
  const boundedRange = branch.match(
    /^(>=|>)\s*(\d+(?:\.\d+){0,2})\s+(<|<=)\s*(\d+(?:\.\d+){0,2})$/,
  );
  if (!boundedRange) return null;
  const minimumVersion = parsePackageVersion(boundedRange[2]);
  const maximumVersion = parsePackageVersion(boundedRange[4]);
  if (!minimumVersion || !maximumVersion) return null;
  if (
    boundedRange[1] === ">" &&
    boundedRange[2].split(".").length !== PACKAGE_VERSION_SEGMENT_COUNT
  )
    return null;
  if (boundedRange[1] === ">") {
    minimumVersion.patch += 1;
    if (!Number.isSafeInteger(minimumVersion.patch)) return null;
  }
  if (
    [boundedRange[2], boundedRange[4]].some((version) =>
      version
        .split(".")
        .some(
          (segment) =>
            (segment.length > 1 && segment.startsWith("0")) ||
            !Number.isSafeInteger(Number(segment)),
        ),
    )
  )
    return null;
  const comparison = comparePackageVersions(minimumVersion, maximumVersion);
  if (comparison > 0 || (comparison === 0 && boundedRange[3] === "<")) return null;
  const excludesMaximumMajor =
    boundedRange[3] === "<" && maximumVersion.minor === 0 && maximumVersion.patch === 0;
  return {
    minimumMajor: minimumVersion.major,
    maximumMajor: maximumVersion.major - Number(excludesMaximumMajor),
  };
};

const getSchedulingRangeMajor = (declaredRange: string, supportedMajor: number): number | null => {
  const branches = declaredRange
    .trim()
    .split("||")
    .map((branch) => parseSchedulingRangeBranch(branch.trim()));
  if (branches.length === 0 || branches.some((branch) => branch === null)) return null;
  return getContainedDependencyMajor(declaredRange, supportedMajor, {
    normalize: (version) => version,
    minimumMajor: () =>
      Math.min(...branches.map((branch) => branch?.minimumMajor ?? Number.POSITIVE_INFINITY)),
    permitsMajorAbove: (_, latestMajor) =>
      branches.some((branch) => branch !== null && branch.maximumMajor > latestMajor),
  });
};

const hasStandardNextConfigurationProperties = (
  rawNode: EsTreeNode,
  isImagesConfiguration = false,
): boolean => {
  const node = stripParenExpression(rawNode);
  if (!isNodeOfType(node, "ObjectExpression")) return false;
  const propertyNames = new Set<string>();
  for (const property of node.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.kind !== "init" ||
      property.computed ||
      property.method
    )
      return false;
    const propertyName = getStaticPropertyKeyName(property);
    if (!propertyName || propertyNames.has(propertyName)) return false;
    propertyNames.add(propertyName);
    const value = stripParenExpression(property.value);
    if (isImagesConfiguration) {
      if (
        propertyName !== "unoptimized" ||
        !isNodeOfType(value, "Literal") ||
        typeof value.value !== "boolean"
      )
        return false;
      continue;
    }
    if (propertyName === "images") {
      if (!hasStandardNextConfigurationProperties(value, true)) return false;
      continue;
    }
    if (!isNodeOfType(value, "Literal")) return false;
    if (
      propertyName === "output" &&
      typeof value.value === "string" &&
      MODERN_NEXT_OUTPUT_MODES.has(value.value)
    )
      continue;
    if (propertyName === "reactStrictMode" && typeof value.value === "boolean") continue;
    return false;
  }
  return !isImagesConfiguration || propertyNames.has("unoptimized");
};

const hasStandardNextConfiguration = (filename: string): boolean => {
  const packageDirectory = findNearestPackageDirectory(filename);
  if (!packageDirectory) return false;
  return MODERN_NEXT_CONFIG_NAMES.every((configName) => {
    const configPath = path.join(packageDirectory, configName);
    recordExistenceProbe(configPath);
    if (!fs.existsSync(configPath)) return true;
    const programNode = parseSourceFile(configPath);
    if (!programNode || !isNodeOfType(programNode, "Program")) return false;
    const statements = programNode.body.filter(
      (statement) =>
        !isNodeOfType(statement, "EmptyStatement") &&
        !isNodeOfType(statement, "TSInterfaceDeclaration") &&
        !isNodeOfType(statement, "TSTypeAliasDeclaration") &&
        !(isNodeOfType(statement, "ImportDeclaration") && statement.importKind === "type"),
    );
    const defaultExport = statements.at(-1);
    if (!defaultExport || !isNodeOfType(defaultExport, "ExportDefaultDeclaration")) return false;
    const exportedValue = stripParenExpression(defaultExport.declaration);
    if (statements.length === 1) return hasStandardNextConfigurationProperties(exportedValue);
    const declaration = statements[0];
    if (
      statements.length !== MODERN_NEXT_CONST_EXPORT_STATEMENT_COUNT ||
      !declaration ||
      !isNodeOfType(declaration, "VariableDeclaration") ||
      declaration.declare ||
      declaration.kind !== "const" ||
      declaration.declarations.length !== 1 ||
      !isNodeOfType(exportedValue, "Identifier")
    )
      return false;
    const declarator = declaration.declarations[0];
    if (!declarator || !isNodeOfType(declarator.id, "Identifier") || !declarator.init) return false;
    const scopes = analyzeScopes(programNode);
    const symbol = scopes.symbolFor(exportedValue);
    return Boolean(
      symbol &&
      symbol.kind === "const" &&
      symbol.declarationNode === declarator &&
      symbol.references.length === 1 &&
      symbol.references.every(
        (reference) => reference.flag === "read" && reference.identifier === exportedValue,
      ) &&
      hasStandardNextConfigurationProperties(declarator.init),
    );
  });
};

const hasSupportedPackageVersions = (filename: string): boolean => {
  const manifest = readNearestPackageManifest(filename);
  const workspace = readPnpmRoleWorkspace(filename);
  if (
    !manifest ||
    workspace === false ||
    !hasStandardNextConfiguration(filename) ||
    !hasUnaliasedRuntimePackageIdentities(filename)
  )
    return false;
  return MODERN_ROLE_PACKAGES.every((packageName) => {
    const supportedMajor = packageName === "next" ? MODERN_NEXT_MAJOR : MODERN_REACT_MAJOR;
    if (
      !hasUnmappedRuntimePackage(filename, packageName, workspace, supportedMajor, undefined, {
        includeInstalledManifests: false,
      })
    )
      return false;
    const declaredRange =
      manifest.dependencies?.[packageName] ??
      manifest.devDependencies?.[packageName] ??
      manifest.peerDependencies?.[packageName] ??
      manifest.optionalDependencies?.[packageName];
    if (typeof declaredRange !== "string" || /[:/@-]/.test(declaredRange)) return false;
    const resolution = resolvePackageVersion(filename, packageName);
    if (
      !resolution ||
      resolution.version.isPrerelease ||
      resolution.version.major !== supportedMajor
    )
      return false;
    return resolution.declaredRange === null
      ? resolution.installedPackageName === packageName
      : getSchedulingRangeMajor(declaredRange, supportedMajor) === supportedMajor;
  });
};

const isRolePackageSource = (source: string): boolean =>
  MODERN_ROLE_PACKAGES.some(
    (packageName) => source === packageName || source.startsWith(`${packageName}/`),
  );

const isUnsupportedRuntimeSource = (source: string): boolean =>
  [...MODERN_ROLE_FORBIDDEN_IMPORTS].some(
    (packageName) => source === packageName || source.startsWith(`${packageName}/`),
  );

const isSupportedReactRuntimeExport = (source: string, importedName: string): boolean => {
  if (source === "react") return MODERN_REACT_EXPORTS.has(importedName);
  if (source === "react-dom") return MODERN_REACT_DOM_EXPORTS.has(importedName);
  if (source === "react-dom/client") return MODERN_REACT_DOM_CLIENT_EXPORTS.has(importedName);
  return !source.startsWith("react/") && !source.startsWith("react-dom/");
};

const hasStandardSourceTransformConfiguration = (filename: string): boolean => {
  if (!hasStandardReactJsxConfiguration(filename)) return false;
  const manifest = readNearestPackageManifest(filename);
  if (!manifest || "babel" in manifest) return false;
  let currentDirectory = path.dirname(filename);
  for (let level = 0; level < CROSS_FILE_DIRECTORY_WALK_MAX_LEVELS; level += 1) {
    for (const configName of MODERN_ROLE_BABEL_CONFIG_NAMES) {
      const configPath = path.join(currentDirectory, configName);
      recordExistenceProbe(configPath);
      if (fs.existsSync(configPath)) return false;
    }
    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) break;
    if (level === CROSS_FILE_DIRECTORY_WALK_MAX_LEVELS - 1) return false;
    currentDirectory = parentDirectory;
  }
  return true;
};

const hasStandardSourceTransform = (
  module: SourceProjectModule,
  context?: RuleContext,
): boolean => {
  if (!hasStandardSourceTransformConfiguration(module.filePath)) return false;
  let sourceText: string;
  try {
    recordContentProbe(module.filePath);
    sourceText =
      module.programNode === context?.sourceCode?.ast && context?.sourceCode?.getText
        ? context.sourceCode.getText()
        : fs.readFileSync(module.filePath, "utf8");
  } catch {
    return false;
  }
  return !/@jsx(?:ImportSource|Runtime|Frag)?\b/.test(sourceText);
};

const isPnpmRoleRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const splitPnpmRoleText = (text: string, delimiter: string): string[] | null => {
  const parts: string[] = [];
  let quote = "";
  let startIndex = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (quote === '"' && character === "\\") {
        index += 1;
        continue;
      }
      if (quote === "'" && character === "'" && text[index + 1] === "'") {
        index += 1;
        continue;
      }
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character !== delimiter) continue;
    if (delimiter === ":" && text[index + 1] !== undefined && !/\s/.test(text[index + 1])) continue;
    if (delimiter === "#" && index > 0 && !/\s/.test(text[index - 1])) continue;
    parts.push(text.slice(startIndex, index));
    if (delimiter === "#") return parts;
    startIndex = index + 1;
  }
  if (quote) return null;
  parts.push(text.slice(startIndex));
  return parts;
};

const parsePnpmRoleYaml = (source: string): Record<string, unknown> | null => {
  if (Buffer.byteLength(source) > PNPM_ROLE_MAX_BYTES || source.includes("${")) return null;
  for (const character of source) {
    if (
      character.charCodeAt(0) < PNPM_ROLE_MIN_PRINTABLE_CODE_POINT &&
      character !== "\n" &&
      character !== "\r"
    )
      return null;
  }
  const rawLines = source.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (rawLines.length > PNPM_ROLE_MAX_LINES) return null;
  const lines: PnpmRoleYamlLine[] = [];
  for (const rawLine of rawLines) {
    const uncommented = splitPnpmRoleText(rawLine, "#")?.[0];
    if (uncommented === undefined) return null;
    const text = uncommented.trim();
    if (!text) continue;
    const indentation = uncommented.length - uncommented.trimStart().length;
    if (indentation % PNPM_ROLE_INDENT_SPACES !== 0) return null;
    lines.push({ indentation, text });
  }
  const scalar = (text: string, depth: number): unknown => {
    if (depth > PNPM_ROLE_MAX_DEPTH || !text) return undefined;
    if (text === "{}") return {};
    if (text === "[]") return [];
    if (text.startsWith("[")) {
      if (!text.endsWith("]")) return undefined;
      const parts = splitPnpmRoleText(text.slice(1, -1), ",");
      const values = parts?.map((part) => scalar(part.trim(), depth + 1));
      return values &&
        values.every(
          (value) => value !== undefined && !isPnpmRoleRecord(value) && !Array.isArray(value),
        )
        ? values
        : undefined;
    }
    if (text.startsWith('"')) {
      try {
        const value: unknown = JSON.parse(text);
        return typeof value === "string" ? value : undefined;
      } catch {
        return undefined;
      }
    }
    if (text.startsWith("'")) {
      if (!/^'(?:[^']|'')*'$/.test(text)) return undefined;
      return text.slice(1, -1).replaceAll("''", "'");
    }
    if (
      /^[&*!|>{}%@]/.test(text) ||
      /[{}'",]/.test(text) ||
      text.includes("[") ||
      text.includes("]")
    )
      return undefined;
    if (/^true$/i.test(text)) return true;
    if (/^false$/i.test(text)) return false;
    if (/^null$/i.test(text) || text === "~") return null;
    if (/^(?:yes|no|on|off|[+-]?\.inf|\.nan)$/i.test(text)) return undefined;
    if (/^[+-]?(?:(?:\d[\d_]*(?:\.[\d_]*)?|\.[\d_]+)(?:e[+-]?\d+)?|0[xob][0-9a-f_]+)$/i.test(text))
      return Number(text.replaceAll("_", ""));
    return text;
  };
  if (lines.length === 0 || (lines.length === 1 && lines[0]?.text === "{}")) return {};
  let lineIndex = 0;
  const block = (indentation: number, depth: number): unknown => {
    if (depth > PNPM_ROLE_MAX_DEPTH) return undefined;
    const sequence = lines[lineIndex]?.text.startsWith("- ") ?? false;
    const entries: Record<string, unknown> = {};
    const values: unknown[] = [];
    while (lineIndex < lines.length) {
      const line = lines[lineIndex];
      if (!line || line.indentation < indentation) break;
      if (line.indentation !== indentation || sequence !== line.text.startsWith("- "))
        return undefined;
      lineIndex += 1;
      if (sequence) {
        const value = scalar(line.text.slice(PNPM_ROLE_INDENT_SPACES).trim(), depth + 1);
        if (value === undefined || isPnpmRoleRecord(value) || Array.isArray(value))
          return undefined;
        values.push(value);
        continue;
      }
      const parts = splitPnpmRoleText(line.text, ":");
      if (!parts || parts.length !== 2) return undefined;
      const key = scalar(parts[0]?.trim() ?? "", depth + 1);
      if (
        typeof key !== "string" ||
        ["__proto__", "prototype", "constructor", "<<"].includes(key) ||
        Object.hasOwn(entries, key)
      )
        return undefined;
      const valueText = parts[1]?.trim() ?? "";
      if (!valueText && lines[lineIndex]?.indentation !== indentation + PNPM_ROLE_INDENT_SPACES)
        return undefined;
      const value = valueText
        ? scalar(valueText, depth + 1)
        : block(indentation + PNPM_ROLE_INDENT_SPACES, depth + 1);
      if (value === undefined) return undefined;
      entries[key] = value;
    }
    return sequence ? values : entries;
  };
  if (lines[0]?.indentation !== 0) return null;
  const parsed = block(0, 0);
  return lineIndex === lines.length && isPnpmRoleRecord(parsed) ? parsed : null;
};

const hasDisjointPnpmRoleSettings = (
  settings: Record<string, unknown>,
  catalogSettings: Record<string, unknown> | null = settings,
): boolean => {
  const isDisjointSelector = (value: unknown): boolean =>
    typeof value === "string" &&
    Boolean(getPnpmRoleSelectorPackage(value)) &&
    !PNPM_ROLE_PROTECTED_PACKAGES.has(getPnpmRoleSelectorPackage(value) ?? "");
  const isDisjointRange = (value: unknown): boolean => {
    if (typeof value !== "string" || !value || value.includes("${")) return false;
    if (value.startsWith("npm:")) {
      const target = value.slice("npm:".length);
      return isDisjointSelector(target) && !target.includes(":");
    }
    return /^[0-9xX*^~<>=| .+-]+$/.test(value) && /\d|[*xX]/.test(value);
  };
  for (const [name, value] of Object.entries(settings)) {
    if (name === "packages") {
      if (
        !Array.isArray(value) ||
        !value.every(
          (pattern) =>
            typeof pattern === "string" &&
            pattern
              .replace(/^!/, "")
              .split("/")
              .every(
                (segment) =>
                  segment === "." ||
                  segment === "*" ||
                  segment === "**" ||
                  /^[a-zA-Z0-9_@.-]+$/.test(segment),
              ) &&
            !pattern.includes("..") &&
            !pattern.startsWith("/"),
        )
      )
        return false;
      continue;
    }
    if (name === "catalog" || name === "catalogs") {
      if (!isPnpmRoleRecord(value)) return false;
      const catalogs = name === "catalog" ? [value] : Object.values(value);
      if (
        !catalogs.every(
          (catalog) =>
            isPnpmRoleRecord(catalog) &&
            Object.entries(catalog).every(
              ([packageName, range]) =>
                getPnpmRoleSelectorPackage(packageName) === packageName &&
                typeof range === "string" &&
                range.length > 0 &&
                !range.includes("${"),
            ),
        )
      )
        return false;
      continue;
    }
    if (
      name === "linkWorkspacePackages" ||
      name === "preferWorkspacePackages" ||
      name === "injectWorkspacePackages"
    ) {
      if (value !== false) return false;
      continue;
    }
    if (name === "autoInstallPeers") {
      if (typeof value !== "boolean") return false;
      continue;
    }
    if (name === "onlyBuiltDependencies") {
      if (!Array.isArray(value) || !value.every(isDisjointSelector)) return false;
      continue;
    }
    if (name === "overrides") {
      if (
        !isPnpmRoleRecord(value) ||
        !Object.entries(value).every(
          ([selector, range]) =>
            isDisjointSelector(selector) &&
            isDisjointRange(
              resolvePnpmRoleCatalogRange(
                range,
                getPnpmRoleSelectorPackage(selector) ?? "",
                catalogSettings,
              ),
            ),
        )
      )
        return false;
      continue;
    }
    if (name === "peerDependencyRules") {
      if (!isPnpmRoleRecord(value)) return false;
      for (const [rule, entries] of Object.entries(value)) {
        if (rule === "ignoreMissing" || rule === "allowAny") {
          if (!Array.isArray(entries) || !entries.every(isDisjointSelector)) return false;
        } else if (rule === "allowedVersions") {
          if (
            !isPnpmRoleRecord(entries) ||
            !Object.entries(entries).every(
              ([selector, range]) => isDisjointSelector(selector) && isDisjointRange(range),
            )
          )
            return false;
        } else return false;
      }
      continue;
    }
    return false;
  }
  return !(
    Object.hasOwn(settings, "catalog") &&
    isPnpmRoleRecord(settings.catalogs) &&
    Object.hasOwn(settings.catalogs, "default")
  );
};

const readPnpmRoleWorkspace = (filename: string): PnpmRoleWorkspace | null | false => {
  let directory = path.dirname(filename);
  let workspace: PnpmRoleWorkspace | null = null;
  for (let level = 0; level < CROSS_FILE_DIRECTORY_WALK_MAX_LEVELS; level += 1) {
    const workspacePath = path.join(directory, "pnpm-workspace.yaml");
    recordExistenceProbe(workspacePath);
    if (fs.existsSync(workspacePath)) {
      if (workspace) return false;
      recordContentProbe(workspacePath);
      let source: string;
      try {
        if (fs.lstatSync(workspacePath).isSymbolicLink()) return false;
        source = fs.readFileSync(workspacePath, "utf8");
      } catch {
        return false;
      }
      const settings = parsePnpmRoleYaml(source);
      const manifest = readPackageManifest(directory);
      const packageManager =
        manifest && "packageManager" in manifest ? manifest.packageManager : null;
      if (
        !settings ||
        !hasDisjointPnpmRoleSettings(settings) ||
        typeof packageManager !== "string" ||
        !/^pnpm@10\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(packageManager)
      )
        return false;
      workspace = { directory, settings };
    }
    const parent = path.dirname(directory);
    if (parent === directory) return workspace;
    directory = parent;
  }
  return false;
};

const resolvePnpmRoleCatalogRange = (
  range: unknown,
  packageName: string,
  settings: Record<string, unknown> | null,
): string | null => {
  if (typeof range !== "string") return null;
  if (!range.startsWith("catalog:")) return range;
  if (!settings || !/^catalog:[a-zA-Z0-9_.-]*$/.test(range)) return null;
  const name = range.slice("catalog:".length) || "default";
  const named =
    isPnpmRoleRecord(settings.catalogs) && Object.hasOwn(settings.catalogs, name)
      ? settings.catalogs[name]
      : null;
  const catalog = name === "default" ? (settings.catalog ?? named) : named;
  if (!isPnpmRoleRecord(catalog)) return null;
  const resolved = Object.hasOwn(catalog, packageName) ? catalog[packageName] : null;
  return typeof resolved === "string" && !resolved.startsWith("catalog:") ? resolved : null;
};

const hasDistinctLocalDependencyIdentity = (
  locator: string,
  manifestDirectory: string,
  workspace: PnpmRoleWorkspace | null,
): boolean => {
  if (!locator || /[%#?\\]/.test(locator)) return false;
  const directory = path.resolve(manifestDirectory, locator);
  const root = workspace?.directory ?? manifestDirectory;
  if (!isPathInside(directory, root)) return false;
  const normalized = directory.split(path.sep).join("/");
  if (
    [...PNPM_ROLE_PROTECTED_PACKAGES].some(
      (packageName) =>
        normalized.endsWith(`/node_modules/${packageName}`) ||
        normalized.includes(`/node_modules/${packageName}/`),
    )
  )
    return false;
  recordExistenceProbe(directory);
  try {
    const stat = fs.lstatSync(directory);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      !isPathInside(fs.realpathSync(directory), fs.realpathSync(root))
    )
      return false;
  } catch {
    return false;
  }
  const manifest = readPackageManifest(directory);
  return Boolean(
    manifest &&
    typeof manifest.name === "string" &&
    getPnpmRoleSelectorPackage(manifest.name) === manifest.name &&
    !PNPM_ROLE_PROTECTED_PACKAGES.has(manifest.name),
  );
};

const hasProtectedDependencyAliases = (
  manifest: PackageManifest,
  directory: string,
  workspace: PnpmRoleWorkspace | null,
): boolean => {
  for (const field of RUNTIME_ROLE_DEPENDENCY_FIELDS) {
    const dependencies = Reflect.get(manifest, field);
    if (dependencies === undefined) continue;
    if (!isPnpmRoleRecord(dependencies)) return true;
    for (const [name, rawRange] of Object.entries(dependencies)) {
      if (getPnpmRoleSelectorPackage(name) !== name) return true;
      const installedName =
        readPackageManifest(path.join(directory, "node_modules", name))?.name ??
        resolvePackageVersion(path.join(directory, "package.json"), name)?.installedPackageName;
      if (
        typeof installedName === "string" &&
        installedName !== name &&
        PNPM_ROLE_PROTECTED_PACKAGES.has(installedName)
      )
        return true;
      const range = resolvePnpmRoleCatalogRange(
        rawRange,
        name,
        workspace?.settings ?? null,
      )?.trim();
      if (!range) return true;
      if (/^(?:\.{1,2}(?:[/\\]|$)|[/\\]|~[/\\])/.test(range)) {
        if (!hasDistinctLocalDependencyIdentity(range, directory, workspace)) return true;
        continue;
      }
      if (/^npm:/i.test(range)) {
        const target = range.startsWith("npm:")
          ? getPnpmRoleSelectorPackage(range.slice("npm:".length))
          : null;
        if (!target || PNPM_ROLE_PROTECTED_PACKAGES.has(target)) return true;
        continue;
      }
      if (/^(?:file|link):/i.test(range)) {
        const locator = range.slice(range.indexOf(":") + 1);
        if (!hasDistinctLocalDependencyIdentity(locator, directory, workspace)) return true;
        continue;
      }
      if (range.startsWith("workspace:")) {
        const target = range.slice("workspace:".length);
        if (/^(?:\*|\^|~|[~^]?\d+(?:\.\d+){0,2})$/.test(target)) continue;
        if (target.startsWith(".")) {
          if (!hasDistinctLocalDependencyIdentity(target, directory, workspace)) return true;
        } else {
          const targetName = getPnpmRoleSelectorPackage(target);
          if (!targetName || PNPM_ROLE_PROTECTED_PACKAGES.has(targetName)) return true;
        }
        continue;
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(range)) return true;
    }
  }
  return false;
};

const hasUnaliasedRuntimePackageIdentities = (filename: string): boolean => {
  const workspace = readPnpmRoleWorkspace(filename);
  const packageDirectory = findNearestPackageDirectory(filename);
  if (workspace === false || !packageDirectory) return false;
  let directory = packageDirectory;
  for (let level = 0; level < CROSS_FILE_DIRECTORY_WALK_MAX_LEVELS; level += 1) {
    const manifestDirectories = [
      directory,
      ...[...PNPM_ROLE_PROTECTED_PACKAGES].map((packageName) =>
        path.join(directory, "node_modules", packageName),
      ),
    ];
    for (const manifestDirectory of manifestDirectories) {
      const manifest = readPackageManifest(manifestDirectory);
      if (!manifest) {
        if (fs.existsSync(path.join(manifestDirectory, "package.json"))) return false;
        continue;
      }
      if (hasProtectedDependencyAliases(manifest, manifestDirectory, workspace)) return false;
      for (const field of ["overrides", "resolutions", "pnpm"]) {
        if (!(field in manifest)) continue;
        const value = Reflect.get(manifest, field);
        const settings = field === "pnpm" ? value : { overrides: value };
        if (
          !isPnpmRoleRecord(settings) ||
          (field === "pnpm" &&
            (Object.hasOwn(settings, "catalog") || Object.hasOwn(settings, "catalogs"))) ||
          !hasDisjointPnpmRoleSettings(settings, workspace?.settings ?? null)
        )
          return false;
      }
    }
    const parent = path.dirname(directory);
    if (parent === directory) return true;
    directory = parent;
  }
  return false;
};

const hasUnmappedRuntimePackage = (
  filename: string,
  packageName: string,
  workspace: PnpmRoleWorkspace | null,
  supportedMajor = NATIVE_UI_SDK_MAJOR,
  hasSupportedInstalledManifest?: (manifest: PackageManifest) => boolean,
  options?: RuntimePackageMappingOptions,
): boolean => {
  const packageDirectory = findNearestPackageDirectory(filename);
  if (!packageDirectory) return false;
  let currentDirectory = packageDirectory;
  for (let level = 0; level < CROSS_FILE_DIRECTORY_WALK_MAX_LEVELS; level += 1) {
    for (const configName of NATIVE_UI_SDK_MAPPING_CONFIG_NAMES) {
      const configPath = path.join(currentDirectory, configName);
      recordExistenceProbe(configPath);
      if (configName === "pnpm-workspace.yaml" && workspace?.directory === currentDirectory)
        continue;
      if (fs.existsSync(configPath)) return false;
    }
    const manifestDirectories =
      options?.includeInstalledManifests === false
        ? [currentDirectory]
        : [currentDirectory, path.join(currentDirectory, "node_modules", packageName)];
    for (const manifestDirectory of manifestDirectories) {
      const manifest = readPackageManifest(manifestDirectory);
      if (manifest) {
        for (const field of NATIVE_UI_SDK_MAPPING_FIELDS) {
          if (!(field in manifest)) continue;
          const value = Reflect.get(manifest, field);
          if (
            field === "browser" &&
            manifestDirectory !== currentDirectory &&
            hasSupportedInstalledManifest?.(manifest)
          ) {
            continue;
          } else if (field === "overrides" || field === "resolutions") {
            if (!hasDisjointPnpmRoleSettings({ overrides: value }, workspace?.settings ?? null))
              return false;
          } else if (field === "pnpm") {
            if (
              !isPnpmRoleRecord(value) ||
              Object.hasOwn(value, "catalog") ||
              Object.hasOwn(value, "catalogs") ||
              !hasDisjointPnpmRoleSettings(value, workspace?.settings ?? null)
            )
              return false;
          } else return false;
        }
        if ("dependenciesMeta" in manifest) {
          const metadata = manifest.dependenciesMeta;
          if (!isPnpmRoleRecord(metadata)) return false;
          const sdkMetadata = metadata[packageName];
          if (
            sdkMetadata !== undefined &&
            (!isPnpmRoleRecord(sdkMetadata) ||
              sdkMetadata.injected !== false ||
              Object.keys(sdkMetadata).some((key) => key !== "injected"))
          )
            return false;
        }
        if (manifestDirectory !== currentDirectory) {
          const version =
            typeof manifest.version === "string" ? parsePackageVersion(manifest.version) : null;
          if (
            manifest.name !== packageName ||
            !version ||
            version.isPrerelease ||
            version.major !== supportedMajor ||
            (hasSupportedInstalledManifest && !hasSupportedInstalledManifest(manifest))
          )
            return false;
        }
      }
      if (!manifest && fs.existsSync(path.join(manifestDirectory, "package.json"))) return false;
    }
    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) return true;
    currentDirectory = parentDirectory;
  }
  return false;
};

export const hasSupportedNativeUiSdkRole = (filename: string, source: string): boolean => {
  const packageName = NATIVE_UI_SDK_PACKAGE_BY_SOURCE.get(source);
  if (!packageName || !filename || !path.isAbsolute(filename)) return false;
  const manifest = readNearestPackageManifest(filename);
  const workspace = readPnpmRoleWorkspace(filename);
  if (
    !manifest ||
    workspace === false ||
    !hasUnaliasedRuntimePackageIdentities(filename) ||
    manifest.name === packageName ||
    !hasStandardNextConfiguration(filename) ||
    !hasStandardSourceTransformConfiguration(filename) ||
    !hasUnmappedRuntimePackage(filename, packageName, workspace)
  )
    return false;
  if (
    [source, packageName].some(
      (specifier) =>
        hasTsconfigAliasMapping(filename, specifier) ||
        resolveModulePath(filename, specifier) !== null,
    )
  )
    return false;
  const declaredRanges = [
    manifest.dependencies?.[packageName],
    manifest.devDependencies?.[packageName],
    manifest.peerDependencies?.[packageName],
    manifest.optionalDependencies?.[packageName],
  ].filter((range) => range !== undefined);
  if (
    ![
      manifest.dependencies?.[packageName],
      manifest.devDependencies?.[packageName],
      manifest.optionalDependencies?.[packageName],
    ].some((range) => range !== undefined)
  )
    return false;
  if (
    declaredRanges.length === 0 ||
    declaredRanges.some(
      (range) =>
        getSchedulingRangeMajor(
          resolvePnpmRoleCatalogRange(range, packageName, workspace?.settings ?? null) ?? "",
          NATIVE_UI_SDK_MAJOR,
        ) !== NATIVE_UI_SDK_MAJOR,
    )
  )
    return false;
  const resolution = resolvePackageVersion(filename, packageName);
  return (
    !resolution ||
    Boolean(
      !resolution.version.isPrerelease &&
      resolution.version.major === NATIVE_UI_SDK_MAJOR &&
      (resolution.declaredRange !== null || resolution.installedPackageName === packageName),
    )
  );
};

const hasPinnedMarkedRendererManifest = (manifest: PackageManifest): boolean => {
  const exports = manifest.exports;
  if (
    manifest.name !== "marked" ||
    manifest.version !== MARKED_RENDERER_VERSION ||
    Reflect.get(manifest, "type") !== "module" ||
    manifest.main !== MARKED_RENDERER_ESM_PATH ||
    manifest.module !== MARKED_RENDERER_ESM_PATH ||
    Reflect.get(manifest, "browser") !== MARKED_RENDERER_BROWSER_PATH ||
    !isPnpmRoleRecord(exports) ||
    Object.keys(exports).length !== MARKED_RENDERER_EXPORT_PATHS.size + 1 ||
    ![...MARKED_RENDERER_EXPORT_PATHS].every(([name, target]) => exports[name] === target)
  )
    return false;
  const entrypoint = exports["."];
  return Boolean(
    isPnpmRoleRecord(entrypoint) &&
    Object.keys(entrypoint).every((name) => name === "types" || name === "default") &&
    entrypoint.types === MARKED_RENDERER_TYPES_PATH &&
    entrypoint.default === MARKED_RENDERER_ESM_PATH,
  );
};

export const hasSupportedReadonlySourcePrototypeRole = (
  filename: string,
  source: string,
  exportName: string,
  methodName: string,
  projectIndex: SourceProjectIndex,
): boolean => {
  if (
    source !== "marked" ||
    exportName !== "Renderer" ||
    !MARKED_RENDERER_METHOD_NAMES.has(methodName) ||
    !filename ||
    !path.isAbsolute(filename) ||
    !projectIndex.modulesByFilePath.has(normalizeFilename(filename))
  )
    return false;
  const projects = new Map<string, PnpmRuntimeRoleProject>();
  for (const module of projectIndex.modulesByFilePath.values()) {
    const workspace = readPnpmRoleWorkspace(module.filePath);
    const packageDirectory = findNearestPackageDirectory(module.filePath);
    if (
      workspace === false ||
      !packageDirectory ||
      !hasUnaliasedRuntimePackageIdentities(module.filePath) ||
      !hasUnmappedRuntimePackage(
        module.filePath,
        source,
        workspace,
        MARKED_RENDERER_MAJOR,
        hasPinnedMarkedRendererManifest,
      )
    )
      return false;
    if (!projects.has(packageDirectory)) {
      const lockDirectory = workspace?.directory ?? packageDirectory;
      projects.set(packageDirectory, {
        packageDirectory,
        lockDirectory,
        hasDisjointOverrides: (overrides) =>
          hasDisjointPnpmRoleSettings({ overrides }, workspace?.settings ?? null),
      });
    }
  }
  const manifest = readNearestPackageManifest(filename);
  const workspace = readPnpmRoleWorkspace(filename);
  if (
    !manifest ||
    workspace === false ||
    manifest.name === source ||
    !hasUnaliasedRuntimePackageIdentities(filename) ||
    !hasStandardNextConfiguration(filename) ||
    !hasStandardSourceTransformConfiguration(filename) ||
    hasTsconfigAliasMapping(filename, source) ||
    resolveModulePath(filename, source) !== null ||
    !hasUnmappedRuntimePackage(
      filename,
      source,
      workspace,
      MARKED_RENDERER_MAJOR,
      hasPinnedMarkedRendererManifest,
    )
  )
    return false;
  if (
    ![manifest.dependencies, manifest.devDependencies, manifest.optionalDependencies].some(
      (dependencies) => dependencies?.[source] !== undefined,
    )
  )
    return false;
  const declaredRanges = RUNTIME_ROLE_DEPENDENCY_FIELDS.flatMap((field) => {
    const dependencies = Reflect.get(manifest, field);
    return isPnpmRoleRecord(dependencies) && dependencies[source] !== undefined
      ? [dependencies[source]]
      : [];
  });
  if (
    declaredRanges.length === 0 ||
    declaredRanges.some(
      (range) =>
        !MARKED_RENDERER_DECLARED_RANGES.has(
          resolvePnpmRoleCatalogRange(range, source, workspace?.settings ?? null)?.trim() ?? "",
        ),
    )
  )
    return false;
  const packageDirectory = findNearestPackageDirectory(filename);
  if (!packageDirectory) return false;
  const catalogSpecifiers = new Map<string, string>();
  for (const range of declaredRanges) {
    if (typeof range !== "string" || !range.startsWith("catalog:")) continue;
    const resolved = resolvePnpmRoleCatalogRange(range, source, workspace?.settings ?? null);
    if (!resolved) return false;
    catalogSpecifiers.set(range, resolved.trim());
  }
  const lockRole = readPnpmLockedRuntimePackageRole({
    packageDirectory,
    packageName: source,
    version: MARKED_RENDERER_VERSION,
    integrity: MARKED_RENDERER_INTEGRITY,
    catalogSpecifiers,
    projects: [...projects.values()],
  });
  if (
    lockRole.hasContradiction ||
    (lockRole.didFindLockfile && !lockRole.hasSupportedResolution) ||
    (!lockRole.hasSupportedResolution &&
      declaredRanges.some(
        (range) =>
          resolvePnpmRoleCatalogRange(range, source, workspace?.settings ?? null)?.trim() !==
          MARKED_RENDERER_VERSION,
      ))
  )
    return false;
  const resolution = resolvePackageVersion(filename, source);
  const supportedVersion = parsePackageVersion(MARKED_RENDERER_VERSION);
  return Boolean(
    !resolution ||
    (supportedVersion &&
      (resolution.declaredRange !== null || resolution.installedPackageName === source) &&
      !resolution.version.isPrerelease &&
      comparePackageVersions(resolution.version, supportedVersion) === 0),
  );
};

const hasContradictoryModuleSurface = (
  module: SourceProjectModule,
  context: RuleContext,
): boolean => {
  if (!hasStandardSourceTransform(module, context)) return true;
  let hasContradiction = false;
  walkAst(module.programNode, (node) => {
    if (hasContradiction) return;
    if (
      isNodeOfType(node, "TSImportEqualsDeclaration") ||
      isNodeOfType(node, "TSExternalModuleReference")
    ) {
      hasContradiction = true;
      return;
    }
    if (isNodeOfType(node, "ImportDeclaration") && !isTypeOnlyImport(node)) {
      const source = node.source.value;
      if (typeof source !== "string") return;
      if (isUnsupportedRuntimeSource(source)) {
        hasContradiction = true;
        return;
      }
      if (!isRolePackageSource(source)) return;
      if (
        node.specifiers.some((specifier) => {
          if (!isNodeOfType(specifier, "ImportSpecifier") || specifier.importKind === "type")
            return false;
          const imported = resolveImportedApiReference(specifier.local, module.scopes);
          return (
            !imported?.importedName || !isSupportedReactRuntimeExport(source, imported.importedName)
          );
        })
      )
        hasContradiction = true;
      if (
        source !== "react" &&
        node.specifiers.some((specifier) => {
          const imported = resolveImportedApiReference(specifier.local, module.scopes);
          return Boolean(
            imported?.importedName && MODERN_ROLE_REACT_ONLY_HOOKS.has(imported.importedName),
          );
        })
      )
        hasContradiction = true;
      if (
        hasTsconfigAliasMapping(module.filePath, source) ||
        resolveModulePath(module.filePath, source) !== null ||
        !hasSupportedPackageVersions(module.filePath)
      ) {
        hasContradiction = true;
      }
      return;
    }
    if (
      (isNodeOfType(node, "ExportNamedDeclaration") ||
        isNodeOfType(node, "ExportAllDeclaration")) &&
      node.exportKind !== "type" &&
      node.source &&
      typeof node.source.value === "string" &&
      (isRolePackageSource(node.source.value) || isUnsupportedRuntimeSource(node.source.value))
    ) {
      hasContradiction = true;
      return;
    }
    if (isNodeOfType(node, "Identifier")) {
      if (
        (node.name === "require" || node.name === "module") &&
        module.scopes.isGlobalReference(node)
      ) {
        hasContradiction = true;
        return;
      }
      const reference = module.scopes.referenceFor(node);
      const imported = resolveImportedApiReference(node, module.scopes);
      if (!reference || !imported || !isRolePackageSource(imported.source)) return;
      if (reference.flag !== "read") {
        hasContradiction = true;
        return;
      }
      const expression = findTransparentExpressionRoot(node);
      const parent = expression.parent;
      if (!parent) return;
      if (
        (imported.isNamespace || imported.importedName === "default") &&
        !(isNodeOfType(parent, "MemberExpression") && parent.object === expression) &&
        !(
          isNodeOfType(parent, "VariableDeclarator") &&
          parent.init === expression &&
          isNodeOfType(parent.id, "Identifier") &&
          module.scopes.symbolFor(parent.id)?.kind === "const"
        )
      ) {
        hasContradiction = true;
      }
      if (
        (imported.isNamespace || imported.importedName === "default") &&
        isNodeOfType(parent, "MemberExpression") &&
        parent.object === expression &&
        getStaticPropertyName(parent) === null
      )
        hasContradiction = true;
    }
    if (isNodeOfType(node, "Identifier") || isNodeOfType(node, "MemberExpression")) {
      const imported = resolveImportedApiReference(node, module.scopes);
      if (
        imported &&
        !imported.isNamespace &&
        imported.importedName &&
        imported.importedName !== "default" &&
        !isSupportedReactRuntimeExport(imported.source, imported.importedName)
      ) {
        hasContradiction = true;
        return;
      }
      if (imported?.source.startsWith("react-dom") && imported.importedName) {
        if (MODERN_ROLE_LEGACY_METHODS.has(imported.importedName)) hasContradiction = true;
        if (MODERN_ROLE_ROOT_METHODS.has(imported.importedName)) {
          const expression = findTransparentExpressionRoot(node);
          const parent = expression.parent;
          if (
            parent &&
            !(isNodeOfType(parent, "CallExpression") && parent.callee === expression) &&
            !(
              isNodeOfType(parent, "VariableDeclarator") &&
              parent.init === expression &&
              isNodeOfType(parent.id, "Identifier")
            ) &&
            !isNodeOfType(parent, "ImportSpecifier")
          )
            hasContradiction = true;
        }
      }
    }
    if (
      isNodeOfType(node, "AssignmentExpression") ||
      isNodeOfType(node, "UpdateExpression") ||
      (isNodeOfType(node, "UnaryExpression") && node.operator === "delete")
    ) {
      const target = isNodeOfType(node, "AssignmentExpression") ? node.left : node.argument;
      let receiver = target;
      while (isNodeOfType(receiver, "MemberExpression")) receiver = receiver.object;
      const imported = resolveImportedApiReference(receiver, module.scopes);
      if (imported && isRolePackageSource(imported.source)) hasContradiction = true;
    }
    if (isNodeOfType(node, "CallExpression")) {
      if (
        node.arguments.some(
          (argument) =>
            isNodeOfType(argument, "Literal") &&
            typeof argument.value === "string" &&
            (isRolePackageSource(argument.value) || isUnsupportedRuntimeSource(argument.value)),
        )
      ) {
        hasContradiction = true;
        return;
      }
      const imported = resolveImportedApiReference(node.callee, module.scopes);
      if (
        imported &&
        imported.source !== "react" &&
        imported.importedName &&
        MODERN_ROLE_REACT_ONLY_HOOKS.has(imported.importedName)
      ) {
        hasContradiction = true;
        return;
      }
      if (!imported || !imported.source.startsWith("react-dom")) return;
      if (imported.importedName && MODERN_ROLE_LEGACY_METHODS.has(imported.importedName))
        hasContradiction = true;
      if (
        imported.importedName &&
        MODERN_ROLE_ROOT_METHODS.has(imported.importedName) &&
        (imported.source !== "react-dom/client" ||
          node.arguments.length !== (imported.importedName === "hydrateRoot" ? 2 : 1))
      ) {
        hasContradiction = true;
      }
    }
    if (
      isNodeOfType(node, "ImportExpression") &&
      (!isNodeOfType(node.source, "Literal") ||
        typeof node.source.value !== "string" ||
        isRolePackageSource(node.source.value) ||
        isUnsupportedRuntimeSource(node.source.value))
    )
      hasContradiction = true;
  });
  return hasContradiction;
};

export const hasModernSourceSchedulingRole = (
  context: RuleContext,
  projectIndex: SourceProjectIndex,
): boolean => {
  if (!context.filename || !hasSupportedPackageVersions(context.filename)) return false;
  if (projectIndex.hasOpaqueMdxConsumerSurface || projectIndex.htmlFilePaths.length > 0)
    return false;
  let hasReactImport = false;
  for (const module of projectIndex.modulesByFilePath.values()) {
    if (hasContradictoryModuleSurface(module, context)) return false;
    hasReactImport ||= module.programNode.body.some(
      (statement) =>
        isNodeOfType(statement, "ImportDeclaration") &&
        !isTypeOnlyImport(statement) &&
        statement.source.value === "react",
    );
  }
  return hasReactImport;
};

export const hasSupportedTypeOnlyDefaultExportEmission = (
  module: SourceProjectModule,
  projectRoot: string,
): boolean => {
  const normalizedProjectRoot = normalizeFilename(path.resolve(projectRoot));
  const nearestPackageDirectory = findNearestPackageDirectory(module.filePath);
  if (
    !isPathInside(path.resolve(module.filePath), path.resolve(projectRoot)) ||
    !nearestPackageDirectory ||
    normalizeFilename(path.resolve(nearestPackageDirectory)) !== normalizedProjectRoot ||
    !hasSupportedPackageVersions(module.filePath) ||
    !hasStandardSourceTransform(module) ||
    !hasTypeOnlyDefaultExportErasureConfiguration(projectRoot)
  )
    return false;
  const resolution = resolvePackageVersion(module.filePath, "next");
  if (!resolution || resolution.version.isPrerelease) return false;
  if (resolution.declaredRange !== null)
    return resolution.declaredRange === TYPE_ONLY_DEFAULT_EXPORT_NEXT_VERSION;
  return (
    resolution.installedPackageName === "next" &&
    `${resolution.version.major}.${resolution.version.minor}.${resolution.version.patch}` ===
      TYPE_ONLY_DEFAULT_EXPORT_NEXT_VERSION
  );
};
