import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { TRANSPARENT_EXPRESSION_WRAPPER_TYPES } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { isClosedReactCommandHookCall } from "./is-closed-react-command-hook-call.js";

interface HasClosedHandlerStateSettersOptions {
  handler: EsTreeNode;
  owner: EsTreeNode;
  context: RuleContext;
  stateHookNames: ReadonlySet<string>;
  matchesStateSetterCall: (node: EsTreeNode) => boolean;
  fulfillmentSetterForAwait: (node: EsTreeNode) => EsTreeNode | null;
}

const supportedPrograms = new WeakMap<ScopeAnalysis, boolean>();

const hasSupportedProgram = (scopes: ScopeAnalysis): boolean => {
  const cached = supportedPrograms.get(scopes);
  if (cached !== undefined) return cached;
  let supported = true;
  walkAst(scopes.rootScope.node, (node) => {
    const parent = node.parent;
    if (
      parent &&
      TRANSPARENT_EXPRESSION_WRAPPER_TYPES.has(parent.type) &&
      "expression" in parent &&
      parent.expression !== node
    )
      return false;
    if (
      (node.type.startsWith("TS") && !TRANSPARENT_EXPRESSION_WRAPPER_TYPES.has(node.type)) ||
      ((isNodeOfType(node, "ImportDeclaration") || isNodeOfType(node, "ImportSpecifier")) &&
        node.importKind === "type")
    )
      supported = false;
    return supported;
  });
  supportedPrograms.set(scopes, supported);
  return supported;
};

export const hasClosedHandlerStateSetters = (
  options: HasClosedHandlerStateSettersOptions,
): boolean => {
  const { handler, owner, context } = options;
  if (!hasSupportedProgram(context.scopes)) return false;
  let closed = true;
  let foundSetter = false;
  walkAst(handler, (node) => {
    if (node !== handler && isFunctionLike(node)) return false;
    const setter = isNodeOfType(node, "AwaitExpression")
      ? options.fulfillmentSetterForAwait(node)
      : node;
    if (!setter || !options.matchesStateSetterCall(setter)) return;
    foundSetter = true;
    if (!isNodeOfType(setter, "CallExpression") || !isNodeOfType(setter.callee, "Identifier")) {
      closed = false;
      return;
    }
    const symbol = context.scopes.symbolFor(setter.callee);
    const declaration = symbol?.declarationNode;
    if (
      !symbol ||
      symbol.kind !== "const" ||
      !symbol.references.every(
        (reference) => reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier),
      ) ||
      !isNodeOfType(declaration, "VariableDeclarator") ||
      !declaration.init ||
      !isNodeOfType(declaration.id, "ArrayPattern") ||
      findEnclosingFunction(declaration) !== owner ||
      !isNodeOfType(declaration.parent, "VariableDeclaration") ||
      declaration.parent.kind !== "const" ||
      !isNodeOfType(declaration.parent.parent, "BlockStatement") ||
      !isFunctionLike(owner) ||
      declaration.parent.parent !== owner.body
    ) {
      closed = false;
      return;
    }
    const initializer = declaration.init;
    const [stateBinding, setterBinding, ...additionalBindings] = declaration.id.elements;
    if (
      (stateBinding && !isNodeOfType(stateBinding, "Identifier")) ||
      setterBinding !== symbol.bindingIdentifier ||
      additionalBindings.length ||
      !Array.from(options.stateHookNames).some((hookName) =>
        isClosedReactCommandHookCall(initializer, hookName, context.scopes),
      )
    )
      closed = false;
  });
  return closed && foundSetter;
};
