import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import * as ts from "typescript";
import { ES2023_YEAR, ES_TARGET_YEAR_BY_NAME, TSCONFIG_EXTENDS_MAX_DEPTH } from "../constants.js";
import type { Framework, PackageJson } from "../types/index.js";
import { isProjectBoundary } from "../utils/is-project-boundary.js";
import { isFile, isPlainObject } from "./fs-utils.js";
import { readPackageJson } from "./package-json.js";

const TSCONFIG_FILENAME = "tsconfig.json";

interface TsConfigCompilerOptions {
  readonly target?: string;
  readonly lib?: readonly string[];
  readonly hasExplicitLib: boolean;
}

interface TsConfigShape {
  readonly extends?: string;
  readonly referencePaths: readonly string[];
  readonly compilerOptions: TsConfigCompilerOptions;
}

const isRelativeExtendsValue = (extendsValue: string): boolean =>
  extendsValue.startsWith("./") || extendsValue.startsWith("../") || path.isAbsolute(extendsValue);

const ensureJsonExtension = (filePath: string): string =>
  path.extname(filePath) === "" ? `${filePath}.json` : filePath;

const resolvePackageExtendsPath = (
  extendsValue: string,
  fromConfigDirectory: string,
): string | null => {
  const requireFromConfig = createRequire(path.join(fromConfigDirectory, "tsconfig.json"));
  const candidates = [
    extendsValue,
    ensureJsonExtension(extendsValue),
    `${extendsValue.replace(/\/$/, "")}/tsconfig.json`,
  ];

  for (const candidate of candidates) {
    try {
      return requireFromConfig.resolve(candidate);
    } catch {
      continue;
    }
  }

  return null;
};

const resolveExtendsPath = (extendsValue: string, fromConfigDirectory: string): string | null => {
  if (isRelativeExtendsValue(extendsValue)) {
    return ensureJsonExtension(path.resolve(fromConfigDirectory, extendsValue));
  }

  return resolvePackageExtendsPath(extendsValue, fromConfigDirectory);
};

const normalizeCompilerOptions = (compilerOptions: unknown): TsConfigCompilerOptions => {
  if (!isPlainObject(compilerOptions)) return { hasExplicitLib: false };

  const target = typeof compilerOptions.target === "string" ? compilerOptions.target : undefined;
  const hasExplicitLib = Object.hasOwn(compilerOptions, "lib");
  const lib = Array.isArray(compilerOptions.lib)
    ? compilerOptions.lib.filter((entry): entry is string => typeof entry === "string")
    : undefined;

  return { target, lib, hasExplicitLib };
};

const readTsConfig = (filePath: string): TsConfigShape | null => {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const parsed = ts.parseConfigFileTextToJson(filePath, content);
  if (!isPlainObject(parsed.config)) return null;

  return {
    extends: typeof parsed.config.extends === "string" ? parsed.config.extends : undefined,
    referencePaths: normalizeReferencePaths(parsed.config.references),
    compilerOptions: normalizeCompilerOptions(parsed.config.compilerOptions),
  };
};

const normalizeReferencePaths = (references: unknown): string[] => {
  if (!Array.isArray(references)) return [];
  return references
    .map((reference) =>
      isPlainObject(reference) && typeof reference.path === "string" ? reference.path : null,
    )
    .filter((referencePath): referencePath is string => referencePath !== null);
};

const mergeCompilerOptions = (
  inherited: TsConfigCompilerOptions | null,
  current: TsConfigCompilerOptions,
): TsConfigCompilerOptions => {
  const target = current.target ?? inherited?.target;
  const hasExplicitLib = current.hasExplicitLib || Boolean(inherited?.hasExplicitLib);
  const lib = current.hasExplicitLib ? current.lib : inherited?.lib;
  return { target, lib, hasExplicitLib };
};

const readResolvedCompilerOptions = (
  tsConfigPath: string,
  extendsDepth: number,
  visitedPaths: ReadonlySet<string>,
): TsConfigCompilerOptions | null => {
  const realPath = fs.realpathSync.native(tsConfigPath);
  if (visitedPaths.has(realPath)) return null;

  const tsConfig = readTsConfig(realPath);
  if (!tsConfig) return null;

  const nextVisitedPaths = new Set(visitedPaths);
  nextVisitedPaths.add(realPath);

  if (tsConfig.extends && extendsDepth < TSCONFIG_EXTENDS_MAX_DEPTH) {
    const parentPath = resolveExtendsPath(tsConfig.extends, path.dirname(realPath));
    if (parentPath && isFile(parentPath)) {
      const inherited = readResolvedCompilerOptions(parentPath, extendsDepth + 1, nextVisitedPaths);
      return mergeCompilerOptions(inherited, tsConfig.compilerOptions);
    }
  }

  return tsConfig.compilerOptions;
};

const targetYearIsPreES2023 = (target: string): boolean => {
  const year = ES_TARGET_YEAR_BY_NAME[target.toLowerCase()];
  return year !== undefined && year < ES2023_YEAR;
};

const libEntryIncludesES2023Array = (entry: string): boolean => {
  const normalizedEntry = entry.toLowerCase();
  if (normalizedEntry === "esnext" || normalizedEntry === "esnext.array") return true;
  const esYearMatch = /^es(\d{4})(?:\.(.+))?$/.exec(normalizedEntry);
  if (!esYearMatch) return false;

  const year = Number(esYearMatch[1]);
  if (year < ES2023_YEAR) return false;

  const component = esYearMatch[2];
  return component === undefined || component === "array";
};

const libIncludesES2023 = (lib: ReadonlyArray<string>): boolean =>
  lib.some(libEntryIncludesES2023Array);

const compilerOptionsArePreES2023 = (compilerOptions: TsConfigCompilerOptions): boolean => {
  if (compilerOptions.target) {
    return targetYearIsPreES2023(compilerOptions.target);
  }

  if (compilerOptions.hasExplicitLib) {
    return !libIncludesES2023(compilerOptions.lib ?? []);
  }

  return false;
};

const compilerOptionsDeclareTargetOrLib = (compilerOptions: TsConfigCompilerOptions): boolean =>
  compilerOptions.hasExplicitLib || compilerOptions.target !== undefined;

const detectPreES2023FromConfig = (
  tsConfigPath: string,
  visitedConfigPaths: ReadonlySet<string> = new Set(),
): boolean => {
  if (visitedConfigPaths.has(tsConfigPath)) return false;
  const compilerOptions = readResolvedCompilerOptions(tsConfigPath, 0, new Set());
  if (!compilerOptions) return false;
  if (!compilerOptionsDeclareTargetOrLib(compilerOptions)) {
    const tsConfig = readTsConfig(tsConfigPath);
    if (!tsConfig) return false;
    const nextVisitedConfigPaths = new Set(visitedConfigPaths);
    nextVisitedConfigPaths.add(tsConfigPath);
    const configDirectory = path.dirname(tsConfigPath);
    return tsConfig.referencePaths.some((referencePath) => {
      const resolvedReferencePath = path.resolve(configDirectory, referencePath);
      const referencedConfigPath = isFile(resolvedReferencePath)
        ? resolvedReferencePath
        : path.join(resolvedReferencePath, TSCONFIG_FILENAME);
      return (
        isFile(referencedConfigPath) &&
        detectPreES2023FromConfig(referencedConfigPath, nextVisitedConfigPaths)
      );
    });
  }
  return compilerOptionsArePreES2023(compilerOptions);
};

export const detectPreES2023Target = (directory: string): boolean => {
  const tsConfigPath = path.join(directory, TSCONFIG_FILENAME);
  if (isFile(tsConfigPath)) return detectPreES2023FromConfig(tsConfigPath);

  for (const fallbackFilename of FALLBACK_TSCONFIG_FILENAMES) {
    const fallbackPath = path.join(directory, fallbackFilename);
    if (isFile(fallbackPath)) return detectPreES2023FromConfig(fallbackPath);
  }

  return false;
};

const FALLBACK_TSCONFIG_FILENAMES = ["tsconfig.app.json", "tsconfig.build.json"] as const;

const FRAMEWORK_PACKAGES: Record<string, Framework> = {
  next: "nextjs",
  "@tanstack/react-start": "tanstack-start",
  vite: "vite",
  "react-scripts": "cra",
  "@remix-run/react": "remix",
  gatsby: "gatsby",
  expo: "expo",
  "react-native": "react-native",
};

const FRAMEWORK_DISPLAY_NAMES: Record<Framework, string> = {
  nextjs: "Next.js",
  "tanstack-start": "TanStack Start",
  vite: "Vite",
  cra: "Create React App",
  remix: "Remix",
  gatsby: "Gatsby",
  expo: "Expo",
  "react-native": "React Native",
  preact: "Preact",
  unknown: "React",
};

export const formatFrameworkName = (framework: Framework): string =>
  FRAMEWORK_DISPLAY_NAMES[framework];

// Preact is treated as a framework only when no React-based framework
// (`next` / `vite` / `react-scripts` / …) AND no `react` itself is
// present — i.e. a pure-Preact codebase with no bundler manifest react-
// doctor recognises. Component libraries that list both `react` and
// `preact` as peer deps stay `unknown`, which is what they were before
// this branch existed; they still pick up a non-null `preactVersion`
// (see `discover-project.ts`) so Preact-bucket rules activate without
// overwriting the framework classification.
export const detectFramework = (dependencies: Record<string, string>): Framework => {
  for (const [packageName, frameworkName] of Object.entries(FRAMEWORK_PACKAGES)) {
    if (dependencies[packageName]) {
      return frameworkName;
    }
  }
  if (dependencies.preact && !dependencies.react) {
    return "preact";
  }
  return "unknown";
};

const MOBILE_FRAMEWORKS: ReadonlySet<Framework> = new Set(["expo", "react-native"]);

// The cross-workspace merge tier: a monorepo whose `apps/mobile` is Expo and
// `apps/web` is Next.js classifies by the WEB framework no matter which
// workspace the walk visits first — the same web-over-mobile priority
// `detectFramework` applies within one manifest. Web wins because it's
// coverage-maximizing: `rn-*` / Expo rules still load via
// `hasReactNativeWorkspace` / `expoVersion`, while the web framework's rules
// gate on this classification alone. Within a tier (two web apps, or two
// mobile apps) the first workspace in walk order keeps the slot; `unknown`
// never displaces anything.
export const frameworkMergeRank = (framework: Framework): number => {
  if (framework === "unknown") return 3;
  return MOBILE_FRAMEWORKS.has(framework) ? 2 : 1;
};

const REACT_COMPILER_PACKAGES = new Set([
  "babel-plugin-react-compiler",
  "react-compiler-runtime",
  "eslint-plugin-react-compiler",
]);

const NEXT_CONFIG_FILENAMES = [
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "next.config.cjs",
];

const BABEL_CONFIG_FILENAMES = [
  ".babelrc",
  ".babelrc.json",
  "babel.config.js",
  "babel.config.json",
  "babel.config.cjs",
  "babel.config.mjs",
];

const VITE_CONFIG_FILENAMES = [
  "vite.config.js",
  "vite.config.ts",
  "vite.config.mjs",
  "vite.config.mts",
  "vite.config.cjs",
  "vite.config.cts",
  "vitest.config.ts",
  "vitest.config.js",
];

const EXPO_APP_CONFIG_FILENAMES = ["app.json", "app.config.js", "app.config.ts"];

const REACT_COMPILER_PACKAGE_REFERENCE_PATTERN =
  /babel-plugin-react-compiler|react-compiler-runtime|eslint-plugin-react-compiler|["']react-compiler["']/;
const REACT_COMPILER_ENABLED_FLAG_PATTERN = /["']?reactCompiler["']?\s*:\s*(?:true\b|\{)/;

// `output: "export"` (static HTML export) in next.config.*. The leading
// `(?:^|[^.\w])` boundary keeps it from matching a nested/namespaced key like
// `experimental.output` or `outputFileTracingRoot`.
const STATIC_EXPORT_OUTPUT_PATTERN = /(?:^|[^.\w])["']?output["']?\s*:\s*["']export["']/m;

const hasCompilerPackage = (packageJson: PackageJson): boolean => {
  const allDependencies = {
    ...packageJson.peerDependencies,
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  return Object.keys(allDependencies).some((packageName) =>
    REACT_COMPILER_PACKAGES.has(packageName),
  );
};

const hasCompilerInConfigFile = (filePath: string): boolean => {
  if (!isFile(filePath)) return false;
  const content = fs.readFileSync(filePath, "utf-8");
  return (
    REACT_COMPILER_ENABLED_FLAG_PATTERN.test(content) ||
    REACT_COMPILER_PACKAGE_REFERENCE_PATTERN.test(content)
  );
};

const hasCompilerInConfigFiles = (directory: string, filenames: string[]): boolean =>
  filenames.some((filename) => hasCompilerInConfigFile(path.join(directory, filename)));

export const detectReactCompiler = (directory: string, packageJson: PackageJson): boolean => {
  if (hasCompilerPackage(packageJson)) return true;

  if (hasCompilerInConfigFiles(directory, NEXT_CONFIG_FILENAMES)) return true;
  if (hasCompilerInConfigFiles(directory, BABEL_CONFIG_FILENAMES)) return true;
  if (hasCompilerInConfigFiles(directory, VITE_CONFIG_FILENAMES)) return true;
  if (hasCompilerInConfigFiles(directory, EXPO_APP_CONFIG_FILENAMES)) return true;

  if (isProjectBoundary(directory)) return false;

  let ancestorDirectory = path.dirname(directory);
  while (ancestorDirectory !== path.dirname(ancestorDirectory)) {
    const ancestorPackagePath = path.join(ancestorDirectory, "package.json");
    if (isFile(ancestorPackagePath)) {
      const ancestorPackageJson = readPackageJson(ancestorPackagePath);
      if (hasCompilerPackage(ancestorPackageJson)) return true;
    }
    if (isProjectBoundary(ancestorDirectory)) return false;
    ancestorDirectory = path.dirname(ancestorDirectory);
  }

  return false;
};

// Whether `next.config.*` opts into static HTML export (`output: "export"`).
// Reuses the same next.config filenames + raw-text read as the React Compiler
// detector above (the config can be TS/ESM, so it can't be cheaply imported at
// discovery time). A per-project fact — not walked into ancestors.
export const detectNextjsStaticExport = (directory: string): boolean =>
  NEXT_CONFIG_FILENAMES.some((filename) => {
    const filePath = path.join(directory, filename);
    return (
      isFile(filePath) && STATIC_EXPORT_OUTPUT_PATTERN.test(fs.readFileSync(filePath, "utf-8"))
    );
  });
