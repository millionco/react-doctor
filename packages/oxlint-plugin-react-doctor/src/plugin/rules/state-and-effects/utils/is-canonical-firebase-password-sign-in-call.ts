import { hasReadonlyAsyncEventBinding } from "./has-readonly-async-event-binding.js";
import type { AsyncEventSourceModule } from "./has-readonly-async-event-binding.js";
import * as path from "node:path";
import { analyzeScopes } from "../../../semantic/scope-analysis.js";
import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getImportBindingForName } from "../../../utils/find-import-source-for-name.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { hasOnlyAllowedSymbolReads } from "../../../utils/has-only-allowed-symbol-reads.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { resolveConstIdentifierAlias } from "../../../utils/resolve-const-identifier-alias.js";
import { resolveCrossFileValueExportWithFilePath } from "../../../utils/resolve-cross-file-function-export.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { hasCanonicalControlPackageProfile } from "./has-canonical-control-package-profile.js";
import {
  FIREBASE_PASSWORD_SIGN_IN_ARGUMENT_COUNT,
  FIREBASE_AUTH_ALLOWED_API_NAMES,
  FIREBASE_AUTH_INSTANCE_API_NAMES,
  FIREBASE_AUTH_REFUSED_SOURCE_NAMES,
  CANONICAL_CONTROL_REFUSED_GLOBAL_NAMES,
} from "./constants.js";

interface CanonicalFirebasePasswordSignInInput {
  readonly expression: EsTreeNode;
  readonly context: RuleContext;
}

const readFirebaseApi = (rawValue: EsTreeNode, module: AsyncEventSourceModule): string | null => {
  const value = stripParenExpression(rawValue);
  if (!isNodeOfType(value, "Identifier")) return null;
  const symbol = module.scopes.symbolFor(value);
  const declaration = symbol ? getImportDeclarationForSymbol(symbol) : null;
  const imported = getImportBindingForName(module.program, value.name);
  return symbol?.kind === "import" &&
    declaration?.importKind !== "type" &&
    isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
    symbol.declarationNode.importKind !== "type" &&
    imported?.source === "firebase/auth" &&
    !imported.isNamespace &&
    imported.exportedName !== null &&
    FIREBASE_AUTH_ALLOWED_API_NAMES.has(imported.exportedName) &&
    hasReadonlyAsyncEventBinding(symbol, module)
    ? imported.exportedName
    : null;
};

const hasCanonicalFirebaseSource = (module: AsyncEventSourceModule): boolean => {
  if (!hasCanonicalControlPackageProfile({ filename: module.filename, packageName: "firebase" }))
    return false;
  let supported = true;
  walkAst(module.program, (node) => {
    if (!supported) return false;
    if (
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "TSImportEqualsDeclaration") ||
      isNodeOfType(node, "TSExportAssignment") ||
      isNodeOfType(node, "TSParameterProperty") ||
      isNodeOfType(node, "TSEnumDeclaration") ||
      isNodeOfType(node, "TSModuleDeclaration")
    ) {
      supported = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (
      isNodeOfType(node, "Identifier") &&
      CANONICAL_CONTROL_REFUSED_GLOBAL_NAMES.has(node.name) &&
      module.scopes.isGlobalReference(node)
    )
      supported = false;
    if (
      isNodeOfType(node, "MemberExpression") &&
      ["constructor", "prototype", "__proto__"].includes(getStaticPropertyName(node) ?? "")
    )
      supported = false;
    if (!isNodeOfType(node, "ImportDeclaration") || node.importKind === "type") return;
    if (typeof node.source.value !== "string" || node.source.value.startsWith("@firebase/")) {
      supported = false;
      return false;
    }
    if (node.source.value.startsWith("firebase/")) {
      for (const specifier of node.specifiers) {
        if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type") continue;
        const imported = getImportBindingForName(module.program, specifier.local.name);
        if (
          !imported ||
          imported.isNamespace ||
          imported.exportedName === "default" ||
          imported.exportedName?.startsWith("_") ||
          (node.source.value === "firebase/app" && imported.exportedName !== "initializeApp")
        ) {
          supported = false;
          return false;
        }
      }
    }
    if (
      node.source.value !== "react" &&
      node.specifiers.some((specifier) => isNodeOfType(specifier, "ImportNamespaceSpecifier"))
    ) {
      supported = false;
      return false;
    }
    if (FIREBASE_AUTH_REFUSED_SOURCE_NAMES.has(node.source.value)) {
      supported = false;
      return false;
    }
    if (node.source.value !== "firebase/auth") return;
    for (const specifier of node.specifiers) {
      if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type") continue;
      const name = readFirebaseApi(specifier.local, module);
      const symbol = module.scopes.symbolFor(specifier.local);
      if (!name || !symbol) {
        supported = false;
        return false;
      }
      const allowed = new Set<EsTreeNode>();
      for (const reference of symbol.references) {
        const value = findTransparentExpressionRoot(reference.identifier);
        const parent = value.parent;
        if (
          (name === "GoogleAuthProvider" &&
            isNodeOfType(parent, "NewExpression") &&
            parent.callee === value) ||
          (name !== "GoogleAuthProvider" &&
            isNodeOfType(parent, "CallExpression") &&
            !parent.optional &&
            parent.callee === value)
        )
          allowed.add(reference.identifier);
        else {
          supported = false;
          return false;
        }
      }
      if (
        !hasOnlyAllowedSymbolReads({
          symbol,
          allowedIdentifiers: allowed,
          program: module.program,
          scopes: module.scopes,
        })
      )
        supported = false;
    }
  });
  return supported;
};

const hasClosedAuthValueReads = (
  symbol: SymbolDescriptor,
  module: AsyncEventSourceModule,
  visited = new Set<SymbolDescriptor>(),
): boolean => {
  if (visited.has(symbol) || !hasReadonlyAsyncEventBinding(symbol, module)) return false;
  visited.add(symbol);
  const allowed = new Set<EsTreeNode>();
  for (const reference of symbol.references) {
    const value = findTransparentExpressionRoot(reference.identifier);
    const parent = value.parent;
    if (
      (isNodeOfType(parent, "ExportSpecifier") && parent.local === value) ||
      (isNodeOfType(parent, "ExportDefaultDeclaration") && parent.declaration === value)
    )
      allowed.add(reference.identifier);
    else if (
      isNodeOfType(parent, "CallExpression") &&
      !parent.optional &&
      parent.arguments[0] === value &&
      FIREBASE_AUTH_INSTANCE_API_NAMES.has(readFirebaseApi(parent.callee, module) ?? "")
    )
      allowed.add(reference.identifier);
    else if (
      isNodeOfType(parent, "VariableDeclarator") &&
      parent.init === value &&
      isNodeOfType(parent.id, "Identifier") &&
      isNodeOfType(parent.parent, "VariableDeclaration") &&
      parent.parent.kind === "const"
    ) {
      const alias = module.scopes.symbolFor(parent.id);
      if (!alias || !hasClosedAuthValueReads(alias, module, visited)) return false;
      allowed.add(reference.identifier);
    } else return false;
  }
  return hasOnlyAllowedSymbolReads({
    symbol,
    allowedIdentifiers: allowed,
    program: module.program,
    scopes: module.scopes,
  });
};

export const isCanonicalFirebasePasswordSignInCall = ({
  expression,
  context,
}: CanonicalFirebasePasswordSignInInput): boolean => {
  try {
    const call = stripParenExpression(expression);
    if (
      !context.filename ||
      !isNodeOfType(call, "CallExpression") ||
      call.optional ||
      call.arguments.length !== FIREBASE_PASSWORD_SIGN_IN_ARGUMENT_COUNT ||
      call.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
    )
      return false;
    const caller: AsyncEventSourceModule = {
      filename: path.resolve(context.filename),
      program: context.scopes.rootScope.node,
      scopes: context.scopes,
    };
    if (
      readFirebaseApi(call.callee, caller) !== "signInWithEmailAndPassword" ||
      !hasCanonicalFirebaseSource(caller)
    )
      return false;
    const modules = new Map<string, AsyncEventSourceModule>([[caller.filename, caller]]);
    const visited = new Set<EsTreeNode>();
    let authOrigin: EsTreeNode | null = null;
    const resolveAuthOrigin = (rawValue: EsTreeNode, module: AsyncEventSourceModule): boolean => {
      const value = stripParenExpression(rawValue);
      if (isNodeOfType(value, "CallExpression")) {
        const supported =
          !value.optional &&
          value.arguments.length === 0 &&
          readFirebaseApi(value.callee, module) === "getAuth" &&
          hasCanonicalFirebaseSource(module);
        if (supported) authOrigin = value;
        return supported;
      }
      if (!isNodeOfType(value, "Identifier")) return false;
      const symbol = module.scopes.symbolFor(value);
      if (
        !symbol ||
        visited.has(symbol.declarationNode) ||
        !hasClosedAuthValueReads(symbol, module)
      )
        return false;
      visited.add(symbol.declarationNode);
      if (symbol.kind === "import") {
        const imported = getImportBindingForName(module.program, value.name);
        if (!imported || imported.isNamespace || imported.exportedName === null) return false;
        const resolved = resolveCrossFileValueExportWithFilePath(
          module.filename,
          imported.source,
          imported.exportedName,
          { requireCompleteReexports: true },
        );
        if (!resolved?.contexts?.length) return false;
        for (const entry of resolved.contexts) {
          let target = modules.get(entry.filePath);
          if (!target) {
            target = {
              filename: entry.filePath,
              program: entry.programNode,
              scopes: analyzeScopes(entry.programNode),
            };
            modules.set(entry.filePath, target);
          }
          if (target.program !== entry.programNode || !hasCanonicalFirebaseSource(target))
            return false;
        }
        const owner = modules.get(resolved.filePath);
        const initializer = findTransparentExpressionRoot(resolved.exportedNode);
        const declaration = initializer.parent;
        return Boolean(
          owner &&
          isNodeOfType(declaration, "VariableDeclarator") &&
          declaration.init === initializer &&
          isNodeOfType(declaration.id, "Identifier") &&
          isNodeOfType(declaration.parent, "VariableDeclaration") &&
          declaration.parent.kind === "const" &&
          resolveAuthOrigin(declaration.id, owner),
        );
      }
      const declaration = symbol.declarationNode;
      return (
        symbol.kind === "const" &&
        isNodeOfType(declaration, "VariableDeclarator") &&
        isNodeOfType(declaration.id, "Identifier") &&
        isNodeOfType(declaration.parent, "VariableDeclaration") &&
        declaration.parent.kind === "const" &&
        Boolean(declaration.init && resolveAuthOrigin(declaration.init, module))
      );
    };
    if (!resolveAuthOrigin(call.arguments[0], caller) || !authOrigin) return false;
    for (const module of modules.values()) {
      let uniqueDefaultInstanceOrigin = true;
      walkAst(module.program, (node) => {
        if (
          isNodeOfType(node, "CallExpression") &&
          readFirebaseApi(node.callee, module) === "getAuth" &&
          node !== authOrigin
        )
          uniqueDefaultInstanceOrigin = false;
      });
      if (!uniqueDefaultInstanceOrigin) return false;
      for (const symbol of module.scopes.rootScope.symbols) {
        if (symbol.kind !== "import") continue;
        const imported = getImportBindingForName(module.program, symbol.name);
        if (!imported || imported.isNamespace || imported.exportedName === null) continue;
        const resolved = resolveCrossFileValueExportWithFilePath(
          module.filename,
          imported.source,
          imported.exportedName,
          { requireCompleteReexports: true },
        );
        const owner = resolved ? modules.get(resolved.filePath) : null;
        if (!resolved || !owner) continue;
        let origin = stripParenExpression(resolved.exportedNode);
        if (isNodeOfType(origin, "Identifier")) {
          const local = resolveConstIdentifierAlias(origin, owner.scopes);
          if (
            local?.kind === "const" &&
            local.initializer &&
            hasReadonlyAsyncEventBinding(local, owner)
          )
            origin = stripParenExpression(local.initializer);
        }
        if (origin === authOrigin && !hasClosedAuthValueReads(symbol, module)) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
};
