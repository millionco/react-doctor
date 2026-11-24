import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const HOST_NAMES_REQUIRING_PROOF = new Set([
  "document",
  "window",
  "globalThis",
  "self",
  "global",
  "EventTarget",
  "Document",
  "HTMLDocument",
  "Window",
  "eval",
  "Function",
]);

const isClosedInitializer = (
  node: EsTreeNode | null | undefined,
  scopes: ScopeAnalysis,
): boolean => {
  if (!node) return false;
  const value = stripParenExpression(node);
  return (
    isFunctionLike(value) ||
    isNodeOfType(value, "Literal") ||
    (isNodeOfType(value, "ArrayExpression") &&
      value.elements.every((element) => {
        if (isNodeOfType(element, "Literal")) return true;
        if (!isNodeOfType(element, "Identifier")) return false;
        const symbol = scopes.symbolFor(element);
        const initializer = symbol && getDirectConstInitializer(symbol);
        return isNodeOfType(initializer, "Literal");
      }))
  );
};

const isOwnHotkeysPropertySetup = (
  statement: EsTreeNode,
  scopes: ScopeAnalysis,
  localRelay: EsTreeNode | undefined,
): boolean => {
  if (
    !isNodeOfType(statement, "ExpressionStatement") ||
    !isNodeOfType(statement.expression, "AssignmentExpression") ||
    statement.expression.operator !== "="
  ) {
    return false;
  }
  const { left, right } = statement.expression;
  if (
    !isNodeOfType(left, "MemberExpression") ||
    left.computed ||
    left.optional ||
    !localRelay ||
    !isNodeOfType(left.object, "Identifier")
  ) {
    return false;
  }
  const binding = scopes.symbolFor(localRelay);
  if (binding?.kind !== "const" || scopes.symbolFor(left.object) !== binding) return false;
  const name = getStaticPropertyName(left);
  return (
    (name === "shift" && isNodeOfType(right, "Literal") && right.value === false) ||
    (name === "unbind" && isFunctionLike(right))
  );
};

export const hasClosedKeyboardModuleInitialization = (
  root: EsTreeNode,
  scopes: ScopeAnalysis,
  localRelay?: EsTreeNode,
): boolean => {
  if (!isNodeOfType(root, "Program")) return false;
  for (const statement of root.body) {
    const declaration = isNodeOfType(statement, "ExportNamedDeclaration")
      ? statement.declaration
      : statement;
    if (!declaration) continue;
    if (
      isNodeOfType(declaration, "ImportDeclaration") ||
      isNodeOfType(declaration, "TSInterfaceDeclaration") ||
      isNodeOfType(declaration, "TSTypeAliasDeclaration") ||
      isNodeOfType(declaration, "FunctionDeclaration")
    ) {
      continue;
    }
    if (
      isNodeOfType(declaration, "VariableDeclaration") &&
      declaration.kind === "const" &&
      declaration.declarations.every(
        ({ id, init }) => isNodeOfType(id, "Identifier") && isClosedInitializer(init, scopes),
      )
    ) {
      continue;
    }
    if (!isOwnHotkeysPropertySetup(declaration, scopes, localRelay)) return false;
  }

  let closed = true;
  walkAst(root, (node) => {
    if (!closed) return false;
    if (
      !isNodeOfType(node, "Identifier") ||
      !HOST_NAMES_REQUIRING_PROOF.has(node.name) ||
      !scopes.isGlobalReference(node)
    ) {
      return;
    }
    const member = node.parent;
    const call = member?.parent;
    closed =
      node.name === "document" &&
      isNodeOfType(member, "MemberExpression") &&
      member.object === node &&
      !member.computed &&
      !member.optional &&
      getStaticPropertyName(member) === "getElementById" &&
      isNodeOfType(call, "CallExpression") &&
      call.callee === member &&
      !call.optional;
    if (!closed) return false;
  });
  return closed;
};
