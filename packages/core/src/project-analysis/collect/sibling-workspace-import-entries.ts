import fg from "fast-glob";
import { join, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { parseSync } from "oxc-parser";
import ts from "typescript";
import { findMonorepoRoot } from "../utils/find-monorepo-root.js";
import { getIdentifierName, isOxcAstNode } from "../utils/oxc-ast-node.js";
import { resolveWorkspaces } from "./workspaces.js";
import { resolveWorkspaceSubpath, trySourceFallback } from "../resolver/resolve.js";

const SIBLING_SOURCE_GLOB = "**/*.{ts,tsx,js,jsx,mts,mjs,cts,cjs}";

const SIBLING_STYLELINT_CONFIG_GLOBS = [
  "**/.stylelintrc.{js,cjs,mjs,ts,mts,cts}",
  "**/stylelint.config.{js,cjs,mjs,ts,mts,cts}",
];

const SIBLING_IGNORE_PATTERNS = ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**"];

const readPackageName = (directory: string): string | undefined => {
  try {
    const content = readFileSync(join(directory, "package.json"), "utf-8");
    const packageJson = JSON.parse(content);
    return typeof packageJson.name === "string" ? packageJson.name : undefined;
  } catch {
    return undefined;
  }
};

const extractImportSpecifiers = (sourceText: string): string[] => {
  let parsedModule: ReturnType<typeof parseSync>;
  try {
    parsedModule = parseSync("sibling-source.tsx", sourceText, { sourceType: "unambiguous" });
  } catch {
    return [];
  }
  if (parsedModule.errors.some((error) => error.severity === "Error")) return [];

  const specifiers = new Set<string>();
  const getStaticSpecifier = (node: unknown): string | undefined => {
    if (!isOxcAstNode(node)) return undefined;
    if (node.type === "Literal" && typeof node.value === "string") return node.value;
    if (
      node.type === "TemplateLiteral" &&
      Array.isArray(node.expressions) &&
      node.expressions.length === 0 &&
      Array.isArray(node.quasis) &&
      isOxcAstNode(node.quasis[0]) &&
      node.quasis[0].value &&
      typeof node.quasis[0].value === "object" &&
      "cooked" in node.quasis[0].value &&
      typeof node.quasis[0].value.cooked === "string"
    ) {
      return node.quasis[0].value.cooked;
    }
    return undefined;
  };
  const statementsBindRequire = (statements: unknown[]): boolean =>
    statements.some((statement) => {
      if (!isOxcAstNode(statement)) return false;
      if (
        (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") &&
        getIdentifierName(statement.id) === "require"
      ) {
        return true;
      }
      if (statement.type === "VariableDeclaration" && Array.isArray(statement.declarations)) {
        return statement.declarations.some(
          (declaration) =>
            isOxcAstNode(declaration) && getIdentifierName(declaration.id) === "require",
        );
      }
      if (statement.type === "ImportDeclaration" && Array.isArray(statement.specifiers)) {
        return statement.specifiers.some(
          (specifier) =>
            isOxcAstNode(specifier) && getIdentifierName(specifier.local) === "require",
        );
      }
      return false;
    });
  const addSpecifier = (node: unknown): void => {
    const specifier = getStaticSpecifier(node);
    if (specifier) specifiers.add(specifier);
  };
  const visitNode = (node: unknown, isRequireShadowed: boolean): void => {
    if (Array.isArray(node)) {
      for (const child of node) visitNode(child, isRequireShadowed);
      return;
    }
    if (!isOxcAstNode(node)) return;
    let isRequireShadowedInNode = isRequireShadowed;
    if ((node.type === "Program" || node.type === "BlockStatement") && Array.isArray(node.body)) {
      isRequireShadowedInNode ||= statementsBindRequire(node.body);
    }
    if (
      (node.type === "FunctionDeclaration" ||
        node.type === "FunctionExpression" ||
        node.type === "ArrowFunctionExpression") &&
      Array.isArray(node.params)
    ) {
      isRequireShadowedInNode ||= node.params.some(
        (parameter) => getIdentifierName(parameter) === "require",
      );
    }
    if (node.type === "CatchClause" && getIdentifierName(node.param) === "require") {
      isRequireShadowedInNode = true;
    }
    if (
      node.type === "ImportDeclaration" ||
      node.type === "ExportNamedDeclaration" ||
      node.type === "ExportAllDeclaration"
    ) {
      addSpecifier(node.source);
    }
    if (node.type === "ImportExpression" || node.type === "TSImportType") {
      addSpecifier(node.source);
    }
    if (node.type === "CallExpression" && !isRequireShadowedInNode && isOxcAstNode(node.callee)) {
      const argumentsList = Array.isArray(node.arguments) ? node.arguments : [];
      const isDirectRequire = getIdentifierName(node.callee) === "require";
      const isRequireResolve =
        node.callee.type === "MemberExpression" &&
        node.callee.computed !== true &&
        getIdentifierName(node.callee.object) === "require" &&
        getIdentifierName(node.callee.property) === "resolve";
      if (isDirectRequire || isRequireResolve) addSpecifier(argumentsList[0]);
    }
    for (const child of Object.values(node)) visitNode(child, isRequireShadowedInNode);
  };
  visitNode(parsedModule.program, false);
  return [...specifiers];
};

const extractStylelintPluginSpecifiers = (sourceText: string): string[] => {
  const specifiers: string[] = [];
  const sourceFile = ts.createSourceFile(
    "stylelint.config.mjs",
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const collectStringLiterals = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node)) {
      specifiers.push(node.text);
      return;
    }
    ts.forEachChild(node, collectStringLiterals);
  };
  const visitNode = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)) &&
      node.name.text === "plugins"
    ) {
      collectStringLiterals(node.initializer);
      return;
    }
    ts.forEachChild(node, visitNode);
  };
  visitNode(sourceFile);
  return specifiers;
};

export const extractSiblingWorkspaceImportEntries = (absoluteRoot: string): string[] => {
  const monorepoRoot = findMonorepoRoot(absoluteRoot);
  if (!monorepoRoot || monorepoRoot === absoluteRoot) return [];

  const packageName = readPackageName(absoluteRoot);
  if (!packageName) return [];

  const siblingDirectories = resolveWorkspaces(monorepoRoot)
    .packages.map((workspacePackage) => workspacePackage.directory)
    .filter(
      (workspaceDirectory) =>
        workspaceDirectory !== absoluteRoot &&
        !workspaceDirectory.startsWith(`${absoluteRoot}/`) &&
        !absoluteRoot.startsWith(`${workspaceDirectory}/`),
    );
  if (siblingDirectories.length === 0) return [];

  const importedEntries: string[] = [];
  const addResolvedSpecifier = (specifier: string): void => {
    if (specifier !== packageName && !specifier.startsWith(`${packageName}/`)) return;
    const subpath = specifier.slice(packageName.length + 1);
    if (!subpath) return;
    const resolvedEntry = resolveWorkspaceSubpath(absoluteRoot, subpath);
    const sourceFallback = trySourceFallback(resolve(absoluteRoot, subpath));
    const importedEntry = resolvedEntry ?? sourceFallback;
    if (importedEntry) importedEntries.push(importedEntry);
  };

  for (const siblingDirectory of siblingDirectories) {
    const siblingSourceFiles = fg.sync(SIBLING_SOURCE_GLOB, {
      cwd: siblingDirectory,
      absolute: true,
      onlyFiles: true,
      ignore: SIBLING_IGNORE_PATTERNS,
    });

    for (const siblingSourceFile of siblingSourceFiles) {
      let sourceText: string;
      try {
        sourceText = readFileSync(siblingSourceFile, "utf-8");
      } catch {
        continue;
      }
      if (!sourceText.includes(packageName)) continue;

      for (const importSpecifier of extractImportSpecifiers(sourceText)) {
        addResolvedSpecifier(importSpecifier);
      }
    }

    const siblingStylelintConfigFiles = fg.sync(SIBLING_STYLELINT_CONFIG_GLOBS, {
      cwd: siblingDirectory,
      absolute: true,
      onlyFiles: true,
      dot: true,
      ignore: SIBLING_IGNORE_PATTERNS,
    });
    for (const siblingStylelintConfigFile of siblingStylelintConfigFiles) {
      let sourceText: string;
      try {
        sourceText = readFileSync(siblingStylelintConfigFile, "utf-8");
      } catch {
        continue;
      }
      if (!sourceText.includes(packageName)) continue;
      for (const configSpecifier of extractStylelintPluginSpecifiers(sourceText)) {
        addResolvedSpecifier(configSpecifier);
      }
    }
  }

  return [...new Set(importedEntries)];
};
