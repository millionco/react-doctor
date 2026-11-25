import type {
  ReferenceDescriptor,
  ScopeAnalysis,
  SymbolDescriptor,
} from "../../semantic/scope-analysis.js";
import { collectFunctionReturnStatements } from "../../utils/collect-function-return-statements.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getDirectConstInitializer } from "../../utils/get-direct-const-initializer.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { hasCompleteSymbolReferences } from "../../utils/has-complete-symbol-references.js";
import { isAstDescendant } from "../../utils/is-ast-descendant.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import { isSymbolReadOnly } from "../../utils/is-symbol-read-only.js";
import { isTypeScriptTypePosition } from "../../utils/is-typescript-type-position.js";
import { hasOrdinaryReactResolution } from "../../utils/has-ordinary-react-resolution.js";
import { resolveImportedApiReference } from "../../utils/resolve-imported-api-reference.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const getFirstDirectConst = (body: EsTreeNode, scopes: ScopeAnalysis) => {
  if (!isNodeOfType(body, "BlockStatement")) return null;
  const firstStatement = body.body[0];
  if (!isNodeOfType(firstStatement, "VariableDeclaration")) return null;
  const [declaration] = firstStatement.declarations;
  if (
    firstStatement.declarations.length !== 1 ||
    !declaration ||
    !isNodeOfType(declaration.id, "Identifier")
  ) {
    return null;
  }
  const symbol = scopes.symbolFor(declaration.id);
  const initializer = symbol && getDirectConstInitializer(symbol);
  return symbol && initializer && isSymbolReadOnly(symbol)
    ? { symbol, initializer: stripParenExpression(initializer) }
    : null;
};

const isDirectNamedReactCall = (
  expression: EsTreeNode | null | undefined,
  name: "useCallback" | "useRef",
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(expression, "CallExpression") ||
    expression.optional ||
    !isNodeOfType(expression.callee, "Identifier") ||
    !isNodeOfType(scopes.symbolFor(expression.callee)?.declarationNode, "ImportSpecifier")
  ) {
    return false;
  }
  const api = resolveImportedApiReference(expression.callee, scopes);
  return api?.source === "react" && api.importedName === name;
};

const hasOnlySimpleRenderParameters = (parameters: readonly EsTreeNode[]): boolean =>
  parameters.every(
    (parameter) =>
      isNodeOfType(parameter, "Identifier") ||
      (isNodeOfType(parameter, "ObjectPattern") &&
        parameter.properties.every(
          (property) =>
            isNodeOfType(property, "Property") &&
            !property.computed &&
            isNodeOfType(property.value, "Identifier"),
        )),
  );

const hasReactProviderHazardByScope = new WeakMap<ScopeAnalysis, boolean>();

const hasReactProviderHazard = (scopes: ScopeAnalysis): boolean => {
  const cached = hasReactProviderHazardByScope.get(scopes);
  if (cached !== undefined) return cached;
  const program = scopes.rootScope.node;
  const typeOnlyNamespaceBindings = new Map<string, EsTreeNode>();
  if (!isNodeOfType(program, "Program")) return true;
  for (const statement of program.body) {
    if (!isNodeOfType(statement, "ImportDeclaration") || statement.source.value !== "react") {
      continue;
    }
    if (statement.importKind === "type") continue;
    for (const specifier of statement.specifiers) {
      if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type") continue;
      if (!isNodeOfType(specifier, "ImportSpecifier") || getImportedName(specifier) === "default") {
        typeOnlyNamespaceBindings.set(specifier.local.name, specifier.local);
      }
    }
  }

  let hazardous = false;
  walkAst(program, (node) => {
    if (hazardous) return false;
    if (isNodeOfType(node, "ImportDeclaration")) {
      if (node.importKind === "type") return;
      if (node.source.value !== "react") {
        // An executable companion can replace a CommonJS React export before
        // the named import is used. The local proof has no companion summary.
        hazardous =
          node.specifiers.length === 0 ||
          node.specifiers.some(
            (specifier) =>
              !isNodeOfType(specifier, "ImportSpecifier") || specifier.importKind !== "type",
          );
        return;
      }
      hazardous = node.specifiers.some(
        (specifier) =>
          isNodeOfType(specifier, "ImportSpecifier") &&
          specifier.importKind !== "type" &&
          getImportedName(specifier)?.startsWith("__"),
      );
      return;
    }
    if (
      (isNodeOfType(node, "ExportNamedDeclaration") ||
        isNodeOfType(node, "ExportAllDeclaration")) &&
      node.source &&
      node.exportKind !== "type"
    ) {
      hazardous = true;
      return false;
    }
    if (
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "TSImportEqualsDeclaration") ||
      isNodeOfType(node, "TSExportAssignment") ||
      isNodeOfType(node, "TSModuleDeclaration") ||
      isNodeOfType(node, "TSEnumDeclaration")
    ) {
      hazardous = true;
      return false;
    }
    if (isNodeOfType(node, "Identifier") || isNodeOfType(node, "JSXIdentifier")) {
      const namespaceBinding = typeOnlyNamespaceBindings.get(node.name);
      if (namespaceBinding && node !== namespaceBinding && !isTypeScriptTypePosition(node)) {
        hazardous = true;
        return false;
      }
    }
    if (isNodeOfType(node, "Identifier") && scopes.referenceFor(node)) {
      hazardous =
        node.name === "require" ||
        node.name === "module" ||
        node.name === "eval" ||
        (scopes.isGlobalReference(node) &&
          ["globalThis", "global", "self", "window", "process"].includes(node.name));
    }
    if (isNodeOfType(node, "MemberExpression")) {
      const name = getStaticPropertyName(node);
      hazardous = name === "require" || name === "createRequire" || name === "getBuiltinModule";
    }
  });
  hasReactProviderHazardByScope.set(scopes, hazardous);
  return hazardous;
};

const getPrivateHookBody = (
  symbol: SymbolDescriptor,
  callee: EsTreeNode,
  scopes: ScopeAnalysis,
) => {
  const initializer = getDirectConstInitializer(symbol);
  if (
    !initializer ||
    symbol.scope !== scopes.rootScope ||
    symbol.declarationNode.parent?.parent !== scopes.rootScope.node ||
    !isReactHookName(symbol.name) ||
    symbol.references.length !== 1 ||
    symbol.references[0].identifier !== callee ||
    !isSymbolReadOnly(symbol) ||
    !hasCompleteSymbolReferences(symbol, scopes.rootScope.node, scopes)
  ) {
    return null;
  }
  const hook = stripParenExpression(initializer);
  if (
    !isNodeOfType(hook, "ArrowFunctionExpression") ||
    hook.async ||
    !hook.params.every((parameter) => isNodeOfType(parameter, "Identifier")) ||
    !isNodeOfType(hook.body, "BlockStatement")
  ) {
    return null;
  }
  return { hook, body: hook.body };
};

export const isLocalReturnedRefCurrentWrite = (
  reference: ReferenceDescriptor,
  callback: EsTreeNode,
  renderOwner: EsTreeNode | null,
  scopes: ScopeAnalysis,
  filename?: string,
): boolean => {
  const captured = reference.resolvedSymbol;
  if (
    !captured ||
    captured.references.some(
      (other) => other !== reference && isAstDescendant(other.identifier, callback),
    )
  )
    return false;
  const member = reference.identifier.parent;
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.object !== reference.identifier ||
    member.computed ||
    member.optional ||
    getStaticPropertyName(member) !== "current"
  ) {
    return false;
  }
  const assignment = member.parent;
  if (
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.left !== member ||
    assignment.operator !== "=" ||
    !isNodeOfType(assignment.right, "Identifier") ||
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== 1 ||
    !isNodeOfType(callback.params[0], "Identifier") ||
    scopes.symbolFor(assignment.right)?.bindingIdentifier !== callback.params[0] ||
    findEnclosingFunction(assignment) !== callback
  ) {
    return false;
  }

  const callbackCall = callback.parent;
  if (
    !isNodeOfType(callbackCall, "CallExpression") ||
    callbackCall.arguments.length !== 2 ||
    callbackCall.arguments[0] !== callback ||
    !isNodeOfType(callbackCall.arguments[1], "ArrayExpression") ||
    !isDirectNamedReactCall(callbackCall, "useCallback", scopes) ||
    !isFunctionLike(renderOwner) ||
    findEnclosingFunction(callback) !== renderOwner ||
    renderOwner.async ||
    ("generator" in renderOwner && renderOwner.generator) ||
    !hasOnlySimpleRenderParameters(renderOwner.params)
  ) {
    return false;
  }

  // Both calls occupy their first body slot. An earlier operation could
  // introduce a conditional Hook call or replace the supposed provider.
  const holder = getFirstDirectConst(renderOwner.body, scopes);
  const hookCall = holder?.initializer;
  if (
    !holder ||
    holder.symbol !== reference.resolvedSymbol ||
    !isNodeOfType(hookCall, "CallExpression") ||
    hookCall.optional ||
    !isNodeOfType(hookCall.callee, "Identifier")
  ) {
    return false;
  }
  const renderScope = scopes.ownScopeFor(renderOwner);
  if (
    !renderScope ||
    !hookCall.arguments.every((argument) => {
      if (!isNodeOfType(argument, "Identifier")) return false;
      const symbol = scopes.symbolFor(argument);
      return symbol?.kind === "parameter" && symbol.scope === renderScope;
    })
  ) {
    return false;
  }

  const hookSymbol = scopes.symbolFor(hookCall.callee);
  const helper = hookSymbol && getPrivateHookBody(hookSymbol, hookCall.callee, scopes);
  if (!helper) return false;
  const ref = getFirstDirectConst(helper.body, scopes);
  const refCall = ref?.initializer;
  if (
    !ref ||
    !isNodeOfType(refCall, "CallExpression") ||
    refCall.arguments.length !== 1 ||
    !isNodeOfType(refCall.arguments[0], "Literal") ||
    refCall.arguments[0].value !== null ||
    !isDirectNamedReactCall(refCall, "useRef", scopes)
  ) {
    return false;
  }
  const returns = collectFunctionReturnStatements(helper.hook);
  const terminalReturn = helper.body.body.at(-1);
  return Boolean(
    returns.length === 1 &&
    isNodeOfType(terminalReturn, "ReturnStatement") &&
    returns[0] === terminalReturn &&
    isNodeOfType(terminalReturn.argument, "Identifier") &&
    scopes.symbolFor(terminalReturn.argument) === ref.symbol &&
    filename &&
    !hasReactProviderHazard(scopes) &&
    hasOrdinaryReactResolution(filename),
  );
};
