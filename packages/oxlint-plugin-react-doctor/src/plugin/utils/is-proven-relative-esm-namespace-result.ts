import * as fs from "node:fs";
import * as path from "node:path";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { recordContentProbe, recordExistenceProbe } from "./cross-file-probe-recorder.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "./is-proven-unmodified-global-namespace-reference.js";
import { parseSourceFile } from "./parse-source-file.js";
import { resolveRelativeImportPath } from "./resolve-relative-import-path.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const RESOLUTION_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];
const NEXT_CONFIG_NAMES = ["next.config.ts", "next.config.js", "next.config.mjs"];
const CUSTOM_TRANSFORM_NAMES = [
  ".babelrc",
  ".babelrc.json",
  ".babelrc.js",
  ".babelrc.cjs",
  ".babelrc.mjs",
  ".babelrc.cts",
  "babel.config.js",
  "babel.config.cjs",
  "babel.config.mjs",
  "babel.config.cts",
  "babel.config.json",
  ".swcrc",
];
const INTRINSIC_NAMES = new Set(["Object", "Reflect", "Promise", "Symbol", "Array"]);
const GLOBAL_OBJECT_NAMES = new Set(["globalThis", "global", "window", "self"]);
const DYNAMIC_RUNTIME_NAMES = new Set(["eval", "Function", "require", "module", "exports"]);

export interface RelativeEsmNamespaceProofInput {
  readonly fromFilename: string;
  readonly source: string;
  readonly projectRoot: string;
  readonly framework: string;
}

const entryExists = (filename: string): boolean => {
  recordExistenceProbe(filename);
  try {
    return fs.statSync(filename, { throwIfNoEntry: false }) !== undefined;
  } catch {
    return true;
  }
};

const hasCustomTransformContext = (projectRoot: string, filename: string): boolean => {
  let directory = path.dirname(filename);
  while (true) {
    for (const name of CUSTOM_TRANSFORM_NAMES) {
      if (entryExists(path.join(directory, name))) return true;
    }
    const manifestPath = path.join(directory, "package.json");
    if (entryExists(manifestPath)) {
      recordContentProbe(manifestPath);
      try {
        const manifest: unknown = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        if (typeof manifest !== "object" || manifest === null || "babel" in manifest) return true;
      } catch {
        return true;
      }
    }
    if (directory === projectRoot) return false;
    const parent = path.dirname(directory);
    if (parent === directory) return true;
    directory = parent;
  }
};

const hasEmptyNextConfig = (projectRoot: string): boolean => {
  const present = NEXT_CONFIG_NAMES.map((name) => path.join(projectRoot, name)).filter(entryExists);
  if (present.length !== 1 || !present[0]?.endsWith("next.config.ts")) return false;
  const program = parseSourceFile(present[0]);
  if (!isNodeOfType(program, "Program") || program.sourceType !== "module") return false;
  let configBinding: string | null = null;
  let hasDefault = false;
  for (const statement of program.body) {
    if (isNodeOfType(statement, "ImportDeclaration")) {
      if (statement.importKind !== "type") return false;
      continue;
    }
    if (isNodeOfType(statement, "VariableDeclaration") && statement.kind === "const") {
      const [declaration] = statement.declarations;
      if (
        configBinding !== null ||
        statement.declarations.length !== 1 ||
        !isNodeOfType(declaration, "VariableDeclarator") ||
        !isNodeOfType(declaration.id, "Identifier") ||
        !declaration.init
      )
        return false;
      const initializer = stripParenExpression(declaration.init);
      if (!isNodeOfType(initializer, "ObjectExpression") || initializer.properties.length !== 0)
        return false;
      configBinding = declaration.id.name;
      continue;
    }
    if (isNodeOfType(statement, "ExportDefaultDeclaration") && !hasDefault) {
      const value = stripParenExpression(statement.declaration);
      if (isNodeOfType(value, "ObjectExpression") && value.properties.length === 0) {
        hasDefault = true;
      } else if (isNodeOfType(value, "Identifier") && value.name === configBinding) {
        hasDefault = true;
      } else return false;
      continue;
    }
    return false;
  }
  return hasDefault;
};

const hasClosedRuntimeExports = (program: EsTreeNode): boolean => {
  if (!isNodeOfType(program, "Program") || program.sourceType !== "module") return false;
  let hasDefaultExport = false;
  for (const statement of program.body) {
    if (
      isNodeOfType(statement, "ExportAllDeclaration") ||
      statement.type === "TSExportAssignment" ||
      statement.type === "TSNamespaceExportDeclaration"
    )
      return false;
    if (isNodeOfType(statement, "ExportDefaultDeclaration")) {
      hasDefaultExport = true;
      continue;
    }
    if (!isNodeOfType(statement, "ExportNamedDeclaration")) continue;
    if (statement.exportKind === "type") continue;
    if (statement.source) return false;
    const declaration = statement.declaration;
    if (declaration) {
      if (isNodeOfType(declaration, "VariableDeclaration")) {
        for (const declarator of declaration.declarations) {
          if (!isNodeOfType(declarator.id, "Identifier") || declarator.id.name === "then")
            return false;
        }
      } else if (
        isNodeOfType(declaration, "FunctionDeclaration") ||
        isNodeOfType(declaration, "ClassDeclaration") ||
        declaration.type === "TSEnumDeclaration"
      ) {
        if (
          !("id" in declaration) ||
          !isNodeOfType(declaration.id, "Identifier") ||
          declaration.id.name === "then"
        )
          return false;
      } else if (
        declaration.type !== "TSInterfaceDeclaration" &&
        declaration.type !== "TSTypeAliasDeclaration"
      ) {
        return false;
      }
    }
    for (const specifier of statement.specifiers) {
      if (!isNodeOfType(specifier, "ExportSpecifier")) return false;
      if (specifier.exportKind === "type") continue;
      const exported = specifier.exported;
      const name = isNodeOfType(exported, "Identifier")
        ? exported.name
        : isNodeOfType(exported, "Literal") && typeof exported.value === "string"
          ? exported.value
          : null;
      if (name === null || name === "then") return false;
      if (name === "default") hasDefaultExport = true;
    }
  }
  return hasDefaultExport;
};

const hasVisibleRuntimeHazard = (program: EsTreeNode): boolean => {
  const scopes = analyzeScopes(program);
  let found = false;
  walkAst(program, (node) => {
    if (found) return false;
    if (isNodeOfType(node, "WithStatement") || node.type === "TSImportEqualsDeclaration") {
      found = true;
      return false;
    }
    if (!isNodeOfType(node, "Identifier") || !scopes.isGlobalReference(node)) return;
    if (DYNAMIC_RUNTIME_NAMES.has(node.name)) {
      found = true;
      return false;
    }
    if (
      INTRINSIC_NAMES.has(node.name) &&
      !isProvenUnmodifiedGlobalNamespaceReference(node, node.name, scopes, undefined, true)
    )
      found = true;
    if (
      GLOBAL_OBJECT_NAMES.has(node.name) &&
      !isProvenUnmodifiedGlobalNamespaceReference(node, null, scopes, undefined, true)
    )
      found = true;
    return undefined;
  });
  return found;
};

export const isProvenRelativeEsmNamespaceResult = ({
  fromFilename: inputFilename,
  source,
  projectRoot: inputProjectRoot,
  framework,
}: RelativeEsmNamespaceProofInput): boolean => {
  if (
    framework !== "nextjs" ||
    !path.isAbsolute(inputProjectRoot) ||
    !path.isAbsolute(inputFilename) ||
    !source.startsWith("./") ||
    path.extname(source) !== ""
  )
    return false;
  // The caller can supply slash-normalized paths while the resolver returns
  // native paths. Keep ancestor comparisons on the same path representation.
  const projectRoot = path.resolve(inputProjectRoot);
  const fromFilename = path.resolve(inputFilename);
  const relativeFromRoot = path.relative(projectRoot, fromFilename);
  if (
    relativeFromRoot.startsWith("..") ||
    path.isAbsolute(relativeFromRoot) ||
    !hasEmptyNextConfig(projectRoot)
  )
    return false;
  const stem = path.resolve(path.dirname(fromFilename), source);
  const relativeTarget = path.relative(projectRoot, stem);
  if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget) || entryExists(stem))
    return false;
  const present = RESOLUTION_EXTENSIONS.map((extension) => `${stem}${extension}`).filter(
    entryExists,
  );
  if (
    present.length !== 1 ||
    !present[0] ||
    (!present[0].endsWith(".tsx") && !present[0].endsWith(".ts")) ||
    present[0].endsWith(".d.ts")
  )
    return false;
  const selected = resolveRelativeImportPath(fromFilename, source);
  if (
    selected !== present[0] ||
    hasCustomTransformContext(projectRoot, fromFilename) ||
    hasCustomTransformContext(projectRoot, selected)
  )
    return false;
  const program = parseSourceFile(selected);
  return Boolean(program && hasClosedRuntimeExports(program) && !hasVisibleRuntimeHazard(program));
};
