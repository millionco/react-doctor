import { getStaticPropertyName } from "./get-static-property-name.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { findVariableInitializer } from "./find-variable-initializer.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { forEachChildNode, walkAst } from "./walk-ast.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";

const SYNCHRONOUS_CALLBACK_METHOD_NAMES = new Set([
  "every",
  "filter",
  "find",
  "findIndex",
  "flatMap",
  "forEach",
  "map",
  "reduce",
  "reduceRight",
  "some",
  "sort",
]);

const getConstLocalHelperBindingIdentifier = (functionNode: EsTreeNode): EsTreeNode | null => {
  if (isNodeOfType(functionNode, "FunctionDeclaration")) {
    return functionNode.id && isNodeOfType(functionNode.id, "Identifier") ? functionNode.id : null;
  }
  const expressionRoot = findTransparentExpressionRoot(functionNode);
  const declarator = expressionRoot.parent;
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator")) return null;
  if (declarator.init !== expressionRoot || !isNodeOfType(declarator.id, "Identifier")) return null;
  const declaration = declarator.parent;
  if (!declaration || !isNodeOfType(declaration, "VariableDeclaration")) return null;
  return declaration.kind === "const" ? declarator.id : null;
};

export const walkSynchronousCallbackFlow = (
  functionBody: EsTreeNode,
  visit: (node: EsTreeNode) => void,
  isProvenSynchronousIteratorCall?: (
    callExpression: EsTreeNodeOfType<"CallExpression">,
    callbackArgument: EsTreeNode,
  ) => boolean,
  shouldTraverseFunction?: (functionNode: EsTreeNode) => boolean,
): void => {
  const activeBodies = new Set<EsTreeNode>();
  const walkBody = (body: EsTreeNode, helpersInScope: Map<EsTreeNode, EsTreeNode>): void => {
    if (activeBodies.has(body)) return;
    activeBodies.add(body);
    const helperBodies = new Map(helpersInScope);
    const helperAliases = new Map<EsTreeNode, EsTreeNode>();
    walkAst(body, (child: EsTreeNode) => {
      if (child !== body && isFunctionLike(child)) {
        const helperBindingIdentifier = getConstLocalHelperBindingIdentifier(child);
        if (
          helperBindingIdentifier &&
          child.body &&
          (!shouldTraverseFunction || shouldTraverseFunction(child))
        ) {
          helperBodies.set(helperBindingIdentifier, child.body);
        }
        return false;
      }
      const aliasTarget =
        isNodeOfType(child, "VariableDeclarator") && child.init
          ? stripParenExpression(child.init)
          : null;
      if (
        isNodeOfType(child, "VariableDeclarator") &&
        isNodeOfType(child.id, "Identifier") &&
        isNodeOfType(aliasTarget, "Identifier") &&
        child.parent &&
        isNodeOfType(child.parent, "VariableDeclaration") &&
        child.parent.kind === "const"
      ) {
        const targetBindingIdentifier = findVariableInitializer(
          aliasTarget,
          aliasTarget.name,
        )?.bindingIdentifier;
        if (targetBindingIdentifier) helperAliases.set(child.id, targetBindingIdentifier);
      }
    });
    for (const [aliasBindingIdentifier, targetBindingIdentifier] of helperAliases) {
      let resolvedBindingIdentifier = targetBindingIdentifier;
      const visitedBindingIdentifiers = new Set([aliasBindingIdentifier]);
      while (
        helperAliases.has(resolvedBindingIdentifier) &&
        !visitedBindingIdentifiers.has(resolvedBindingIdentifier)
      ) {
        visitedBindingIdentifiers.add(resolvedBindingIdentifier);
        resolvedBindingIdentifier =
          helperAliases.get(resolvedBindingIdentifier) ?? resolvedBindingIdentifier;
      }
      const helperBody = helperBodies.get(resolvedBindingIdentifier);
      if (helperBody) helperBodies.set(aliasBindingIdentifier, helperBody);
    }
    const walkNode = (node: EsTreeNode, isRoot = false): void => {
      if (!isRoot && isFunctionLike(node)) return;
      visit(node);
      forEachChildNode(node, (child) => walkNode(child));
      if (!isNodeOfType(node, "CallExpression")) return;
      const callee = stripParenExpression(node.callee);
      if (isFunctionLike(callee)) {
        if (callee.body && (!shouldTraverseFunction || shouldTraverseFunction(callee))) {
          walkBody(callee.body, helperBodies);
        }
        return;
      }
      if (isNodeOfType(callee, "Identifier")) {
        const calleeBindingIdentifier = findVariableInitializer(
          callee,
          callee.name,
        )?.bindingIdentifier;
        const helperBody = calleeBindingIdentifier
          ? helperBodies.get(calleeBindingIdentifier)
          : undefined;
        if (helperBody) walkBody(helperBody, helperBodies);
        return;
      }
      if (
        !isNodeOfType(callee, "MemberExpression") ||
        !SYNCHRONOUS_CALLBACK_METHOD_NAMES.has(getStaticPropertyName(callee) ?? "")
      ) {
        return;
      }
      for (const argument of node.arguments ?? []) {
        if (isProvenSynchronousIteratorCall && !isProvenSynchronousIteratorCall(node, argument)) {
          continue;
        }
        const callback = stripParenExpression(argument);
        if (isFunctionLike(callback)) {
          if (callback.body && (!shouldTraverseFunction || shouldTraverseFunction(callback))) {
            walkBody(callback.body, helperBodies);
          }
        } else if (isNodeOfType(callback, "Identifier")) {
          const callbackBindingIdentifier = findVariableInitializer(
            callback,
            callback.name,
          )?.bindingIdentifier;
          const helperBody = callbackBindingIdentifier
            ? helperBodies.get(callbackBindingIdentifier)
            : undefined;
          if (helperBody) walkBody(helperBody, helperBodies);
        }
      }
    };
    walkNode(body, true);
    activeBodies.delete(body);
  };
  walkBody(functionBody, new Map());
};
