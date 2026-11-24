import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getFunctionBindingSymbols } from "./get-function-binding-symbols.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isDirectNamedReactHookCall } from "./is-direct-named-react-hook-call.js";
import { isComponentFunction } from "./is-component-function.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const isNamedReactCall = (
  node: EsTreeNode | null | undefined,
  apiName: "useState" | "useEffect" | "useRef",
  scopes: ScopeAnalysis,
): node is EsTreeNodeOfType<"CallExpression"> => {
  return isNodeOfType(node, "CallExpression") && isDirectNamedReactHookCall(node, apiName, scopes);
};

const isInsideParentPassiveEffect = (
  call: EsTreeNodeOfType<"CallExpression">,
  parentBody: EsTreeNodeOfType<"BlockStatement">,
  scopes: ScopeAnalysis,
): boolean => {
  const callback = findEnclosingFunction(call);
  if (!isNodeOfType(callback, "ArrowFunctionExpression") || callback.async) return false;
  const argument = findTransparentExpressionRoot(callback);
  const effect = argument.parent;
  if (!isNamedReactCall(effect, "useEffect", scopes) || effect.arguments[0] !== argument)
    return false;
  const statement = findTransparentExpressionRoot(effect).parent;
  return isNodeOfType(statement, "ExpressionStatement") && statement.parent === parentBody;
};

// A conditional hook earlier in the function can shift state slots on a
// render-phase rerender. Accept only a straight-line prefix of named hooks.
const hasStableHookPrefix = (
  parentBody: EsTreeNodeOfType<"BlockStatement">,
  mountDeclaration: EsTreeNodeOfType<"VariableDeclaration">,
  scopes: ScopeAnalysis,
): boolean => {
  for (const statement of parentBody.body) {
    if (statement === mountDeclaration) return true;
    if (
      !isNodeOfType(statement, "VariableDeclaration") ||
      statement.kind !== "const" ||
      statement.declarations.length !== 1
    )
      return false;
    const [binding] = statement.declarations;
    const hook = binding.init;
    if (
      !isNodeOfType(hook, "CallExpression") ||
      hook.arguments.length !== 1 ||
      !isNodeOfType(hook.arguments[0], "Literal")
    )
      return false;
    if (isNodeOfType(binding.id, "Identifier") && isNamedReactCall(hook, "useRef", scopes))
      continue;
    if (
      isNodeOfType(binding.id, "ArrayPattern") &&
      binding.id.elements.length <= 2 &&
      binding.id.elements.every((entry) => isNodeOfType(entry, "Identifier")) &&
      isNamedReactCall(hook, "useState", scopes)
    )
      continue;
    return false;
  }
  return false;
};

const opensOnlyInParentPassiveEffects = (
  condition: EsTreeNode,
  parentBody: EsTreeNodeOfType<"BlockStatement">,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(condition, "Identifier")) return false;
  const state = scopes.symbolFor(condition);
  const declaration = state?.declarationNode;
  const statement = declaration?.parent;
  if (
    !state ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(statement, "VariableDeclaration") ||
    statement.kind !== "const" ||
    statement.declarations.length !== 1 ||
    statement.parent !== parentBody ||
    !isNodeOfType(declaration.id, "ArrayPattern") ||
    declaration.id.elements.length !== 2 ||
    !isNamedReactCall(declaration.init, "useState", scopes) ||
    declaration.init.arguments.length !== 1 ||
    !isNodeOfType(declaration.init.arguments[0], "Literal") ||
    declaration.init.arguments[0].value !== false
  )
    return false;

  const [value, setter] = declaration.id.elements;
  if (value !== state.bindingIdentifier || !isNodeOfType(setter, "Identifier")) return false;
  if (!hasStableHookPrefix(parentBody, statement, scopes)) return false;
  const dispatch = scopes.symbolFor(setter);
  if (!dispatch || !hasCompleteSymbolReferences(dispatch, scopes.rootScope.node, scopes))
    return false;

  let hasOpeningWrite = false;
  for (const reference of dispatch.references) {
    const callee = findTransparentExpressionRoot(reference.identifier);
    const call = callee.parent;
    if (
      reference.flag !== "read" ||
      !isNodeOfType(call, "CallExpression") ||
      call.optional ||
      call.callee !== callee ||
      call.arguments.length !== 1
    )
      return false;
    const update = stripParenExpression(call.arguments[0]);
    if (!isNodeOfType(update, "Literal") || typeof update.value !== "boolean") return false;
    if (!update.value) continue;
    if (!isInsideParentPassiveEffect(call, parentBody, scopes)) return false;
    hasOpeningWrite = true;
  }
  return hasOpeningWrite;
};

const hasNoPlainFunctionUses = (owner: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const [binding, competingBinding] = getFunctionBindingSymbols(owner, scopes);
  if (
    !binding ||
    competingBinding ||
    !hasCompleteSymbolReferences(binding, scopes.rootScope.node, scopes)
  )
    return false;
  return binding.references.every(({ flag, identifier }) => {
    const entry = identifier.parent;
    return (
      flag === "read" &&
      (((isNodeOfType(entry, "JSXOpeningElement") || isNodeOfType(entry, "JSXClosingElement")) &&
        entry.name === identifier) ||
        (isNodeOfType(entry, "ExportDefaultDeclaration") && entry.declaration === identifier) ||
        (isNodeOfType(entry, "ExportSpecifier") && entry.local === identifier))
    );
  });
};

const isDirectReturnedChild = (
  gate: EsTreeNodeOfType<"LogicalExpression">,
  parentBody: EsTreeNodeOfType<"BlockStatement">,
): boolean => {
  let value: EsTreeNode = findTransparentExpressionRoot(gate);
  while (value.parent) {
    const parent = value.parent;
    if (isNodeOfType(parent, "ReturnStatement"))
      return parent.argument === value && parent.parent === parentBody;
    if (
      (isNodeOfType(parent, "JSXExpressionContainer") && parent.expression === value) ||
      ((isNodeOfType(parent, "JSXElement") || isNodeOfType(parent, "JSXFragment")) &&
        (isNodeOfType(value, "JSXElement") ||
          isNodeOfType(value, "JSXFragment") ||
          isNodeOfType(value, "JSXExpressionContainer")))
    ) {
      value = findTransparentExpressionRoot(parent);
      continue;
    }
    return false;
  }
  return false;
};

// The child must have no other entry point. Only the owning parent's own passive
// effects may flip the flag that allows React to create its element.
export const isPrivateChildBehindPassiveMount = (
  child: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(child, "ArrowFunctionExpression") || child.async) return false;
  const initializer = findTransparentExpressionRoot(child);
  const declaration = initializer.parent;
  const statement = declaration?.parent;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.init !== initializer ||
    !isNodeOfType(declaration.id, "Identifier") ||
    !isNodeOfType(statement, "VariableDeclaration") ||
    statement.kind !== "const" ||
    statement.parent !== scopes.rootScope.node
  )
    return false;
  const [binding, competingBinding] = getFunctionBindingSymbols(child, scopes);
  if (
    !binding ||
    competingBinding ||
    binding.declarationNode !== declaration ||
    binding.references.length !== 1 ||
    binding.references[0].flag !== "read"
  )
    return false;

  const name = binding.references[0].identifier;
  const opening = name.parent;
  if (
    !isNodeOfType(opening, "JSXOpeningElement") ||
    opening.name !== name ||
    !opening.selfClosing ||
    !isNodeOfType(opening.parent, "JSXElement")
  )
    return false;
  const element = findTransparentExpressionRoot(opening.parent);
  const gate = element.parent;
  if (!isNodeOfType(gate, "LogicalExpression") || gate.operator !== "&&" || gate.right !== element)
    return false;
  const parent = findEnclosingFunction(gate);
  if (
    !parent ||
    parent === child ||
    !isFunctionLike(parent) ||
    !isComponentFunction(parent) ||
    !parent.params.every((parameter) => isNodeOfType(parameter, "Identifier")) ||
    !isNodeOfType(parent.body, "BlockStatement") ||
    !isDirectReturnedChild(gate, parent.body)
  )
    return false;
  return (
    opensOnlyInParentPassiveEffects(stripParenExpression(gate.left), parent.body, scopes) &&
    hasCompleteSymbolReferences(binding, scopes.rootScope.node, scopes) &&
    hasNoPlainFunctionUses(parent, scopes)
  );
};
