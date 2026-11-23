import * as path from "node:path";
import type { SourceProjectModule } from "../../utils/build-source-project-index.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getImportDeclarationForSymbol } from "../../utils/get-import-declaration-for-symbol.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { hasCompleteSymbolReferences } from "../../utils/has-complete-symbol-references.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTypeOnlyImport } from "../../utils/is-type-only-import.js";
import { resolveStockPhysicalEntry } from "../../utils/stock-vite-providers/resolve-stock-physical-entry.js";
import { STOCK_JEST_RENDERER_PACKAGES } from "../../utils/stock-vite-providers/stock-jest-renderer-catalogue.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { provesBareJestNullContextStop } from "./proves-bare-jest-null-context-stop.js";
import {
  getJestLocalModuleId,
  readLoadingJestModuleCuts,
  type LoadingJestModuleEdge,
  type LoadingJestRoutesInput,
  type LoadingJestTestRoute,
} from "./read-loading-jest-module-cuts.js";
import {
  omitsNamedHookFromOwnedJestMock,
  readPlainJestPreRenderHookSites,
} from "./read-plain-jest-prerender-stop.js";

type Module = SourceProjectModule;
type ReadStockReact = (unit: Module) => boolean;
type ModuleMode = "instantiated" | "active";
type ActivationCut = (edge: LoadingJestModuleEdge, unit: Module) => boolean;

interface OtherMountedLoadingTestsInput extends LoadingJestRoutesInput {
  readonly jestReactEntry: string;
}

const isLexicalReactObject = (unit: Module, token: EsTreeNode): boolean => {
  const bound = unit.scopes.symbolFor(token);
  const imported = bound && getImportDeclarationForSymbol(bound);
  return Boolean(
    bound &&
    imported &&
    !isTypeOnlyImport(imported) &&
    imported.source.value === "react" &&
    (isNodeOfType(bound.declarationNode, "ImportDefaultSpecifier") ||
      isNodeOfType(bound.declarationNode, "ImportNamespaceSpecifier")) &&
    hasCompleteSymbolReferences(bound, unit.programNode, unit.scopes) &&
    bound.references.every(({ flag }) => flag === "read"),
  );
};

const isKnownReactCall = (
  unit: Module,
  node: EsTreeNode,
  name: string,
  stock: ReadStockReact,
): boolean => {
  if (!isNodeOfType(node, "CallExpression") || node.optional) return false;
  const callee = node.callee;
  if (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.optional &&
    getStaticPropertyKeyName(callee) === name
  )
    return isLexicalReactObject(unit, callee.object) && stock(unit);
  const bound = unit.scopes.symbolFor(callee);
  const imported = bound && getImportDeclarationForSymbol(bound);
  const specifier = bound?.declarationNode;
  return Boolean(
    bound &&
    imported &&
    !isTypeOnlyImport(imported) &&
    imported.source.value === "react" &&
    isNodeOfType(specifier, "ImportSpecifier") &&
    specifier.importKind !== "type" &&
    isNodeOfType(specifier.imported, "Identifier") &&
    specifier.imported.name === name &&
    hasCompleteSymbolReferences(bound, unit.programNode, unit.scopes) &&
    bound.references.every(({ flag }) => flag === "read") &&
    stock(unit),
  );
};

const isDeferredImport = (unit: Module, site: EsTreeNode, stock: ReadStockReact): boolean => {
  if (!isNodeOfType(site, "ImportExpression") || site.options) return false;
  const load = site.parent;
  const call = load?.parent;
  const definition = call?.parent;
  if (
    !isNodeOfType(load, "ArrowFunctionExpression") ||
    load.async ||
    load.params.length !== 0 ||
    load.body !== site ||
    !isNodeOfType(call, "CallExpression") ||
    !isKnownReactCall(unit, call, "lazy", stock) ||
    call.arguments.length !== 1 ||
    call.arguments[0] !== load ||
    !isNodeOfType(definition, "VariableDeclarator") ||
    definition.init !== call ||
    !isNodeOfType(definition.id, "Identifier")
  )
    return false;
  const symbol = unit.scopes.symbolFor(definition.id);
  return Boolean(
    symbol?.kind === "const" &&
    hasCompleteSymbolReferences(symbol, unit.programNode, unit.scopes) &&
    symbol.references.every(
      ({ flag, identifier }) =>
        flag === "read" &&
        (isNodeOfType(identifier.parent, "JSXOpeningElement") ||
          isNodeOfType(identifier.parent, "JSXClosingElement")) &&
        identifier.parent.name === identifier &&
        Boolean(findEnclosingFunction(identifier)),
    ),
  );
};

const coldValue = (unit: Module, input: EsTreeNode, stock: ReadStockReact): boolean => {
  const node = stripParenExpression(input);
  if (
    isNodeOfType(node, "Literal") ||
    isNodeOfType(node, "ArrowFunctionExpression") ||
    isNodeOfType(node, "FunctionExpression")
  )
    return true;
  if (isNodeOfType(node, "Identifier")) {
    const bound = unit.scopes.symbolFor(node);
    // Reading an imported CJS export can run a getter. Limit inert aliases to
    // direct locals, including the outer binding of function declarations.
    return bound?.kind === "const" || bound?.kind === "function";
  }
  if (isNodeOfType(node, "ObjectExpression"))
    return node.properties.every(
      (prop) =>
        isNodeOfType(prop, "Property") &&
        prop.kind === "init" &&
        getStaticPropertyKeyName(prop) !== null &&
        coldValue(unit, prop.value, stock),
    );
  if (isNodeOfType(node, "ArrayExpression"))
    return node.elements.every((part) => part !== null && coldValue(unit, part, stock));
  if (!isNodeOfType(node, "CallExpression")) return false;
  if (isKnownReactCall(unit, node, "memo", stock))
    return node.arguments.length === 1 && coldValue(unit, node.arguments[0], stock);
  if (isKnownReactCall(unit, node, "createContext", stock))
    return node.arguments.length === 1 && coldValue(unit, node.arguments[0], stock);
  return (
    isKnownReactCall(unit, node, "lazy", stock) &&
    node.arguments.length === 1 &&
    isNodeOfType(node.arguments[0], "ArrowFunctionExpression") &&
    isDeferredImport(unit, node.arguments[0].body, stock)
  );
};

const coldStatement = (unit: Module, node: EsTreeNode, stock: ReadStockReact): boolean => {
  if (
    isNodeOfType(node, "ImportDeclaration") ||
    isNodeOfType(node, "FunctionDeclaration") ||
    isNodeOfType(node, "TSTypeAliasDeclaration") ||
    isNodeOfType(node, "TSInterfaceDeclaration") ||
    isNodeOfType(node, "EmptyStatement")
  )
    return true;
  if (isNodeOfType(node, "ExportNamedDeclaration"))
    return node.declaration ? coldStatement(unit, node.declaration, stock) : node.source === null;
  if (isNodeOfType(node, "ExportDefaultDeclaration"))
    return (
      isNodeOfType(node.declaration, "FunctionDeclaration") ||
      coldValue(unit, node.declaration, stock)
    );
  return (
    isNodeOfType(node, "VariableDeclaration") &&
    node.kind === "const" &&
    node.declarations.every(
      (d) =>
        isNodeOfType(d, "VariableDeclarator") &&
        isNodeOfType(d.id, "Identifier") &&
        d.init !== null &&
        coldValue(unit, d.init, stock),
    )
  );
};

const isMissingNamedMockRenderEdge = (
  edge: LoadingJestModuleEdge,
  unit: Module,
  route: LoadingJestTestRoute,
): boolean => {
  if (
    !isNodeOfType(edge.site, "ImportDeclaration") ||
    isTypeOnlyImport(edge.site) ||
    edge.site.specifiers.length === 0
  )
    return false;
  const owners = new Set<EsTreeNodeOfType<"FunctionDeclaration">>();
  for (const item of edge.site.specifiers) {
    if (isNodeOfType(item, "ImportSpecifier") && item.importKind === "type") continue;
    if (!isNodeOfType(item, "ImportSpecifier") && !isNodeOfType(item, "ImportDefaultSpecifier"))
      return false;
    const bound = unit.scopes.symbolFor(item.local);
    if (!bound || !hasCompleteSymbolReferences(bound, unit.programNode, unit.scopes)) return false;
    for (const { flag, identifier } of bound.references) {
      const jsx = identifier.parent;
      if (
        flag !== "read" ||
        !isNodeOfType(identifier, "JSXIdentifier") ||
        (!isNodeOfType(jsx, "JSXOpeningElement") && !isNodeOfType(jsx, "JSXClosingElement")) ||
        jsx.name !== identifier
      )
        return false;
      const owner = findEnclosingFunction(jsx);
      if (!isNodeOfType(owner, "FunctionDeclaration")) return false;
      owners.add(owner);
    }
  }
  return (
    owners.size > 0 &&
    [...owners].every((owner) =>
      readPlainJestPreRenderHookSites(unit, owner).some((hook) => {
        const target = route.resolve(unit.filePath, hook.specifier);
        const matched =
          target?.kind === "local" && route.substitutions.get(getJestLocalModuleId(target));
        return Boolean(matched && omitsNamedHookFromOwnedJestMock(hook, matched));
      }),
    )
  );
};

const staysUnmounted = (
  route: LoadingJestTestRoute,
  input: OtherMountedLoadingTestsInput,
  stock: ReadStockReact,
  cuts: ActivationCut,
): boolean => {
  const edgesByIssuer = new Map<string, LoadingJestModuleEdge[]>();
  for (const edge of route.effectiveEdges) {
    const edges = edgesByIssuer.get(edge.issuer) ?? [];
    edges.push(edge);
    edgesByIssuer.set(edge.issuer, edges);
  }
  const pending: { file: string; mode: ModuleMode }[] = [];
  const modes = new Map<string, ModuleMode>();
  const add = (file: string, mode: ModuleMode) => {
    const previous = modes.get(file);
    if (previous === mode || previous === "active") return;
    modes.set(file, mode);
    pending.push({ file, mode });
  };
  add(route.testFile, "active");
  for (const { file, mode } of pending) {
    if (file === input.focalFile) return false;
    const unit = input.project.index.modulesByFilePath.get(file);
    if (!unit) return false;
    const next = edgesByIssuer.get(file) ?? [];
    if (!next.length) continue;
    const cold =
      mode === "instantiated" &&
      unit.programNode.body.every((statement) => coldStatement(unit, statement, stock));
    for (const edge of next) {
      if (cold && edge.site && isDeferredImport(unit, edge.site, stock)) continue;
      const coldDependency = cold && isNodeOfType(edge.site, "ImportDeclaration");
      const onlyInstantiate = coldDependency || cuts(edge, unit);
      // Still evaluate the imported file's module body after a render cut.
      add(edge.target, onlyInstantiate ? "instantiated" : "active");
    }
  }
  return true;
};

export const hasNoOtherMountedLoadingTests = (input: OtherMountedLoadingTestsInput): boolean => {
  try {
    if (input.jestReactEntry !== input.project.browser.react.entry) return false;
    const routes = readLoadingJestModuleCuts(input);
    if (!routes) return false;
    const verifiedByIssuer = new Map<string, boolean>();
    const stock: ReadStockReact = (unit) => {
      const dir = path.dirname(unit.filePath);
      const result = verifiedByIssuer.get(dir);
      if (result !== undefined) return result;
      const selected = resolveStockPhysicalEntry({
        projectRoot: input.projectRoot,
        importerDirectory: dir,
        profile: "jest-browser",
        specifier: "react",
        contract: STOCK_JEST_RENDERER_PACKAGES.react,
      });
      const accepted = selected?.entry === input.jestReactEntry;
      verifiedByIssuer.set(dir, accepted);
      return accepted;
    };
    return routes.every((route) =>
      staysUnmounted(route, input, stock, (edge, unit) => {
        if (isMissingNamedMockRenderEdge(edge, unit, route)) return true;
        if (
          unit.filePath !== route.testFile ||
          !edge.site ||
          !isNodeOfType(edge.site, "ImportDeclaration")
        )
          return false;
        const component = input.project.index.modulesByFilePath.get(edge.target);
        return Boolean(
          component &&
          provesBareJestNullContextStop({
            test: unit,
            component,
            site: edge.site,
            project: input.project,
            resolve: route.resolve,
            substitutions: route.substitutions,
            effectiveJestSources: route.integritySources,
            hasStockReactEntry: stock,
          }),
        );
      }),
    );
  } catch {
    return false;
  }
};
