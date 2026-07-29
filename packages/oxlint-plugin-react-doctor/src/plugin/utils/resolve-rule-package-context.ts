import * as path from "node:path";
import type { RuleContext } from "./rule-context.js";
import type { RulePackageContext, RulePackageDependency } from "./rule-package-context.js";
import { getReactDoctorSetting, getReactDoctorStringSetting } from "./get-react-doctor-setting.js";
import { normalizeFilename } from "./normalize-filename.js";
import { readOwnPropertyValue } from "./read-own-property-value.js";
import { resolveRealPath } from "./resolve-real-path.js";

interface RulePackageContextIndex {
  readonly packagesByDescendingDirectoryLength: ReadonlyArray<RulePackageContext>;
  readonly packageByFilename: Map<string, RulePackageContext | null>;
}

const packageContextIndexes = new WeakMap<object, RulePackageContextIndex | null>();

const isDependencySection = (value: unknown): value is RulePackageDependency["section"] =>
  value === "dependencies" ||
  value === "devDependencies" ||
  value === "peerDependencies" ||
  value === "optionalDependencies";

const parseDependency = (value: unknown): RulePackageDependency | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const name = readOwnPropertyValue(value, "name");
  const section = readOwnPropertyValue(value, "section");
  const rawSpecifier = readOwnPropertyValue(value, "rawSpecifier");
  const resolvedSpecifier = readOwnPropertyValue(value, "resolvedSpecifier");
  if (
    typeof name !== "string" ||
    !isDependencySection(section) ||
    typeof rawSpecifier !== "string" ||
    typeof resolvedSpecifier !== "string"
  ) {
    return null;
  }
  return { name, section, rawSpecifier, resolvedSpecifier };
};

const parsePackageContext = (value: unknown, rootDirectory: string): RulePackageContext | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const relativeDirectory = readOwnPropertyValue(value, "relativeDirectory");
  const capabilityValues = readOwnPropertyValue(value, "capabilities");
  const dependencyValues = readOwnPropertyValue(value, "dependencies");
  if (
    typeof relativeDirectory !== "string" ||
    !Array.isArray(capabilityValues) ||
    !Array.isArray(dependencyValues)
  ) {
    return null;
  }
  const capabilities = new Set(
    capabilityValues.filter(
      (capability): capability is string => typeof capability === "string" && capability.length > 0,
    ),
  );
  const dependencies = dependencyValues
    .map(parseDependency)
    .filter((dependency): dependency is RulePackageDependency => dependency !== null);
  const dependenciesByName = new Map<string, RulePackageDependency>();
  for (const dependency of dependencies) {
    if (!dependenciesByName.has(dependency.name)) {
      dependenciesByName.set(dependency.name, dependency);
    }
  }
  return {
    directory: normalizeFilename(path.resolve(rootDirectory, relativeDirectory)),
    relativeDirectory,
    capabilities,
    dependencies,
    hasCapability: (capability) => capabilities.has(capability),
    hasDependency: (dependencyName) => dependenciesByName.has(dependencyName),
    getDependency: (dependencyName) => dependenciesByName.get(dependencyName) ?? null,
  };
};

const buildPackageContextIndex = (
  settings: RuleContext["settings"],
): RulePackageContextIndex | null => {
  const rootDirectory = getReactDoctorStringSetting(settings, "rootDirectory");
  const packageContextValues = getReactDoctorSetting(settings, "packageContexts");
  if (rootDirectory === undefined || !Array.isArray(packageContextValues)) return null;
  const packages = packageContextValues
    .map((packageContextValue) => parsePackageContext(packageContextValue, rootDirectory))
    .filter((packageContext): packageContext is RulePackageContext => packageContext !== null)
    .toSorted(
      (leftPackage, rightPackage) => rightPackage.directory.length - leftPackage.directory.length,
    );
  return {
    packagesByDescendingDirectoryLength: packages,
    packageByFilename: new Map(),
  };
};

const isNormalizedPathInsideDirectory = (filePath: string, directory: string): boolean =>
  filePath === directory ||
  filePath.startsWith(directory.endsWith("/") ? directory : `${directory}/`);

export const resolveRulePackageContext = (
  settings: RuleContext["settings"],
  filename: string | undefined,
): RulePackageContext | null => {
  if (settings === undefined || filename === undefined || filename.length === 0) return null;
  let packageContextIndex = packageContextIndexes.get(settings);
  if (packageContextIndex === undefined) {
    packageContextIndex = buildPackageContextIndex(settings);
    packageContextIndexes.set(settings, packageContextIndex);
  }
  if (packageContextIndex === null) return null;
  const normalizedFilename = normalizeFilename(path.resolve(filename));
  const cachedPackageContext = packageContextIndex.packageByFilename.get(normalizedFilename);
  if (cachedPackageContext !== undefined) return cachedPackageContext;
  const realFilename = normalizeFilename(resolveRealPath(normalizedFilename));
  const cachedRealPackageContext = packageContextIndex.packageByFilename.get(realFilename);
  if (cachedRealPackageContext !== undefined) {
    packageContextIndex.packageByFilename.set(normalizedFilename, cachedRealPackageContext);
    return cachedRealPackageContext;
  }
  const packageContext =
    packageContextIndex.packagesByDescendingDirectoryLength.find((packageContext) =>
      isNormalizedPathInsideDirectory(realFilename, packageContext.directory),
    ) ?? null;
  packageContextIndex.packageByFilename.set(normalizedFilename, packageContext);
  packageContextIndex.packageByFilename.set(realFilename, packageContext);
  return packageContext;
};
