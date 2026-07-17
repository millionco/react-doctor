import { getStaticPropertyName } from "./get-static-property-name.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { forEachChildNode, walkAst } from "./walk-ast.js";
import type { EsTreeNode } from "./es-tree-node.js";

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

const getConstLocalHelperName = (functionNode: EsTreeNode): string | null => {
  if (isNodeOfType(functionNode, "FunctionDeclaration")) {
    return functionNode.id && isNodeOfType(functionNode.id, "Identifier")
      ? functionNode.id.name
      : null;
  }
  const expressionRoot = findTransparentExpressionRoot(functionNode);
  const declarator = expressionRoot.parent;
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator")) return null;
  if (declarator.init !== expressionRoot || !isNodeOfType(declarator.id, "Identifier")) return null;
  const declaration = declarator.parent;
  if (!declaration || !isNodeOfType(declaration, "VariableDeclaration")) return null;
  return declaration.kind === "const" ? declarator.id.name : null;
};

export const walkSynchronousCallbackFlow = (
  functionBody: EsTreeNode,
  visit: (node: EsTreeNode) => void,
): void => {
  const activeBodies = new Set<EsTreeNode>();
  const walkBody = (body: EsTreeNode, helpersInScope: Map<string, EsTreeNode>): void => {
    if (activeBodies.has(body)) return;
    activeBodies.add(body);
    const helperBodies = new Map(helpersInScope);
    const helperAliases = new Map<string, string>();
    walkAst(body, (child: EsTreeNode) => {
      if (child !== body && isFunctionLike(child)) {
        const helperName = getConstLocalHelperName(child);
        if (helperName && child.body) helperBodies.set(helperName, child.body);
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
        helperAliases.set(child.id.name, aliasTarget.name);
      }
    });
    for (const [aliasName, targetName] of helperAliases) {
      let resolvedName = targetName;
      const visitedNames = new Set([aliasName]);
      while (helperAliases.has(resolvedName) && !visitedNames.has(resolvedName)) {
        visitedNames.add(resolvedName);
        resolvedName = helperAliases.get(resolvedName) ?? resolvedName;
      }
      const helperBody = helperBodies.get(resolvedName);
      if (helperBody) helperBodies.set(aliasName, helperBody);
    }
    const walkNode = (node: EsTreeNode, isRoot = false): void => {
      if (!isRoot && isFunctionLike(node)) return;
      visit(node);
      forEachChildNode(node, (child) => walkNode(child));
      if (!isNodeOfType(node, "CallExpression")) return;
      const callee = stripParenExpression(node.callee);
      if (isNodeOfType(callee, "Identifier")) {
        const helperBody = helperBodies.get(callee.name);
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
        const callback = stripParenExpression(argument);
        if (isFunctionLike(callback)) {
          if (callback.body) walkBody(callback.body, helperBodies);
        } else if (isNodeOfType(callback, "Identifier")) {
          const helperBody = helperBodies.get(callback.name);
          if (helperBody) walkBody(helperBody, helperBodies);
        }
      }
    };
    walkNode(body, true);
    activeBodies.delete(body);
  };
  walkBody(functionBody, new Map());
};
