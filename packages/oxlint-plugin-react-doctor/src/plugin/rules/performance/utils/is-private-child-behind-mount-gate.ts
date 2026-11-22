import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getFunctionBindingSymbols } from "../../../utils/get-function-binding-symbols.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isComponentFunction } from "../../../utils/is-component-function.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";
import { someAst } from "../../../utils/some-ast.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

const dynamicScopeByAnalysis = new WeakMap<ScopeAnalysis, boolean>();

const hasDynamicScope = (scopes: ScopeAnalysis): boolean => {
  const cached = dynamicScopeByAnalysis.get(scopes);
  if (cached !== undefined) return cached;
  const observed = someAst(
    scopes.rootScope.node,
    (node) =>
      isNodeOfType(node, "WithStatement") ||
      (isNodeOfType(node, "Identifier") && node.name === "eval"),
  );
  dynamicScopeByAnalysis.set(scopes, observed);
  return observed;
};

const isNamedRuntimeCall = (
  node: unknown,
  moduleName: string,
  importedName: string,
  scopes: ScopeAnalysis,
): node is EsTreeNodeOfType<"CallExpression"> => {
  if (!isNodeOfType(node, "CallExpression") || node.optional) return false;
  const callee = stripParenExpression(node.callee);
  if (!isNodeOfType(callee, "Identifier") || scopes.symbolFor(callee)?.kind !== "import")
    return false;
  const api = resolveImportedApiReference(callee, scopes);
  return api?.source === moduleName && api.importedName === importedName;
};

const readOnlyReference = (
  symbol: SymbolDescriptor | null | undefined,
  node: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean =>
  Boolean(
    symbol &&
    symbol.references.length === 1 &&
    symbol.references[0].flag === "read" &&
    symbol.references[0].identifier === node &&
    hasCompleteSymbolReferences(symbol, scopes.rootScope.node, scopes),
  );

const getDirectChildReturn = (
  jsx: EsTreeNodeOfType<"JSXElement">,
  scopes: ScopeAnalysis,
): EsTreeNodeOfType<"ReturnStatement"> | null => {
  let current: EsTreeNode = jsx;
  while (current.parent) {
    current = findTransparentExpressionRoot(current);
    const parent = current.parent;
    if (isNodeOfType(parent, "ReturnStatement") && parent.argument === current) return parent;
    if (
      ((isNodeOfType(parent, "JSXElement") || isNodeOfType(parent, "JSXFragment")) &&
        (isNodeOfType(current, "JSXElement") ||
          isNodeOfType(current, "JSXFragment") ||
          isNodeOfType(current, "JSXExpressionContainer"))) ||
      (isNodeOfType(parent, "JSXExpressionContainer") && parent.expression === current) ||
      (isNodeOfType(parent, "LogicalExpression") &&
        parent.operator === "&&" &&
        parent.right === current) ||
      (isNamedRuntimeCall(parent, "react-dom", "createPortal", scopes) &&
        parent.arguments[0] === current)
    ) {
      current = parent;
      continue;
    }
    return null;
  }
  return null;
};

const isMountGate = (
  ownerBody: EsTreeNodeOfType<"BlockStatement">,
  renderReturn: EsTreeNodeOfType<"ReturnStatement">,
  scopes: ScopeAnalysis,
): boolean => {
  const returnIndex = ownerBody.body.findIndex((statement) => statement === renderReturn);
  if (returnIndex < 3) return false;
  const [stateDeclaration, effect, guard] = ownerBody.body.slice(returnIndex - 3, returnIndex);
  if (
    !isNodeOfType(stateDeclaration, "VariableDeclaration") ||
    stateDeclaration.kind !== "const" ||
    stateDeclaration.declarations.length !== 1 ||
    !isNodeOfType(effect, "ExpressionStatement") ||
    !isNodeOfType(guard, "IfStatement") ||
    guard.alternate
  )
    return false;
  const [state] = stateDeclaration.declarations;
  if (
    !isNodeOfType(state.id, "ArrayPattern") ||
    state.id.elements.length !== 2 ||
    !isNamedRuntimeCall(state.init, "react", "useState", scopes) ||
    state.init.arguments.length !== 1 ||
    !isNodeOfType(state.init.arguments[0], "Literal") ||
    state.init.arguments[0].value !== false
  )
    return false;
  const [flag, setter] = state.id.elements;
  const test = stripParenExpression(guard.test);
  const consequent = guard.consequent;
  const exit =
    isNodeOfType(consequent, "BlockStatement") && consequent.body.length === 1
      ? consequent.body[0]
      : consequent;
  if (
    !isNodeOfType(flag, "Identifier") ||
    !isNodeOfType(setter, "Identifier") ||
    !isNodeOfType(test, "UnaryExpression") ||
    test.operator !== "!" ||
    !isNodeOfType(test.argument, "Identifier") ||
    !isNodeOfType(exit, "ReturnStatement") ||
    !isNodeOfType(exit.argument, "Literal") ||
    exit.argument.value !== null ||
    !readOnlyReference(scopes.symbolFor(flag), test.argument, scopes)
  )
    return false;

  const effectCall = stripParenExpression(effect.expression);
  if (
    !isNamedRuntimeCall(effectCall, "react", "useEffect", scopes) ||
    effectCall.arguments.length !== 2
  )
    return false;
  const [callback, deps] = effectCall.arguments;
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== 0 ||
    !isNodeOfType(deps, "ArrayExpression") ||
    deps.elements.length !== 0
  )
    return false;
  const body = callback.body;
  const single =
    isNodeOfType(body, "BlockStatement") && body.body.length === 1 ? body.body[0] : body;
  const write = stripParenExpression(
    isNodeOfType(single, "ExpressionStatement") ? single.expression : single,
  );
  return (
    isNodeOfType(write, "CallExpression") &&
    !write.optional &&
    isNodeOfType(write.callee, "Identifier") &&
    write.arguments.length === 1 &&
    isNodeOfType(write.arguments[0], "Literal") &&
    write.arguments[0].value === true &&
    readOnlyReference(scopes.symbolFor(setter), write.callee, scopes)
  );
};

const getModulePrivateBindingDeclaration = (
  component: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  if (isNodeOfType(component, "FunctionDeclaration")) {
    return !component.async && !component.generator && component.parent === scopes.rootScope.node
      ? component
      : null;
  }
  if (!isNodeOfType(component, "ArrowFunctionExpression") || component.async) return null;
  const value = findTransparentExpressionRoot(component);
  const declarator = value.parent;
  const declaration = declarator?.parent;
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.init !== value ||
    !isNodeOfType(declarator.id, "Identifier") ||
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    declaration.parent !== scopes.rootScope.node
  )
    return null;
  return declarator;
};

const isPostMountSetterCall = (
  setter: EsTreeNodeOfType<"CallExpression">,
  owner: EsTreeNode,
  ownerBody: EsTreeNodeOfType<"BlockStatement">,
  scopes: ScopeAnalysis,
): boolean => {
  const callback = findEnclosingFunction(setter);
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== 0
  )
    return false;
  const value = findTransparentExpressionRoot(callback);
  const effect = value.parent;
  if (!isNamedRuntimeCall(effect, "react", "useEffect", scopes) || effect.arguments[0] !== value)
    return false;
  const statement = findTransparentExpressionRoot(effect).parent;
  return (
    isNodeOfType(statement, "ExpressionStatement") &&
    statement.parent === ownerBody &&
    findEnclosingFunction(effect) === owner
  );
};

const isShortCircuitMountGate = (
  child: EsTreeNodeOfType<"JSXElement">,
  owner: EsTreeNode,
  ownerBody: EsTreeNodeOfType<"BlockStatement">,
  scopes: ScopeAnalysis,
): boolean => {
  const element = findTransparentExpressionRoot(child);
  const gate = element.parent;
  if (!isNodeOfType(gate, "LogicalExpression") || gate.operator !== "&&" || gate.right !== element)
    return false;
  const condition = stripParenExpression(gate.left);
  if (!isNodeOfType(condition, "Identifier")) return false;
  const flag = scopes.symbolFor(condition);
  if (!flag || !readOnlyReference(flag, condition, scopes)) return false;
  const declarator = flag.declarationNode;
  const declaration = declarator.parent;
  if (
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    declaration.parent !== ownerBody ||
    !isNodeOfType(declarator, "VariableDeclarator") ||
    !isNodeOfType(declarator.id, "ArrayPattern") ||
    declarator.id.elements.length !== 2 ||
    declarator.id.elements[0] !== flag.bindingIdentifier ||
    !isNamedRuntimeCall(declarator.init, "react", "useState", scopes) ||
    declarator.init.arguments.length !== 1 ||
    !isNodeOfType(declarator.init.arguments[0], "Literal") ||
    declarator.init.arguments[0].value !== false
  )
    return false;
  const setter = declarator.id.elements[1];
  if (!isNodeOfType(setter, "Identifier")) return false;
  const dispatch = scopes.symbolFor(setter);
  if (!dispatch || !hasCompleteSymbolReferences(dispatch, scopes.rootScope.node, scopes))
    return false;
  let hasPostMountTrueWrite = false;
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
    const value = stripParenExpression(call.arguments[0]);
    if (!isNodeOfType(value, "Literal") || typeof value.value !== "boolean") return false;
    if (value.value) {
      if (!isPostMountSetterCall(call, owner, ownerBody, scopes)) return false;
      hasPostMountTrueWrite = true;
    }
  }
  return hasPostMountTrueWrite;
};

export const isPrivateChildBehindMountGate = (
  component: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const declaration = getModulePrivateBindingDeclaration(component, scopes);
  if (!declaration) return false;
  const bindings = getFunctionBindingSymbols(component, scopes);
  if (bindings.length !== 1) return false;
  const [binding] = bindings;
  if (binding.declarationNode !== declaration || binding.references.length !== 1) return false;
  const use = binding.references[0].identifier;
  const opening = use.parent;
  if (
    !isNodeOfType(opening, "JSXOpeningElement") ||
    opening.name !== use ||
    !opening.selfClosing ||
    !isNodeOfType(opening.parent, "JSXElement")
  )
    return false;

  const jsx = opening.parent;
  const owner = findEnclosingFunction(jsx);
  const renderReturn = getDirectChildReturn(jsx, scopes);
  return Boolean(
    owner &&
    owner !== component &&
    isComponentFunction(owner) &&
    isFunctionLike(owner) &&
    isNodeOfType(owner.body, "BlockStatement") &&
    renderReturn &&
    renderReturn.parent === owner.body &&
    (isNodeOfType(component, "FunctionDeclaration")
      ? isMountGate(owner.body, renderReturn, scopes)
      : isShortCircuitMountGate(jsx, owner, owner.body, scopes)) &&
    readOnlyReference(binding, use, scopes) &&
    !hasDynamicScope(scopes),
  );
};
