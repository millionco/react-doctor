import * as path from "node:path";
import { REACT_STATIC_PLUGIN_MAJOR_VERSION } from "../constants/react-static.js";
import { BUILTIN_HOOK_NAMES, REACT_RUNTIME_MODULE_SOURCES } from "../constants/react.js";
import { findProgramRoot } from "./find-program-root.js";
import { collectFunctionReturnStatements } from "./collect-function-return-statements.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactHookName } from "./is-react-hook-name.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { parsePackageVersion } from "./parse-package-version.js";
import {
  findNearestPackageDirectory,
  readNearestPackageManifest,
} from "./read-nearest-package-manifest.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { RuleContext } from "./rule-context.js";

const isNonReferenceName = (node: EsTreeNode): boolean => {
  const parent = node.parent;
  return (
    isTypeScriptTypePosition(node) ||
    parent?.type === "ImportSpecifier" ||
    parent?.type === "ImportDefaultSpecifier" ||
    parent?.type === "ImportNamespaceSpecifier" ||
    (isNodeOfType(parent, "MemberExpression") && !parent.computed && parent.property === node) ||
    (isNodeOfType(parent, "Property") &&
      !parent.computed &&
      !parent.shorthand &&
      parent.key === node)
  );
};

const hasOwnHookOrSuspension = (root: EsTreeNode): boolean => {
  let found = false;
  walkAst(root, (node) => {
    if (found || isTypeScriptTypePosition(node)) return false;
    if (node !== root && isFunctionLike(node)) return false;
    if (node.type === "AwaitExpression" || node.type === "YieldExpression") found = true;
    if (!isNodeOfType(node, "CallExpression")) return;
    const callee = stripParenExpression(node.callee);
    let hookName: string | null = null;
    if (isNodeOfType(callee, "Identifier")) {
      hookName = callee.name;
    } else if (isNodeOfType(callee, "MemberExpression")) {
      hookName = getStaticPropertyName(callee);
    }
    if (hookName && isReactHookName(hookName)) found = true;
  });
  return found;
};

const hasDirectOwnJsxReturn = (node: EsTreeNode): boolean => {
  if (!isFunctionLike(node) || !node.body) return false;
  const body = stripParenExpression(node.body);
  if (body.type === "JSXElement" || body.type === "JSXFragment") return true;
  return collectFunctionReturnStatements(node).some((statement) => {
    if (!statement.argument) return false;
    const value = stripParenExpression(statement.argument);
    return value.type === "JSXElement" || value.type === "JSXFragment";
  });
};

const hasClosedReactProviders = (program: EsTreeNode, context: RuleContext): boolean => {
  const imports = new Set<EsTreeNode>();
  walkAst(program, (node) => {
    if (
      !isNodeOfType(node, "ImportDeclaration") ||
      node.importKind === "type" ||
      typeof node.source.value !== "string" ||
      !REACT_RUNTIME_MODULE_SOURCES.has(node.source.value)
    )
      return;
    for (const specifier of node.specifiers) {
      if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type") continue;
      imports.add(specifier.local);
    }
  });
  if (imports.size === 0) return false;
  const importedNames = new Set(
    [...imports].flatMap((node) => (isNodeOfType(node, "Identifier") ? [node.name] : [])),
  );
  let closed = true;
  walkAst(program, (node) => {
    if (!closed || isTypeScriptTypePosition(node)) return false;
    if (node.type === "WithStatement") closed = false;
    if (isNodeOfType(node, "MemberExpression")) {
      const property = getStaticPropertyName(node);
      if (
        property === null ||
        ["constructor", "eval", "Function", "React", "Reflect"].includes(property)
      )
        closed = false;
    }
    if (isNodeOfType(node, "Property")) {
      const key = getStaticPropertyKeyName(node, { allowComputedString: true });
      if (
        key === "React" ||
        (isNodeOfType(node.parent, "ObjectPattern") &&
          (key === null || ["constructor", "eval", "Function", "Reflect"].includes(key)))
      )
        closed = false;
    }
    if (
      isNodeOfType(node, "CallExpression") &&
      isNodeOfType(node.arguments[1], "Literal") &&
      node.arguments[1].value === "React"
    )
      closed = false;
    if (!isNodeOfType(node, "Identifier") || isNonReferenceName(node)) return;
    if (node.name === "Reflect") {
      closed = false;
      return;
    }
    const ownSymbol = context.scopes.symbolFor(node);
    if (node.name === "React" && (!ownSymbol || !imports.has(ownSymbol.bindingIdentifier))) {
      closed = false;
      return;
    }
    if (ownSymbol?.bindingIdentifier === node) return;
    if (node.name === "eval" || node.name === "Function") {
      closed = false;
      return;
    }
    if (!importedNames.has(node.name)) return;
    const reference = context.scopes.referenceFor(node);
    if (!reference) {
      closed = false;
      return;
    }
    if (!reference.resolvedSymbol || !imports.has(reference.resolvedSymbol.bindingIdentifier))
      return;
    if (reference.flag !== "read") {
      closed = false;
      return;
    }
    const declaration = reference.resolvedSymbol.declarationNode;
    const parent = stripParenExpression(node).parent;
    if (isNodeOfType(declaration, "ImportSpecifier")) {
      if (!isNodeOfType(parent, "CallExpression") || parent.callee !== node) closed = false;
      return;
    }
    if (
      !isNodeOfType(parent, "MemberExpression") ||
      parent.object !== node ||
      !(
        BUILTIN_HOOK_NAMES.has(getStaticPropertyName(parent) ?? "") ||
        getStaticPropertyName(parent) === "useEffectEvent" ||
        getStaticPropertyName(parent) === "createElement"
      ) ||
      !isNodeOfType(parent.parent, "CallExpression") ||
      parent.parent.callee !== parent
    )
      closed = false;
  });
  return closed;
};

const previousComponentIsReadonlyJsx = (
  factory: EsTreeNode,
  parameter: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(parameter, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(parameter);
  if (!symbol) return false;
  let closed = true;
  let sawComponentReference = false;
  walkAst(factory, (node) => {
    if (!closed || isTypeScriptTypePosition(node)) return false;
    if (
      (node.type !== "Identifier" && node.type !== "JSXIdentifier") ||
      node.name !== parameter.name ||
      node === parameter ||
      isNonReferenceName(node)
    )
      return;
    const ownSymbol = context.scopes.symbolFor(node);
    if (ownSymbol?.bindingIdentifier === node) return;
    const reference = context.scopes.referenceFor(node);
    if (!reference) {
      closed = false;
      return;
    }
    if (reference.resolvedSymbol !== symbol) return;
    const parent = node.parent;
    if (
      reference.flag !== "read" ||
      (parent?.type !== "JSXOpeningElement" && parent?.type !== "JSXClosingElement") ||
      parent.name !== node
    ) {
      closed = false;
      return;
    }
    sawComponentReference = true;
  });
  return closed && sawComponentReference;
};

export const collectReactStaticPluginRenderFunctions = (
  node: EsTreeNode,
  context: RuleContext,
): ReadonlySet<EsTreeNode> => {
  const renderFunctions = new Set<EsTreeNode>();
  try {
    const filename = context.filename;
    if (!filename || path.basename(filename) !== "browser.api.js") return renderFunctions;
    const packageDirectory = findNearestPackageDirectory(filename);
    const manifest = readNearestPackageManifest(filename);
    if (
      !packageDirectory ||
      manifest?.main !== "browser.api.js" ||
      typeof manifest.peerDependencies?.react !== "string"
    )
      return renderFunctions;
    const relativePath = path.relative(packageDirectory, filename).split(path.sep).join("/");
    if (relativePath !== "browser.api.js" && relativePath !== "src/browser.api.js")
      return renderFunctions;
    const versionRange = manifest.peerDependencies?.["react-static"];
    if (typeof versionRange !== "string" || !/^[~^]?\d+(?:\.\d+){0,2}$/.test(versionRange))
      return renderFunctions;
    const version = parsePackageVersion(versionRange.replace(/^[~^]/, ""));
    if (version?.major !== REACT_STATIC_PLUGIN_MAJOR_VERSION || version.isPrerelease)
      return renderFunctions;
    const program = findProgramRoot(node);
    if (!program || !hasClosedReactProviders(program, context)) return renderFunctions;
    const defaultExports = program.body.filter(
      (statement) => statement.type === "ExportDefaultDeclaration",
    );
    if (defaultExports.length !== 1) return renderFunctions;
    const selectedExport = defaultExports[0];
    if (!isNodeOfType(selectedExport, "ExportDefaultDeclaration")) return renderFunctions;
    const plugin = stripParenExpression(selectedExport.declaration);
    if (
      !isNodeOfType(plugin, "ArrowFunctionExpression") ||
      plugin.async ||
      hasOwnHookOrSuspension(plugin)
    )
      return renderFunctions;
    const record = stripParenExpression(plugin.body);
    if (!isNodeOfType(record, "ObjectExpression") || record.properties.length === 0)
      return renderFunctions;
    const seenProperties = new Set<string>();
    const candidates: EsTreeNode[] = [];
    for (const property of record.properties) {
      if (
        !isNodeOfType(property, "Property") ||
        property.kind !== "init" ||
        property.computed ||
        property.method ||
        !isNodeOfType(property.key, "Identifier") ||
        (property.key.name !== "Root" && property.key.name !== "Routes") ||
        seenProperties.has(property.key.name)
      )
        return renderFunctions;
      seenProperties.add(property.key.name);
      const factory = stripParenExpression(property.value);
      if (
        !isNodeOfType(factory, "ArrowFunctionExpression") ||
        factory.async ||
        factory.params.length !== 1 ||
        !isNodeOfType(factory.params[0], "Identifier") ||
        hasOwnHookOrSuspension(factory)
      )
        return renderFunctions;
      const renderFunction = stripParenExpression(factory.body);
      if (
        !isFunctionLike(renderFunction) ||
        renderFunction.async ||
        renderFunction.generator ||
        !previousComponentIsReadonlyJsx(factory, factory.params[0], context) ||
        !hasDirectOwnJsxReturn(renderFunction)
      )
        return renderFunctions;
      candidates.push(renderFunction);
    }
    for (const candidate of candidates) renderFunctions.add(candidate);
  } catch {
    return new Set<EsTreeNode>();
  }
  return renderFunctions;
};
