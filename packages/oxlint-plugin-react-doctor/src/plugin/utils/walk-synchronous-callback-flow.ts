import { getStaticPropertyName } from "./get-static-property-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
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
  const declarator = functionNode.parent;
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator")) return null;
  if (declarator.init !== functionNode || !isNodeOfType(declarator.id, "Identifier")) return null;
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
      if (
        isNodeOfType(child, "VariableDeclarator") &&
        isNodeOfType(child.id, "Identifier") &&
        child.init &&
        isNodeOfType(child.init, "Identifier") &&
        child.parent &&
        isNodeOfType(child.parent, "VariableDeclaration") &&
        child.parent.kind === "const"
      ) {
        helperAliases.set(child.id.name, child.init.name);
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
      if (isNodeOfType(node.callee, "Identifier")) {
        const helperBody = helperBodies.get(node.callee.name);
        if (helperBody) walkBody(helperBody, helperBodies);
        return;
      }
      if (
        !isNodeOfType(node.callee, "MemberExpression") ||
        !SYNCHRONOUS_CALLBACK_METHOD_NAMES.has(getStaticPropertyName(node.callee) ?? "")
      ) {
        return;
      }
      for (const argument of node.arguments ?? []) {
        if (isFunctionLike(argument)) {
          if (argument.body) walkBody(argument.body, helperBodies);
        } else if (isNodeOfType(argument, "Identifier")) {
          const helperBody = helperBodies.get(argument.name);
          if (helperBody) walkBody(helperBody, helperBodies);
        }
      }
    };
    walkNode(body, true);
    activeBodies.delete(body);
  };
  walkBody(functionBody, new Map());
};
