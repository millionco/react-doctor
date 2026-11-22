import * as fs from "node:fs";
import * as path from "node:path";
import { analyzeScopes } from "../../../semantic/scope-analysis.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import {
  recordContentProbe,
  recordExistenceProbe,
} from "../../../utils/cross-file-probe-recorder.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findExportedValue } from "../../../utils/find-exported-value.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getFunctionBindingSymbols } from "../../../utils/get-function-binding-symbols.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { parseSourceText } from "../../../utils/parse-source-file.js";
import {
  findNearestPackageDirectory,
  readPackageManifest,
  type PackageManifest,
} from "../../../utils/read-nearest-package-manifest.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

import { proveStockPresenceWrapper } from "./prove-stock-presence-wrapper.js";

const PAGE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];
const BUILD_CONFIGURATION_FILES = [
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "next.config.cjs",
  "next.config.cts",
  "next.config.mts",
  ".babelrc",
  ".babelrc.json",
  ".babelrc.js",
  ".babelrc.mjs",
  ".babelrc.cjs",
  ".babelrc.cts",
  "babel.config.json",
  "babel.config.js",
  "babel.config.mjs",
  "babel.config.cjs",
  "babel.config.cts",
  ".swcrc",
  ".pnp.cjs",
  ".pnp.js",
  ".yarnrc",
  ".yarnrc.yml",
  "pnpm-workspace.yaml",
];
const PACKAGE_OVERRIDE_FIELDS = [
  "overrides",
  "resolutions",
  "pnpm",
  "babel",
  "browser",
  "imports",
  "workspaces",
];
const ROUTE_PROVIDER_FIELDS = ["extends", "references"];
const JSX_PROVIDER_FIELDS = [
  "jsxImportSource",
  "jsxFactory",
  "jsxFragmentFactory",
  "reactNamespace",
  "paths",
  "baseUrl",
];
const REGISTRY_DEPENDENCY = /^(?:latest|[~^]?\d+\.\d+\.\d+)$/;
const JSX_PROVIDER_SYNTAX =
  /@jsx(?:ImportSource|Runtime|Frag)?\b|react\/jsx(?:-dev)?-runtime|\bcreateElement\b/;
const MAX_SOURCE_BYTES = 512 * 1024;

const probe = (filename: string): "file" | "directory" | "missing" | "opaque" => {
  recordExistenceProbe(filename);
  try {
    const stat = fs.statSync(filename, { throwIfNoEntry: false });
    if (!stat) return "missing";
    if (stat.isFile()) return "file";
    if (stat.isDirectory()) return "directory";
    return "opaque";
  } catch {
    return "opaque";
  }
};

const readSource = (filename: string): string | null => {
  recordContentProbe(filename);
  try {
    const stat = fs.statSync(filename, { throwIfNoEntry: false });
    if (!stat?.isFile() || stat.size > MAX_SOURCE_BYTES) return null;
    return fs.readFileSync(filename, "utf8");
  } catch {
    return null;
  }
};

const hasOwnField = (value: object, fields: ReadonlyArray<string>): boolean =>
  fields.some((field) => Object.hasOwn(value, field));

const hasStockJsxConfig = (filename: string): boolean => {
  const kind = probe(filename);
  if (kind === "missing") return true;
  if (kind !== "file") return false;
  const source = readSource(filename);
  if (source === null) return false;
  try {
    const config = JSON.parse(source) as Record<string, unknown> | null;
    if (!config || typeof config !== "object" || hasOwnField(config, ROUTE_PROVIDER_FIELDS))
      return false;
    const options = config.compilerOptions as Record<string, unknown> | undefined;
    if (!options) return config.compilerOptions === undefined;
    if (typeof options !== "object" || hasOwnField(options, JSX_PROVIDER_FIELDS)) return false;
    return (
      options.jsx === undefined ||
      ["preserve", "react", "react-jsx", "react-jsxdev"].some((jsx) => jsx === options.jsx)
    );
  } catch {
    return false;
  }
};

const hasStockBuildConfiguration = (pagesDirectory: string, packageDirectory: string): boolean => {
  for (let current = pagesDirectory; ; current = path.dirname(current)) {
    if (BUILD_CONFIGURATION_FILES.some((name) => probe(path.join(current, name)) !== "missing"))
      return false;
    if (
      !["tsconfig.json", "jsconfig.json"].every((name) =>
        hasStockJsxConfig(path.join(current, name)),
      )
    )
      return false;
    if (current !== packageDirectory) {
      const manifestPath = path.join(current, "package.json");
      const kind = probe(manifestPath);
      if (kind !== "missing") {
        const manifest = kind === "file" ? readPackageManifest(current) : null;
        if (!manifest || hasOwnField(manifest, PACKAGE_OVERRIDE_FIELDS)) return false;
      }
    }
    if (path.dirname(current) === current) return true;
  }
};

const hasDirectEval = (program: EsTreeNode): boolean => {
  let found = false;
  walkAst(program, (child) => {
    if (found) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    const callee = stripParenExpression(child.callee);
    if (isNodeOfType(callee, "Identifier") && callee.name === "eval") found = true;
  });
  return found;
};

const isReturnedThroughHostJsx = (
  tag: EsTreeNode,
  app: EsTreeNode,
  certifyWrapper: (element: EsTreeNode) => boolean,
): boolean => {
  const child = tag.parent?.parent;
  if (!isNodeOfType(child, "JSXElement")) return false;
  let current: EsTreeNode = child;
  while (current.parent) {
    current = findTransparentExpressionRoot(current);
    const parent = current.parent;
    if (!parent) return false;
    if (isNodeOfType(parent, "ReturnStatement")) {
      return (
        parent.argument === current && parent.parent === (isFunctionLike(app) ? app.body : null)
      );
    }
    if (isNodeOfType(parent, "JSXElement")) {
      const name = parent.openingElement.name;
      if (!parent.children.some((childNode) => childNode === current)) return false;
      const intrinsic = isNodeOfType(name, "JSXIdentifier") && /^[a-z]/.test(name.name);
      if (!intrinsic && !certifyWrapper(parent)) return false;
    } else if (!isNodeOfType(parent, "JSXFragment")) {
      return false;
    }
    current = parent;
  }
  return false;
};

const hasStockAppDependencies = (program: EsTreeNode, manifest: PackageManifest): boolean => {
  let opaque = false;
  walkAst(program, (child) => {
    if (opaque) return false;
    if (isNodeOfType(child, "Identifier") && child.name === "arguments") opaque = true;
    if (isNodeOfType(child, "ImportExpression")) opaque = true;
    if (isNodeOfType(child, "CallExpression")) {
      const callee = stripParenExpression(child.callee);
      if (isNodeOfType(callee, "Identifier") && callee.name === "require") opaque = true;
    }
    if (!isNodeOfType(child, "ImportDeclaration")) return;
    const source = child.source.value;
    if (typeof source !== "string") {
      opaque = true;
      return;
    }
    if (source.startsWith(".") || path.isAbsolute(source) || source.startsWith("#")) {
      if (child.specifiers.length !== 0 || !/\.(?:css|scss|sass)$/.test(source)) opaque = true;
      return;
    }
    const packageName = source
      .split("/")
      .slice(0, source.startsWith("@") ? 2 : 1)
      .join("/");
    const dependency = manifest.dependencies?.[packageName];
    if (
      packageName === manifest.name ||
      child.specifiers.length === 0 ||
      typeof dependency !== "string" ||
      !REGISTRY_DEPENDENCY.test(dependency)
    ) {
      opaque = true;
    }
  });
  return !opaque;
};

const forwardsPageAsJsx = (
  appFilename: string,
  packageDirectory: string,
  manifest: PackageManifest,
): boolean => {
  const sourceText = readSource(appFilename);
  if (sourceText === null || JSX_PROVIDER_SYNTAX.test(sourceText)) return false;
  const program = parseSourceText({ filename: appFilename, sourceText });
  if (!program || hasDirectEval(program) || !hasStockAppDependencies(program, manifest))
    return false;
  const app = findExportedValue(program, "default");
  if (!app || !isFunctionLike(app) || app.async || app.generator) return false;
  const firstParameter = app.params[0];
  if (app.params.length !== 1 || !isNodeOfType(firstParameter, "ObjectPattern")) return false;
  const parameters = new Map<string, EsTreeNode>();
  for (const property of firstParameter.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      !isNodeOfType(property.key, "Identifier") ||
      !isNodeOfType(property.value, "Identifier") ||
      parameters.has(property.key.name)
    ) {
      return false;
    }
    parameters.set(property.key.name, property.value);
  }
  const componentBinding = parameters.get("Component");
  if (!componentBinding) return false;
  const scopes = analyzeScopes(program);
  const appBindings = getFunctionBindingSymbols(app, scopes);
  if (
    appBindings.some((binding) =>
      binding.references.some(
        ({ identifier, flag }) =>
          flag !== "read" || !isNodeOfType(identifier.parent, "ExportDefaultDeclaration"),
      ),
    )
  )
    return false;
  const component = scopes.symbolFor(componentBinding);
  if (!component) return false;
  const certifyWrapper = (element: EsTreeNode): boolean =>
    proveStockPresenceWrapper(element, appFilename, packageDirectory, scopes);
  let forwardsComponent = false;
  for (const reference of component.references) {
    const identifier = reference.identifier;
    const tag = identifier.parent;
    if (
      reference.flag !== "read" ||
      !isNodeOfType(identifier, "JSXIdentifier") ||
      (!isNodeOfType(tag, "JSXOpeningElement") && !isNodeOfType(tag, "JSXClosingElement")) ||
      tag.name !== identifier
    )
      return false;
    if (isNodeOfType(tag, "JSXClosingElement")) continue;
    if (!isReturnedThroughHostJsx(identifier, app, certifyWrapper)) return false;
    forwardsComponent = true;
  }
  return forwardsComponent;
};

// Also called by the dependency collector. Every filesystem answer used
// here is recorded even when discovering a missing config or alternate page.
export const hasStockNextIndexPageRouter = (sourceFilename: string | undefined): boolean => {
  if (!sourceFilename) return false;
  const filename = path.resolve(sourceFilename);
  if (
    !PAGE_EXTENSIONS.includes(path.extname(filename)) ||
    path.basename(filename, path.extname(filename)) !== "index"
  )
    return false;
  const packageDirectory = findNearestPackageDirectory(filename);
  if (!packageDirectory) return false;
  const pagesDirectory = path.dirname(filename);
  const rootPagesDirectory = path.join(packageDirectory, "pages");
  if (pagesDirectory !== rootPagesDirectory) {
    if (
      pagesDirectory !== path.join(packageDirectory, "src", "pages") ||
      probe(rootPagesDirectory) !== "missing"
    )
      return false;
  }
  const manifest = readPackageManifest(packageDirectory);
  if (!manifest || hasOwnField(manifest, PACKAGE_OVERRIDE_FIELDS)) return false;
  for (const packageName of ["next", "react", "react-dom"]) {
    const dependency = manifest.dependencies?.[packageName];
    if (typeof dependency !== "string" || !REGISTRY_DEPENDENCY.test(dependency)) return false;
  }
  if (!hasStockBuildConfiguration(pagesDirectory, packageDirectory)) return false;
  if (
    PAGE_EXTENSIONS.some(
      (extension) =>
        extension !== path.extname(filename) &&
        probe(path.join(pagesDirectory, `index${extension}`)) !== "missing",
    )
  )
    return false;
  if (
    PAGE_EXTENSIONS.some(
      (extension) => probe(path.join(pagesDirectory, "_document" + extension)) !== "missing",
    )
  )
    return false;
  const appPaths = PAGE_EXTENSIONS.map((extension) =>
    path.join(pagesDirectory, `_app${extension}`),
  );
  const presentApps = appPaths.filter((appPath) => probe(appPath) !== "missing");
  if (presentApps.length > 1) return false;
  const app = presentApps[0];
  if (app && !forwardsPageAsJsx(app, packageDirectory, manifest)) return false;
  const focalSource = readSource(filename);
  return focalSource !== null && !JSX_PROVIDER_SYNTAX.test(focalSource);
};

const hasOwnJsxReturn = (functionNode: EsTreeNode): boolean => {
  if (!isFunctionLike(functionNode)) return false;
  const body = stripParenExpression(functionNode.body);
  if (isNodeOfType(body, "JSXElement") || isNodeOfType(body, "JSXFragment")) return true;
  let found = false;
  walkAst(body, (node) => {
    if (found || isFunctionLike(node)) return false;
    if (!isNodeOfType(node, "ReturnStatement") || !node.argument) return;
    const expression = stripParenExpression(node.argument);
    found = isNodeOfType(expression, "JSXElement") || isNodeOfType(expression, "JSXFragment");
  });
  return found;
};

export const getStockNextIndexPageComponent = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  filename: string | undefined,
): EsTreeNode | null => {
  const program = findProgramRoot(node);
  if (!program) return null;
  const page = findExportedValue(program, "default");
  if (!page || !isFunctionLike(page) || page.async || page.generator || !hasOwnJsxReturn(page))
    return null;
  const bindings = getFunctionBindingSymbols(page, scopes);
  if (
    bindings.length !== 1 ||
    !bindings.every(
      (binding) =>
        (binding.kind === "const" || binding.kind === "function") &&
        binding.references.every(
          ({ identifier, flag }) =>
            flag === "read" &&
            isNodeOfType(identifier.parent, "ExportDefaultDeclaration") &&
            identifier.parent.declaration === identifier,
        ),
    )
  )
    return null;
  return !hasDirectEval(program) && hasStockNextIndexPageRouter(filename) ? page : null;
};
