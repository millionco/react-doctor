import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import { FUNCTION_RESOLUTION_MAX_DEPTH } from "../../../constants/thresholds.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { isSymbolReadOnly } from "../../../utils/is-symbol-read-only.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

const resultsByScopes = new WeakMap<ScopeAnalysis, WeakMap<EsTreeNode, boolean>>();
const dynamicBindingsByScopes = new WeakMap<ScopeAnalysis, boolean>();

const hasDynamicBindings = (scopes: ScopeAnalysis): boolean => {
  const cached = dynamicBindingsByScopes.get(scopes);
  if (cached !== undefined) return cached;
  let dynamicBindings = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (dynamicBindings) return false;
    if (isNodeOfType(node, "WithStatement")) dynamicBindings = true;
    if (isNodeOfType(node, "CallExpression")) {
      const callee = stripParenExpression(node.callee);
      if (isNodeOfType(callee, "Identifier") && callee.name === "eval") dynamicBindings = true;
    }
  });
  dynamicBindingsByScopes.set(scopes, dynamicBindings);
  return dynamicBindings;
};

const isClosedNumericExpression = (
  expression: EsTreeNode,
  state: SymbolDescriptor | null,
  scopes: ScopeAnalysis,
  visited: ReadonlySet<SymbolDescriptor> = new Set(),
  remainingDepth = FUNCTION_RESOLUTION_MAX_DEPTH,
): boolean => {
  if (remainingDepth <= 0) return false;
  const value = stripParenExpression(expression);
  if (isNodeOfType(value, "Literal")) {
    return typeof value.value === "number" && Number.isFinite(value.value);
  }
  if (isNodeOfType(value, "Identifier")) {
    const binding = scopes.symbolFor(value);
    if (!binding) return false;
    if (binding === state) return true;
    const declaration = binding.declarationNode;
    return Boolean(
      binding.kind === "const" &&
      isNodeOfType(declaration, "VariableDeclarator") &&
      isNodeOfType(declaration.id, "Identifier") &&
      declaration.id === binding.bindingIdentifier &&
      declaration.init === binding.initializer &&
      binding.initializer &&
      !visited.has(binding) &&
      isSymbolReadOnly(binding) &&
      hasCompleteSymbolReferences(binding, scopes.rootScope.node, scopes) &&
      isClosedNumericExpression(
        binding.initializer,
        state,
        scopes,
        new Set(visited).add(binding),
        remainingDepth - 1,
      ),
    );
  }
  if (isNodeOfType(value, "UnaryExpression") && value.operator === "-") {
    return isClosedNumericExpression(value.argument, state, scopes, visited, remainingDepth - 1);
  }
  if (!state) return false;
  if (
    isNodeOfType(value, "BinaryExpression") &&
    (value.operator === "+" || value.operator === "-")
  ) {
    return (
      isClosedNumericExpression(value.left, state, scopes, visited, remainingDepth - 1) &&
      isClosedNumericExpression(value.right, state, scopes, visited, remainingDepth - 1)
    );
  }
  return (
    isNodeOfType(value, "ConditionalExpression") &&
    isClosedNumericExpression(value.consequent, state, scopes, visited, remainingDepth - 1) &&
    isClosedNumericExpression(value.alternate, state, scopes, visited, remainingDepth - 1)
  );
};

export const hasClosedNumericStateWrites = (
  declarator: EsTreeNode,
  context: RuleContext,
): boolean => {
  let results = resultsByScopes.get(context.scopes);
  if (!results) {
    results = new WeakMap();
    resultsByScopes.set(context.scopes, results);
  }
  const cached = results.get(declarator);
  if (cached !== undefined) return cached;
  results.set(declarator, false);
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    !isNodeOfType(declarator.parent, "VariableDeclaration") ||
    declarator.parent.kind !== "const" ||
    !isNodeOfType(declarator.id, "ArrayPattern") ||
    declarator.id.elements.length !== 2 ||
    !isNodeOfType(declarator.init, "CallExpression") ||
    declarator.init.optional ||
    !isReactApiCall(declarator.init, "useState", context.scopes) ||
    declarator.init.arguments.length !== 1
  )
    return false;
  const [stateIdentifier, setterIdentifier] = declarator.id.elements;
  if (!isNodeOfType(stateIdentifier, "Identifier") || !isNodeOfType(setterIdentifier, "Identifier"))
    return false;
  const state = context.scopes.symbolFor(stateIdentifier);
  const setter = context.scopes.symbolFor(setterIdentifier);
  if (
    !state ||
    !setter ||
    state.kind !== "const" ||
    setter.kind !== "const" ||
    !isSymbolReadOnly(state) ||
    !isSymbolReadOnly(setter) ||
    !hasCompleteSymbolReferences(state, context.scopes.rootScope.node, context.scopes) ||
    !hasCompleteSymbolReferences(setter, context.scopes.rootScope.node, context.scopes) ||
    !isClosedNumericExpression(declarator.init.arguments[0], null, context.scopes)
  )
    return false;
  if (hasDynamicBindings(context.scopes) || setter.references.length === 0) return false;
  const proven = setter.references.every(({ identifier, flag }) => {
    const call = identifier.parent;
    return (
      flag === "read" &&
      isNodeOfType(call, "CallExpression") &&
      call.callee === identifier &&
      !call.optional &&
      call.arguments.length === 1 &&
      isClosedNumericExpression(call.arguments[0], state, context.scopes)
    );
  });
  results.set(declarator, proven);
  return proven;
};
