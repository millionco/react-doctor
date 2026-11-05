import { BUILTIN_HOOK_NAMES } from "../../../constants/react.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getSingleReturnExpression } from "../../../utils/get-single-return-expression.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

interface ModuleFacts {
  readonly statementAfter: ReadonlyMap<EsTreeNode, EsTreeNode>;
  readonly callableReactImports: ReadonlySet<SymbolDescriptor>;
}

const moduleFactsByScopes = new WeakMap<ScopeAnalysis, ModuleFacts | null>();
const moduleLoaderSources = new Set(["module", "node:module"]);

const getModuleFacts = (scopes: ScopeAnalysis): ModuleFacts | null => {
  const cached = moduleFactsByScopes.get(scopes);
  if (cached !== undefined) return cached;
  const program = scopes.rootScope.node;
  if (!isNodeOfType(program, "Program")) return null;
  let canAccessBindingsDynamically = false;
  walkAst(program, (node) => {
    if (canAccessBindingsDynamically) return false;
    if (
      (isNodeOfType(node, "Identifier") &&
        (node.name === "eval" || node.name === "require" || node.name === "module") &&
        scopes.isGlobalReference(node)) ||
      (isNodeOfType(node, "ImportExpression") &&
        (!isNodeOfType(node.source, "Literal") ||
          typeof node.source.value !== "string" ||
          node.source.value === "react" ||
          moduleLoaderSources.has(node.source.value)))
    ) {
      canAccessBindingsDynamically = true;
    }
  });
  const statementAfter = new Map<EsTreeNode, EsTreeNode>();
  const callableReactImports = new Set<SymbolDescriptor>();
  let hasOpenReactNamespace = false;
  for (const [index, statement] of program.body.entries()) {
    const nextStatement = program.body[index + 1];
    if (nextStatement) statementAfter.set(statement, nextStatement);
    if (!isNodeOfType(statement, "ImportDeclaration") || statement.importKind === "type") {
      continue;
    }
    if (moduleLoaderSources.has(statement.source.value)) canAccessBindingsDynamically = true;
    if (statement.source.value !== "react") continue;
    for (const specifier of statement.specifiers) {
      if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type") continue;
      const importedName = getImportedName(specifier);
      const isNamespace = !isNodeOfType(specifier, "ImportSpecifier") || importedName === "default";
      if (!isNamespace && importedName !== "forwardRef") continue;
      const symbol = scopes.symbolFor(specifier.local);
      const hasOnlyDirectCalls = symbol?.references.every((reference) => {
        if (reference.flag !== "read") return false;
        let callee = findTransparentExpressionRoot(reference.identifier);
        if (isNamespace) {
          const member = callee.parent;
          if (
            !isNodeOfType(member, "MemberExpression") ||
            member.object !== callee ||
            member.computed ||
            member.optional
          ) {
            return false;
          }
          const method = getStaticPropertyName(member);
          if (!method || (method !== "forwardRef" && !BUILTIN_HOOK_NAMES.has(method))) {
            return false;
          }
          callee = findTransparentExpressionRoot(member);
        }
        const call = callee.parent;
        return isNodeOfType(call, "CallExpression") && call.callee === callee && !call.optional;
      });
      if (symbol && hasOnlyDirectCalls) callableReactImports.add(symbol);
      else if (isNamespace) hasOpenReactNamespace = true;
    }
  }
  const facts =
    canAccessBindingsDynamically || hasOpenReactNamespace
      ? null
      : { statementAfter, callableReactImports };
  moduleFactsByScopes.set(scopes, facts);
  return facts;
};

const getModuleConst = (declaration: EsTreeNode | null | undefined) => {
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "Identifier")
  )
    return null;
  const statement = declaration.parent;
  return isNodeOfType(statement, "VariableDeclaration") &&
    statement.kind === "const" &&
    statement.declarations.length === 1 &&
    isNodeOfType(statement.parent, "Program")
    ? { declaration, statement, identifier: declaration.id }
    : null;
};

const hasImmediatelyNamedResult = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
  facts: ModuleFacts,
): boolean => {
  const callee = findTransparentExpressionRoot(identifier);
  const call = callee.parent;
  if (!isNodeOfType(call, "CallExpression") || call.optional || call.callee !== callee)
    return false;
  const initializer = findTransparentExpressionRoot(call);
  const result = getModuleConst(initializer.parent);
  if (!result || result.declaration.init !== initializer) return false;
  const nextStatement = facts.statementAfter.get(result.statement);
  if (!isNodeOfType(nextStatement, "ExpressionStatement")) return false;
  const assignment = stripParenExpression(nextStatement.expression);
  if (
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.operator !== "=" ||
    !isNodeOfType(assignment.left, "MemberExpression") ||
    assignment.left.computed ||
    getStaticPropertyName(assignment.left) !== "displayName"
  ) {
    return false;
  }
  const receiver = stripParenExpression(assignment.left.object);
  const name = stripParenExpression(assignment.right);
  const resultSymbol = scopes.symbolFor(result.identifier);
  if (
    !resultSymbol ||
    scopes.symbolFor(receiver) !== resultSymbol ||
    !isNodeOfType(name, "Literal") ||
    typeof name.value !== "string" ||
    name.value.trim().length === 0
  ) {
    return false;
  }
  return resultSymbol.references.every(({ flag, identifier: reference }) => {
    const use = reference.parent;
    return (
      flag === "read" &&
      (reference === receiver || (isNodeOfType(use, "ExportSpecifier") && use.local === reference))
    );
  });
};

export const hasNamedForwardRefFactoryResults = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const factory = findEnclosingFunction(call);
  if (
    !isNodeOfType(factory, "ArrowFunctionExpression") ||
    factory.async ||
    getSingleReturnExpression(factory) !== findTransparentExpressionRoot(call) ||
    call.optional ||
    call.arguments.length !== 1
  ) {
    return false;
  }
  const factoryInitializer = findTransparentExpressionRoot(factory);
  const factoryBinding = getModuleConst(factoryInitializer.parent);
  if (!factoryBinding || factoryBinding.declaration.init !== factoryInitializer) return false;
  const factorySymbol = scopes.symbolFor(factoryBinding.identifier);
  if (!factorySymbol?.references.length || !isReactApiCall(call, "forwardRef", scopes))
    return false;
  const callee = stripParenExpression(call.callee);
  const provider = isNodeOfType(callee, "MemberExpression") ? callee.object : callee;
  const providerSymbol = scopes.symbolFor(stripParenExpression(provider));
  const facts = getModuleFacts(scopes);
  return Boolean(
    facts &&
    providerSymbol &&
    facts.callableReactImports.has(providerSymbol) &&
    factorySymbol.references.every(
      ({ flag, identifier }) =>
        flag === "read" && hasImmediatelyNamedResult(identifier, scopes, facts),
    ),
  );
};
