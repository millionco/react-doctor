import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findJsxAttribute } from "./find-jsx-attribute.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getDirectFunctionBindingIdentifier } from "./get-direct-function-binding-identifier.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getImportedName } from "./get-imported-name.js";
import { hasJsxSpreadAttribute } from "./has-jsx-spread-attribute.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isSymbolReadOnly } from "./is-symbol-read-only.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const climbTransparentJsxValue = (node: EsTreeNode): EsTreeNode => {
  let value = findTransparentExpressionRoot(node);
  while (value.parent) {
    const parent = value.parent;
    if (
      (isNodeOfType(parent, "JSXFragment") && parent.children.some((child) => child === value)) ||
      (isNodeOfType(parent, "JSXExpressionContainer") && parent.expression === value) ||
      (isNodeOfType(parent, "ConditionalExpression") &&
        (parent.consequent === value || parent.alternate === value)) ||
      (isNodeOfType(parent, "LogicalExpression") &&
        parent.operator === "&&" &&
        parent.right === value)
    ) {
      value = findTransparentExpressionRoot(parent);
      continue;
    }
    break;
  }
  return value;
};

const isCanvasChild = (element: EsTreeNodeOfType<"JSXElement">, scopes: ScopeAnalysis): boolean => {
  const childValue = climbTransparentJsxValue(element);
  const canvas = childValue.parent;
  if (
    !isNodeOfType(canvas, "JSXElement") ||
    !canvas.children.some((child) => child === childValue) ||
    !isNodeOfType(canvas.openingElement.name, "JSXIdentifier") ||
    hasJsxSpreadAttribute(canvas.openingElement.attributes) ||
    findJsxAttribute(canvas.openingElement.attributes, "children")
  ) {
    return false;
  }
  const binding = scopes.symbolFor(canvas.openingElement.name);
  const declaration = binding ? getImportDeclarationForSymbol(binding) : null;
  return Boolean(
    binding &&
    isSymbolReadOnly(binding) &&
    declaration?.source.value === "@react-three/fiber" &&
    declaration.importKind !== "type" &&
    isNodeOfType(binding.declarationNode, "ImportSpecifier") &&
    binding.declarationNode.importKind !== "type" &&
    getImportedName(binding.declarationNode) === "Canvas",
  );
};

const hasDynamicScopeByAnalysis = new WeakMap<ScopeAnalysis, boolean>();

const hasDynamicScope = (scopes: ScopeAnalysis): boolean => {
  const cached = hasDynamicScopeByAnalysis.get(scopes);
  if (cached !== undefined) return cached;
  let hasDynamicAccess = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (hasDynamicAccess) return false;
    if (isNodeOfType(node, "WithStatement")) {
      hasDynamicAccess = true;
    } else if (isNodeOfType(node, "CallExpression")) {
      const callee = stripParenExpression(node.callee);
      hasDynamicAccess = isNodeOfType(callee, "Identifier") && callee.name === "eval";
    }
  });
  hasDynamicScopeByAnalysis.set(scopes, hasDynamicAccess);
  return hasDynamicAccess;
};

export const isReactThreeFiberCanvasOwnedLine = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  scopes: ScopeAnalysis,
): boolean => {
  const element = openingElement.parent;
  if (!isNodeOfType(element, "JSXElement")) return false;
  if (isCanvasChild(element, scopes)) return true;

  const component = findEnclosingFunction(element);
  if (!isNodeOfType(component, "ArrowFunctionExpression") || component.async) return false;

  const returnedValue = climbTransparentJsxValue(element);
  const returnStatement = returnedValue.parent;
  if (
    component.body !== returnedValue &&
    (!isNodeOfType(returnStatement, "ReturnStatement") ||
      returnStatement.argument !== returnedValue ||
      returnStatement.parent !== component.body)
  ) {
    return false;
  }

  const identifier = getDirectFunctionBindingIdentifier(component);
  const binding = identifier ? scopes.symbolFor(identifier) : null;
  const componentValue = findTransparentExpressionRoot(component);
  const declarator = componentValue.parent;
  const declaration = declarator?.parent;
  const isPrivateModuleDeclaration =
    isNodeOfType(declarator, "VariableDeclarator") &&
    declarator.init === componentValue &&
    isNodeOfType(declaration, "VariableDeclaration") &&
    declaration.kind === "const" &&
    isNodeOfType(declaration.parent, "Program");
  if (
    !isPrivateModuleDeclaration ||
    !binding ||
    binding.references.length === 0 ||
    !isSymbolReadOnly(binding) ||
    hasDynamicScope(scopes)
  ) {
    return false;
  }

  return binding.references.every(({ identifier: reference }) => {
    const opening = reference.parent;
    return (
      isNodeOfType(reference, "JSXIdentifier") &&
      isNodeOfType(opening, "JSXOpeningElement") &&
      opening.name === reference &&
      opening.selfClosing &&
      isNodeOfType(opening.parent, "JSXElement") &&
      isCanvasChild(opening.parent, scopes)
    );
  });
};
