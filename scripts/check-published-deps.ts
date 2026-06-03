import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as fs from "node:fs";
import * as path from "node:path";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
const PACKAGES_DIRECTORY = path.resolve(REPOSITORY_ROOT, "packages");
const PUBLISHED_ARTIFACT_DIRECTORIES: readonly string[] = ["dist", "bin"];
const JAVASCRIPT_EXTENSIONS: ReadonlySet<string> = new Set([".js", ".mjs", ".cjs"]);
const NODE_BUILTIN_MODULES: ReadonlySet<string> = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
]);

interface PackageManifest {
  readonly name: string;
  readonly private?: boolean;
  readonly dependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
}

interface PhantomDependency {
  readonly importedPackage: string;
  readonly importingFiles: readonly string[];
}

interface PackageAuditResult {
  readonly manifest: PackageManifest;
  readonly externalImports: readonly string[];
  readonly phantomDependencies: readonly PhantomDependency[];
  readonly artifactFileCount: number;
}

const readManifest = (packageDirectory: string): PackageManifest =>
  JSON.parse(fs.readFileSync(path.join(packageDirectory, "package.json"), "utf8"));

const toPackageName = (moduleSpecifier: string): string => {
  const segments = moduleSpecifier.split("/");
  return moduleSpecifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
};

const isBareSpecifier = (moduleSpecifier: string): boolean =>
  Boolean(moduleSpecifier) && !moduleSpecifier.startsWith(".") && !moduleSpecifier.startsWith("/");

const collectJavaScriptFiles = (directory: string): string[] => {
  if (!fs.existsSync(directory)) return [];
  const javaScriptFiles: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      javaScriptFiles.push(...collectJavaScriptFiles(entryPath));
    } else if (entry.isFile() && JAVASCRIPT_EXTENSIONS.has(path.extname(entry.name))) {
      javaScriptFiles.push(entryPath);
    }
  }
  return javaScriptFiles;
};

const collectModuleSpecifiers = (sourceText: string, fileName: string): Set<string> => {
  const moduleSpecifiers = new Set<string>();
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const visitNode = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      moduleSpecifiers.add(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequireCall = ts.isIdentifier(node.expression) && node.expression.text === "require";
      const [firstArgument] = node.arguments;
      if (
        (isDynamicImport || isRequireCall) &&
        firstArgument &&
        ts.isStringLiteral(firstArgument)
      ) {
        moduleSpecifiers.add(firstArgument.text);
      }
    }
    ts.forEachChild(node, visitNode);
  };
  visitNode(sourceFile);
  return moduleSpecifiers;
};

const auditPublishedPackage = (packageDirectory: string): PackageAuditResult => {
  const manifest = readManifest(packageDirectory);
  const declaredDependencies = new Set<string>([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ]);

  const artifactFiles = PUBLISHED_ARTIFACT_DIRECTORIES.flatMap((artifactDirectory) =>
    collectJavaScriptFiles(path.join(packageDirectory, artifactDirectory)),
  );

  const importingFilesByPackage = new Map<string, Set<string>>();
  for (const artifactFile of artifactFiles) {
    for (const moduleSpecifier of collectModuleSpecifiers(
      fs.readFileSync(artifactFile, "utf8"),
      artifactFile,
    )) {
      if (!isBareSpecifier(moduleSpecifier) || NODE_BUILTIN_MODULES.has(moduleSpecifier)) continue;
      const importedPackage = toPackageName(moduleSpecifier);
      if (NODE_BUILTIN_MODULES.has(importedPackage) || importedPackage === manifest.name) continue;
      const importingFiles = importingFilesByPackage.get(importedPackage) ?? new Set<string>();
      importingFiles.add(path.relative(REPOSITORY_ROOT, artifactFile));
      importingFilesByPackage.set(importedPackage, importingFiles);
    }
  }

  const phantomDependencies = [...importingFilesByPackage]
    .filter(([importedPackage]) => !declaredDependencies.has(importedPackage))
    .map(([importedPackage, importingFiles]) => ({
      importedPackage,
      importingFiles: [...importingFiles].sort(),
    }))
    .sort((left, right) => left.importedPackage.localeCompare(right.importedPackage));

  return {
    manifest,
    externalImports: [...importingFilesByPackage.keys()].sort(),
    phantomDependencies,
    artifactFileCount: artifactFiles.length,
  };
};

const publishedPackageDirectories = fs.readdirSync(PACKAGES_DIRECTORY, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(PACKAGES_DIRECTORY, entry.name))
  .filter((packageDirectory) => fs.existsSync(path.join(packageDirectory, "package.json")))
  .filter((packageDirectory) => readManifest(packageDirectory).private !== true)
  .sort();

if (publishedPackageDirectories.length === 0) {
  console.error("No published packages found under packages/.");
  process.exit(1);
}

let hasMissingArtifacts = false;
let hasPhantomDependencies = false;

for (const packageDirectory of publishedPackageDirectories) {
  const { manifest, externalImports, phantomDependencies, artifactFileCount } =
    auditPublishedPackage(packageDirectory);

  if (artifactFileCount === 0) {
    hasMissingArtifacts = true;
    console.error(`✗ ${manifest.name}: no built artifacts found.`);
    continue;
  }

  if (phantomDependencies.length === 0) {
    console.log(`✓ ${manifest.name}: ${externalImports.length} external import(s), all declared.`);
    continue;
  }

  hasPhantomDependencies = true;
  console.error(`✗ ${manifest.name}: built output imports packages absent from its dependencies:`);
  for (const { importedPackage, importingFiles } of phantomDependencies) {
    console.error(`    ${importedPackage}  (from ${importingFiles.join(", ")})`);
  }
}

if (hasMissingArtifacts) {
  console.error("\nBuild the packages before running this check: `pnpm build`.");
  process.exit(1);
}

if (hasPhantomDependencies) {
  console.error(
    [
      "",
      "Phantom dependency detected. A published package's built output imports a package that is",
      "not in its `dependencies` (or peer/optional), so it only resolves when a sibling dependency",
      "happens to supply it. Consumers on strict installs (e.g. pnpm `hoist=false`) then crash with",
      "ERR_MODULE_NOT_FOUND before the tool runs — see issue #629. Fix by adding the package to",
      "`dependencies`, or inlining it through the build's `alwaysBundle` list.",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(
  `\nAll ${publishedPackageDirectories.length} published packages declare their runtime dependencies.`,
);
