import * as fs from "node:fs";
import * as path from "node:path";
import { analyzeScopes } from "../../../semantic/scope-analysis.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import { buildSourceProjectIndex } from "../../../utils/build-source-project-index.js";
import {
  recordContentProbe,
  recordExistenceProbe,
} from "../../../utils/cross-file-probe-recorder.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findExportedValue } from "../../../utils/find-exported-value.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { getGlobalRequireModuleSource } from "../../../utils/get-global-require-module-source.js";
import { getFunctionBindingSymbols } from "../../../utils/get-function-binding-symbols.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { getSingleReturnExpression } from "../../../utils/get-single-return-expression.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactHookName } from "../../../utils/is-react-hook-name.js";
import { normalizeFilename } from "../../../utils/normalize-filename.js";
import { parseSourceText } from "../../../utils/parse-source-file.js";
import {
  findNearestPackageDirectory,
  readPackageManifest,
} from "../../../utils/read-nearest-package-manifest.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";
import { resolveModulePath } from "../../../utils/resolve-module-path.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

const PAGE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js"];
const BUILD_CONFIGURATION_FILES = [
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
];
const REGISTRY_DEPENDENCY = /^(?:latest|[~^]?\d+\.\d+\.\d+)$/;
const JSX_PROVIDER_SYNTAX =
  /@jsx(?:ImportSource|Runtime|Frag)?\b|react\/jsx(?:-dev)?-runtime|\bcreateElement\b/;
const MAX_SOURCE_BYTES = 512 * 1024;
const ROUTE_SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const SIMPLE_DYNAMIC_SEGMENT = /^\[[a-zA-Z][a-zA-Z0-9_]*\]$/;
const STOCK_PROVIDER_SPECIFIERS = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "next",
  "next/router",
  "next/document",
  "react-dom/client",
  "react-dom/server",
];

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
    if (options.baseUrl !== undefined && options.baseUrl !== ".") return false;
    if (options.paths !== undefined) {
      if (!options.paths || typeof options.paths !== "object" || Array.isArray(options.paths))
        return false;
      if (
        !Object.entries(options.paths).every(
          ([name, values]) =>
            /^(?:@|~)\/[a-zA-Z0-9_][a-zA-Z0-9_/-]*\*?$/.test(name) &&
            Array.isArray(values) &&
            values.every((value) => typeof value === "string"),
        )
      )
        return false;
    }
    return (
      options.jsx === undefined ||
      ["preserve", "react-jsx", "react-jsxdev"].some((jsx) => jsx === options.jsx)
    );
  } catch {
    return false;
  }
};

const hasStaticImageDomains = (value: EsTreeNode): boolean => {
  if (!isNodeOfType(value, "ObjectExpression") || value.properties.length !== 1) return false;
  const domains = value.properties[0];
  return (
    isNodeOfType(domains, "Property") &&
    domains.kind === "init" &&
    !domains.computed &&
    getStaticPropertyKeyName(domains) === "domains" &&
    isNodeOfType(domains.value, "ArrayExpression") &&
    domains.value.elements.every(
      (element) => isNodeOfType(element, "Literal") && typeof element.value === "string",
    )
  );
};

const hasUnrelatedStaticRoutes = (value: EsTreeNode, firstRouteSegment: string): boolean => {
  if (
    !isNodeOfType(value, "FunctionExpression") ||
    !value.async ||
    value.generator ||
    value.params.length !== 0
  )
    return false;
  const returned = getSingleReturnExpression(value);
  if (!isNodeOfType(returned, "ArrayExpression")) return false;
  return returned.elements.every((entry) => {
    if (!isNodeOfType(entry, "ObjectExpression")) return false;
    const fields = new Set<string>();
    for (const property of entry.properties) {
      if (
        !isNodeOfType(property, "Property") ||
        property.kind !== "init" ||
        property.computed ||
        !isNodeOfType(property.value, "Literal")
      )
        return false;
      const name = getStaticPropertyKeyName(property);
      const part = property.value.value;
      if (name === null || fields.has(name)) return false;
      if (name === "source") {
        if (
          typeof part !== "string" ||
          !/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(part) ||
          !ROUTE_SEGMENT.test(firstRouteSegment) ||
          part.split("/")[1]?.toLowerCase() === firstRouteSegment.toLowerCase()
        )
          return false;
      } else if (name === "destination") {
        if (typeof part !== "string" || !/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(part))
          return false;
      } else if (name !== "permanent" || typeof part !== "boolean") {
        return false;
      }
      fields.add(name);
    }
    return fields.has("source") && fields.has("destination");
  });
};

const hasStaticRouteDefaultConfig = (filename: string, firstRouteSegment: string): boolean => {
  const sourceText = readSource(filename);
  if (sourceText === null) return false;
  const program = parseSourceText({ filename, sourceText });
  if (!isNodeOfType(program, "Program") || program.body.length !== 1) return false;
  const statement = program.body[0];
  if (!isNodeOfType(statement, "ExpressionStatement")) return false;
  const { expression } = statement;
  if (
    !isNodeOfType(expression, "AssignmentExpression") ||
    expression.operator !== "=" ||
    !isNodeOfType(expression.left, "MemberExpression") ||
    expression.left.computed ||
    !isNodeOfType(expression.left.object, "Identifier") ||
    expression.left.object.name !== "module" ||
    !isNodeOfType(expression.left.property, "Identifier") ||
    expression.left.property.name !== "exports" ||
    !isNodeOfType(expression.right, "ObjectExpression")
  )
    return false;

  const keys = new Set<string>();
  for (const property of expression.right.properties) {
    if (!isNodeOfType(property, "Property") || property.kind !== "init" || property.computed)
      return false;
    const key = getStaticPropertyKeyName(property);
    if (key === null || keys.has(key)) return false;
    if (key === "rewrites" || key === "redirects") {
      if (!hasUnrelatedStaticRoutes(property.value, firstRouteSegment)) return false;
    } else if (key === "images") {
      if (!hasStaticImageDomains(property.value)) return false;
    } else {
      return false;
    }
    keys.add(key);
  }
  return true;
};

const hasStockBuildConfiguration = (
  sourceDirectory: string,
  packageDirectory: string,
  firstRouteSegment: string,
): boolean => {
  for (let current = sourceDirectory; ; current = path.dirname(current)) {
    if (BUILD_CONFIGURATION_FILES.some((name) => probe(path.join(current, name)) !== "missing"))
      return false;
    const commonJsConfig = path.join(current, "next.config.js");
    const commonJsConfigKind = probe(commonJsConfig);
    if (
      commonJsConfigKind !== "missing" &&
      (current !== packageDirectory ||
        commonJsConfigKind !== "file" ||
        !hasStaticRouteDefaultConfig(commonJsConfig, firstRouteSegment))
    )
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

const isReturnedThroughHostJsx = (tag: EsTreeNode, app: EsTreeNode): boolean => {
  let current = tag.parent?.parent;
  if (!isNodeOfType(current, "JSXElement")) return false;
  while (current?.parent) {
    const parent: EsTreeNode = current.parent;
    if (isNodeOfType(parent, "ReturnStatement")) {
      return (
        parent.argument === current && parent.parent === (isFunctionLike(app) ? app.body : null)
      );
    }
    if (isNodeOfType(parent, "JSXElement")) {
      const name = parent.openingElement.name;
      if (!isNodeOfType(name, "JSXIdentifier") || !/^[a-z]/.test(name.name)) return false;
    } else if (!isNodeOfType(parent, "JSXFragment")) {
      return false;
    }
    current = parent;
  }
  return false;
};

const hasLocalRuntimeReplacement = (filename: string): boolean =>
  STOCK_PROVIDER_SPECIFIERS.some((specifier) => resolveModulePath(filename, specifier) !== null);

const parseJsxSource = (filename: string, sourceText: string): EsTreeNode | null =>
  parseSourceText({
    filename,
    sourceText,
    language: filename.endsWith(".js") ? "jsx" : undefined,
  });

const forwardsPageAsJsx = (appFilename: string): boolean => {
  if (hasLocalRuntimeReplacement(appFilename)) return false;
  const sourceText = readSource(appFilename);
  if (sourceText === null || JSX_PROVIDER_SYNTAX.test(sourceText)) return false;
  const program = parseJsxSource(appFilename, sourceText);
  if (!program || hasDirectEval(program)) return false;
  const app = findExportedValue(program, "default");
  if (!app || !isFunctionLike(app) || app.async || app.generator) return false;
  const firstParameter = app.params[0];
  if (!isNodeOfType(firstParameter, "ObjectPattern")) return false;
  const componentProperty = firstParameter.properties.find(
    (property) =>
      isNodeOfType(property, "Property") &&
      !property.computed &&
      isNodeOfType(property.key, "Identifier") &&
      property.key.name === "Component",
  );
  if (
    !isNodeOfType(componentProperty, "Property") ||
    !isNodeOfType(componentProperty.value, "Identifier")
  )
    return false;
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
  const component = scopes.symbolFor(componentProperty.value);
  if (!component) return false;
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
    if (!isReturnedThroughHostJsx(identifier, app)) return false;
    forwardsComponent = true;
  }
  return forwardsComponent;
};

const NEXT_DOCUMENT_TAGS: ReadonlySet<string> = new Set(["Html", "Head", "Main", "NextScript"]);

const getStockDocumentTag = (tag: EsTreeNode, scopes: ScopeAnalysis): string | null => {
  if (!isNodeOfType(tag, "JSXIdentifier")) return null;
  if (tag.name === "body") return "body";
  const symbol = scopes.symbolFor(tag);
  if (symbol?.kind !== "import") return null;
  const imported = resolveImportedApiReference(symbol.bindingIdentifier, scopes);
  if (imported?.source !== "next/document" || imported.isNamespace) return null;
  const name = imported.importedName;
  return name && NEXT_DOCUMENT_TAGS.has(name) ? name : null;
};

const getStaticDocumentWrapper = (element: EsTreeNode, scopes: ScopeAnalysis): string | null => {
  if (!isNodeOfType(element, "JSXElement")) return null;
  const opening = element.openingElement;
  if (
    !opening.attributes.every(
      (attribute) =>
        isNodeOfType(attribute, "JSXAttribute") &&
        isNodeOfType(attribute.name, "JSXIdentifier") &&
        (attribute.name.name === "lang" || attribute.name.name === "dir") &&
        isNodeOfType(attribute.value, "Literal") &&
        typeof attribute.value.value === "string",
    )
  )
    return null;
  return getStockDocumentTag(opening.name, scopes);
};

const getDocumentElementChildren = (element: EsTreeNode): EsTreeNode[] | null => {
  if (!isNodeOfType(element, "JSXElement")) return null;
  const elements: EsTreeNode[] = [];
  for (const child of element.children) {
    if (isNodeOfType(child, "JSXText") && !child.value.trim()) continue;
    if (!isNodeOfType(child, "JSXElement")) return null;
    elements.push(child);
  }
  return elements;
};

const hasStockDocumentMarkup = (element: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (getStaticDocumentWrapper(element, scopes) !== "Html") return false;
  const htmlChildren = getDocumentElementChildren(element);
  if (!htmlChildren || htmlChildren.length !== 2) return false;
  const [head, body] = htmlChildren;
  if (
    !head ||
    !body ||
    getStaticDocumentWrapper(head, scopes) !== "Head" ||
    getStaticDocumentWrapper(body, scopes) !== "body" ||
    getDocumentElementChildren(head)?.length !== 0
  )
    return false;
  const bodyChildren = getDocumentElementChildren(body);
  if (!bodyChildren || bodyChildren.length !== 2) return false;
  const [main, scripts] = bodyChildren;
  return Boolean(
    main &&
    scripts &&
    getStaticDocumentWrapper(main, scopes) === "Main" &&
    getStaticDocumentWrapper(scripts, scopes) === "NextScript" &&
    getDocumentElementChildren(main)?.length === 0 &&
    getDocumentElementChildren(scripts)?.length === 0,
  );
};

const isRenderOnlyStockDocument = (filename: string): boolean => {
  const sourceText = readSource(filename);
  if (
    sourceText === null ||
    JSX_PROVIDER_SYNTAX.test(sourceText) ||
    hasLocalRuntimeReplacement(filename)
  )
    return false;
  const program = parseJsxSource(filename, sourceText);
  if (!isNodeOfType(program, "Program") || program.body.length !== 2) return false;
  const [importStatement, exportStatement] = program.body;
  if (
    !isNodeOfType(importStatement, "ImportDeclaration") ||
    importStatement.source.value !== "next/document" ||
    !isNodeOfType(exportStatement, "ExportDefaultDeclaration")
  )
    return false;
  const document = exportStatement.declaration;
  if (
    !isNodeOfType(document, "ClassDeclaration") ||
    document.decorators?.length ||
    !isNodeOfType(document.superClass, "Identifier") ||
    document.body.body.length !== 1
  )
    return false;
  const render = document.body.body[0];
  if (
    !isNodeOfType(render, "MethodDefinition") ||
    render.static ||
    render.computed ||
    render.kind !== "method" ||
    render.decorators?.length ||
    getStaticPropertyKeyName(render) !== "render" ||
    render.value.params.length !== 0 ||
    render.value.async ||
    render.value.generator
  )
    return false;
  const scopes = analyzeScopes(program);
  const superclass = resolveImportedApiReference(document.superClass, scopes);
  if (
    superclass?.source !== "next/document" ||
    superclass.importedName !== "default" ||
    superclass.isNamespace
  )
    return false;
  const returned = getSingleReturnExpression(render.value);
  return returned !== null && hasStockDocumentMarkup(stripParenExpression(returned), scopes);
};

// A data function can use an ESM namespace or CommonJS self import to call
// its own default export without referring to the exported lexical binding.
export const hasPossiblePageSelfImport = (
  program: EsTreeNode,
  scopes: ScopeAnalysis,
  filename: string,
): boolean => {
  if (!/(?:^|[\\/])pages[\\/]/.test(filename) || !PAGE_EXTENSIONS.includes(path.extname(filename)))
    return false;
  let found = false;
  const isSelfSource = (specifier: string): boolean => {
    if (
      path.isAbsolute(specifier) ||
      specifier.startsWith("file:") ||
      (specifier.startsWith(".") && /[?#]/.test(specifier))
    )
      return true;
    const resolved = resolveModulePath(filename, specifier);
    return resolved !== null && path.resolve(resolved) === path.resolve(filename);
  };
  walkAst(program, (node) => {
    if (found) return false;
    if (isNodeOfType(node, "ImportExpression")) {
      found =
        !isNodeOfType(node.source, "Literal") ||
        typeof node.source.value !== "string" ||
        isSelfSource(node.source.value);
    } else if (
      isNodeOfType(node, "ImportDeclaration") ||
      isNodeOfType(node, "ExportNamedDeclaration") ||
      isNodeOfType(node, "ExportAllDeclaration")
    ) {
      const source = node.source;
      if (source && typeof source.value === "string") found = isSelfSource(source.value);
    } else if (
      isNodeOfType(node, "Identifier") &&
      node.name === "require" &&
      scopes.isGlobalReference(node)
    ) {
      const parent = node.parent;
      const source =
        parent && isNodeOfType(parent, "CallExpression") && parent.callee === node
          ? getGlobalRequireModuleSource(parent, scopes)
          : null;
      found = source === null || isSelfSource(source);
    }
  });
  return found;
};

// Also called by the dependency collector. Every filesystem answer used
// here is recorded even when discovering a missing config or alternate page.
export const hasStockNextPagesRouter = (filename: string | undefined): boolean => {
  if (
    !filename ||
    !path.isAbsolute(filename) ||
    !/(?:^|[\\/])pages[\\/]/.test(filename) ||
    !PAGE_EXTENSIONS.includes(path.extname(filename))
  )
    return false;
  const packageDirectory = findNearestPackageDirectory(filename);
  if (!packageDirectory) return false;
  const packageSegments = path.relative(packageDirectory, filename).split(path.sep);
  const usesSrcPages = packageSegments[0] === "src" && packageSegments[1] === "pages";
  if (!usesSrcPages && packageSegments[0] !== "pages") return false;
  const rootPagesDirectory = path.join(packageDirectory, "pages");
  if (usesSrcPages && probe(rootPagesDirectory) !== "missing") return false;
  const pagesDirectory = usesSrcPages
    ? path.join(packageDirectory, "src", "pages")
    : rootPagesDirectory;
  const routeSegments = packageSegments.slice(usesSrcPages ? 2 : 1);
  const extension = path.extname(filename);
  const filenameStem = path.basename(filename, extension);
  routeSegments[routeSegments.length - 1] = filenameStem;
  if (
    routeSegments[0] === "api" ||
    !routeSegments.every(
      (segment) => ROUTE_SEGMENT.test(segment) || SIMPLE_DYNAMIC_SEGMENT.test(segment),
    )
  )
    return false;

  const manifest = readPackageManifest(packageDirectory);
  if (
    !manifest ||
    hasOwnField(manifest, PACKAGE_OVERRIDE_FIELDS) ||
    probe(path.join(packageDirectory, ".npmrc")) !== "missing" ||
    (Object.hasOwn(manifest, "type") &&
      probe(path.join(packageDirectory, "next.config.js")) !== "missing")
  )
    return false;
  for (const packageName of ["next", "react", "react-dom"]) {
    const dependency = manifest.dependencies?.[packageName];
    if (typeof dependency !== "string" || !REGISTRY_DEPENDENCY.test(dependency)) return false;
  }
  if (
    !hasStockBuildConfiguration(path.dirname(filename), packageDirectory, routeSegments[0]!) ||
    hasLocalRuntimeReplacement(filename)
  )
    return false;

  const routeStem = filename.slice(0, -extension.length);
  const alternateStem =
    filenameStem === "index"
      ? path.dirname(filename) === pagesDirectory
        ? null
        : path.dirname(filename)
      : path.join(routeStem, "index");
  if (
    PAGE_EXTENSIONS.some(
      (candidateExtension) =>
        (candidateExtension !== extension &&
          probe(`${routeStem}${candidateExtension}`) !== "missing") ||
        (alternateStem !== null && probe(`${alternateStem}${candidateExtension}`) !== "missing"),
    )
  )
    return false;
  const appPaths = PAGE_EXTENSIONS.map((extension) =>
    path.join(pagesDirectory, `_app${extension}`),
  );
  const presentApps = appPaths.filter((appPath) => probe(appPath) !== "missing");
  if (presentApps.length > 1) return false;
  const app = presentApps[0];
  if (app && !forwardsPageAsJsx(app)) return false;
  const documentPaths = PAGE_EXTENSIONS.map((extension) =>
    path.join(pagesDirectory, `_document${extension}`),
  );
  const presentDocuments = documentPaths.filter(
    (documentPath) => probe(documentPath) !== "missing",
  );
  if (presentDocuments.length > 1) return false;
  const document = presentDocuments[0];
  if (document && !isRenderOnlyStockDocument(document)) return false;
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

const OPAQUE_EVALUATOR_NAMES = new Set([
  "eval",
  "Function",
  "require",
  "System",
  "SystemJS",
  "importScripts",
]);
const GLOBAL_OBJECT_NAMES = new Set(["global", "globalThis", "self", "window"]);

const hasOpaqueEvaluation = (program: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let found = false;
  walkAst(program, (node) => {
    if (found) return false;
    if (isNodeOfType(node, "WithStatement")) {
      found = true;
      return false;
    }
    if (!isNodeOfType(node, "Identifier") || !scopes.isGlobalReference(node)) return;
    if (node.name === "eval" || node.name === "Function") {
      found = true;
      return false;
    }
    if (!GLOBAL_OBJECT_NAMES.has(node.name)) return;
    const use = node.parent;
    if (isNodeOfType(use, "UnaryExpression") && use.operator === "typeof") return;
    const member =
      isNodeOfType(use, "MemberExpression") && use.object === node
        ? getResolvedStaticPropertyName(use, scopes)
        : null;
    found = !member || OPAQUE_EVALUATOR_NAMES.has(member) || GLOBAL_OBJECT_NAMES.has(member);
  });
  return found;
};

const hasClosedPageConsumerSurface = (
  program: EsTreeNodeOfType<"Program">,
  scopes: ScopeAnalysis,
  filename: string,
): boolean => {
  const rootDirectory = findNearestPackageDirectory(filename);
  if (!rootDirectory) return false;
  const manifest = readPackageManifest(rootDirectory);
  if (!manifest || hasOwnField(manifest, ["exports", "imports", "main", "module"])) return false;
  const currentFilePath = normalizeFilename(path.resolve(filename));
  const pagesDirectory =
    path.relative(rootDirectory, filename).split(path.sep)[0] === "src"
      ? path.join(rootDirectory, "src", "pages")
      : path.join(rootDirectory, "pages");
  const index = buildSourceProjectIndex({
    rootDirectory,
    currentFilePath,
    currentProgramNode: program,
    currentScopes: scopes,
    includeTestlikeSources: true,
    javascriptAllowsJsx: true,
    // Next may discover a route in an ordinary directory named "build" or "dist".
    includeGeneratedSourcesUnder: pagesDirectory,
  });
  if (
    !index ||
    !index.modulesByFilePath.has(currentFilePath) ||
    index.hasOpaqueMdxConsumerSurface ||
    index.hasOpaqueRuntimeConsumerSurface ||
    index.consumerModulesByFilePath.has(currentFilePath)
  )
    return false;

  for (const source of index.unresolvedRuntimeSources) {
    const local = /^(?:\.\.?[\\/]|[@~]\/)/.test(source);
    const stylesheet = /\.(?:css|scss|sass|less)$/i.test(source);
    const selfImport =
      typeof manifest.name === "string" &&
      (source === manifest.name || source.startsWith(manifest.name + "/"));
    if ((local && !stylesheet) || selfImport) return false;
    if (
      source.startsWith("data:") ||
      source.startsWith("file:") ||
      path.isAbsolute(source) ||
      /[?#]/.test(source)
    )
      return false;
  }
  for (const module of index.modulesByFilePath.values()) {
    if (hasOpaqueEvaluation(module.programNode, module.scopes)) return false;
  }
  return true;
};

export const isNextPagesJavaScriptFile = (filename: string): boolean =>
  /(?:^|[\\/])pages[\\/].+\.js$/.test(filename);

export const getStockNextPagesComponent = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  filename: string | undefined,
): EsTreeNode | null => {
  const program = findProgramRoot(node);
  if (!filename || !/(?:^|[\\/])pages[\\/]/.test(filename) || !program) return null;
  const page = findExportedValue(program, "default");
  if (!page || !isFunctionLike(page) || page.async || page.generator) return null;
  const bindings = getFunctionBindingSymbols(page, scopes);
  const [binding] = bindings;
  if (
    bindings.length !== 1 ||
    !binding ||
    !/^[a-z]/.test(binding.name) ||
    isReactHookName(binding.name) ||
    (binding.kind !== "const" && binding.kind !== "function") ||
    !binding.references.every(
      ({ identifier, flag }) =>
        flag === "read" &&
        isNodeOfType(identifier.parent, "ExportDefaultDeclaration") &&
        identifier.parent.declaration === identifier,
    ) ||
    !hasOwnJsxReturn(page)
  )
    return null;
  return hasStockNextPagesRouter(filename) &&
    !hasPossiblePageSelfImport(program, scopes, filename) &&
    hasClosedPageConsumerSurface(program, scopes, filename)
    ? page
    : null;
};
