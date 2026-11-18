import { getImportedName } from "./get-imported-name.js";
import { getValueImportSource } from "./get-value-import-declaration.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "./is-proven-unmodified-global-namespace-reference.js";
import { getSingleReturnExpression } from "./get-single-return-expression.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getStaticJsxTreeRoot } from "./get-static-jsx-tree-root.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isComponentAssignment } from "./is-component-assignment.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const isBinding = (
  node: EsTreeNode | null | undefined,
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => isNodeOfType(node, "Identifier") && scopes.symbolFor(node) === symbol;

const isOne = (node: EsTreeNode): boolean => isNodeOfType(node, "Literal") && node.value === 1;

const isNativeElement = (
  node: EsTreeNode | null | undefined,
  name: string,
): node is EsTreeNodeOfType<"JSXElement"> =>
  isNodeOfType(node, "JSXElement") &&
  isNodeOfType(node.openingElement.name, "JSXIdentifier") &&
  node.openingElement.name.name === name;

const meaningfulChildren = (children: readonly EsTreeNode[]): EsTreeNode[] =>
  children.filter((child) => !isNodeOfType(child, "JSXText") || child.value.trim() !== "");

const isOwnPropBinding = (
  symbol: SymbolDescriptor | null,
  owner: EsTreeNode,
): symbol is SymbolDescriptor => {
  if (symbol?.kind !== "parameter" || !isNodeOfType(owner, "FunctionExpression")) return false;
  const binding = symbol.bindingIdentifier;
  const defaultValue = binding.parent;
  const target =
    isNodeOfType(defaultValue, "AssignmentPattern") && defaultValue.left === binding
      ? defaultValue
      : binding;
  if (
    target === defaultValue &&
    isNodeOfType(defaultValue, "AssignmentPattern") &&
    (!isNodeOfType(defaultValue.right, "Literal") || typeof defaultValue.right.value !== "number")
  )
    return false;
  const property = target.parent;
  return (
    isNodeOfType(property, "Property") &&
    !property.computed &&
    property.value === target &&
    property.parent === owner.params[0] &&
    isNodeOfType(property.parent, "ObjectPattern")
  );
};

const getWrites = (symbol: SymbolDescriptor): EsTreeNode[] =>
  symbol.references
    .filter(
      (reference) => reference.flag !== "read" || isWithinAssignmentTarget(reference.identifier),
    )
    .map((reference) => reference.identifier);

const getSingleReturn = (node: EsTreeNode | null | undefined) => {
  const statement =
    isNodeOfType(node, "BlockStatement") && node.body.length === 1 ? node.body[0] : node;
  return isNodeOfType(statement, "ReturnStatement") ? statement : null;
};

const getPageRow = (body: EsTreeNode, index: SymbolDescriptor, scopes: ScopeAnalysis) => {
  if (!isNodeOfType(body, "BlockStatement")) return null;
  const [range, following] = body.body;
  if (
    body.body.length > 2 ||
    !isNodeOfType(range, "IfStatement") ||
    !isNodeOfType(range.test, "LogicalExpression") ||
    range.test.operator !== "||"
  )
    return null;
  const { left: lower, right: upper } = range.test;
  if (
    !isNodeOfType(lower, "BinaryExpression") ||
    lower.operator !== "<" ||
    !isBinding(lower.left, index, scopes) ||
    !isOne(lower.right) ||
    !isNodeOfType(upper, "BinaryExpression") ||
    upper.operator !== ">" ||
    !isBinding(upper.left, index, scopes) ||
    !isNodeOfType(upper.right, "Identifier")
  )
    return null;
  const early = getSingleReturn(range.consequent);
  if (!early || early.argument || Boolean(range.alternate) === Boolean(following)) return null;
  const returnedValue = getSingleReturn(range.alternate ?? following)?.argument;
  const returned = returnedValue ? stripParenExpression(returnedValue) : null;
  const maximum = scopes.symbolFor(upper.right);
  if (!maximum || !isNativeElement(returned, "li")) return null;
  return { row: returned, maximum };
};

const isActiveClass = (
  expression: EsTreeNode,
  index: SymbolDescriptor,
  page: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  if (isNodeOfType(expression, "Literal")) return typeof expression.value === "string";
  if (!isNodeOfType(expression, "TemplateLiteral") || expression.expressions.length !== 1)
    return false;
  const [part] = expression.expressions;
  if (
    !isNodeOfType(part, "ConditionalExpression") ||
    !isNodeOfType(part.consequent, "Literal") ||
    typeof part.consequent.value !== "string" ||
    !isNodeOfType(part.alternate, "Literal") ||
    typeof part.alternate.value !== "string"
  )
    return false;
  return (
    isNodeOfType(part.test, "BinaryExpression") &&
    part.test.operator === "===" &&
    ((isBinding(part.test.left, page, scopes) && isBinding(part.test.right, index, scopes)) ||
      (isBinding(part.test.right, page, scopes) && isBinding(part.test.left, index, scopes)))
  );
};

const hasPageDispatch = (
  expression: EsTreeNode,
  index: SymbolDescriptor,
  owner: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(expression, "ArrowFunctionExpression") ||
    expression.async ||
    expression.params.length !== 0 ||
    !isNodeOfType(expression.body, "CallExpression")
  )
    return false;
  const call = expression.body;
  if (
    call.optional ||
    call.arguments.length !== 1 ||
    !isBinding(call.arguments[0], index, scopes) ||
    !isNodeOfType(call.callee, "Identifier")
  )
    return false;
  const dispatch = scopes.symbolFor(call.callee);
  if (
    !dispatch ||
    getWrites(dispatch).length !== 0 ||
    !isNodeOfType(dispatch.declarationNode, "FunctionDeclaration") ||
    dispatch.declarationNode.async ||
    dispatch.declarationNode.generator ||
    findEnclosingFunction(dispatch.declarationNode) !== owner
  )
    return false;
  const [parameter] = dispatch.declarationNode.params;
  const [statement] = dispatch.declarationNode.body.body;
  if (
    dispatch.declarationNode.params.length !== 1 ||
    !isNodeOfType(parameter, "Identifier") ||
    dispatch.declarationNode.body.body.length !== 1 ||
    !isNodeOfType(statement, "ExpressionStatement") ||
    !isNodeOfType(statement.expression, "CallExpression") ||
    statement.expression.optional ||
    !isNodeOfType(statement.expression.callee, "Identifier")
  )
    return false;
  const forwarded = scopes.symbolFor(parameter);
  const callback = scopes.symbolFor(statement.expression.callee);
  const [value, ...metadata] = statement.expression.arguments;
  return Boolean(
    forwarded &&
    isBinding(value, forwarded, scopes) &&
    isOwnPropBinding(callback, owner) &&
    getWrites(callback).length === 0 &&
    metadata.every((argument) => {
      if (isNodeOfType(argument, "Literal")) return true;
      const symbol = isNodeOfType(argument, "Identifier") ? scopes.symbolFor(argument) : null;
      return (
        symbol?.kind === "parameter" &&
        symbol.scope.node === owner &&
        symbol !== forwarded &&
        getWrites(symbol).length === 0
      );
    }),
  );
};

const matchesRow = (
  row: EsTreeNode,
  key: EsTreeNode,
  index: SymbolDescriptor,
  page: SymbolDescriptor,
  owner: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNativeElement(row, "li")) return false;
  let hasKey = false;
  let hasDispatch = false;
  for (const attribute of row.openingElement.attributes) {
    if (!isNodeOfType(attribute, "JSXAttribute") || !isNodeOfType(attribute.name, "JSXIdentifier"))
      return false;
    const value = attribute.value;
    if (attribute.name.name === "key") {
      if (
        hasKey ||
        attribute !== key ||
        !isNodeOfType(value, "JSXExpressionContainer") ||
        !isBinding(value.expression, index, scopes)
      )
        return false;
      hasKey = true;
    } else if (attribute.name.name === "onClick") {
      if (
        hasDispatch ||
        !isNodeOfType(value, "JSXExpressionContainer") ||
        !hasPageDispatch(value.expression, index, owner, scopes)
      )
        return false;
      hasDispatch = true;
    } else if (attribute.name.name === "className") {
      if (
        !value ||
        !(isNodeOfType(value, "JSXExpressionContainer")
          ? isActiveClass(value.expression, index, page, scopes)
          : isNodeOfType(value, "Literal") && typeof value.value === "string")
      )
        return false;
    } else {
      return false;
    }
  }
  const children = meaningfulChildren(row.children);
  const [link] = children;
  if (
    !hasKey ||
    !hasDispatch ||
    children.length !== 1 ||
    !isNativeElement(link, "a") ||
    !link.openingElement.attributes.every(
      (attribute) =>
        isNodeOfType(attribute, "JSXAttribute") &&
        isNodeOfType(attribute.name, "JSXIdentifier") &&
        attribute.name.name === "className" &&
        isNodeOfType(attribute.value, "Literal"),
    )
  )
    return false;
  const labels = meaningfulChildren(link.children);
  return (
    labels.length === 1 &&
    isNodeOfType(labels[0], "JSXExpressionContainer") &&
    isBinding(labels[0].expression, index, scopes)
  );
};

// The clamp must not introduce a value derived from an array position.
const isPageCount = (
  maximum: SymbolDescriptor,
  page: SymbolDescriptor,
  owner: EsTreeNodeOfType<"FunctionExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const init = maximum.initializer;
  const declaration = maximum.declarationNode;
  if (
    maximum.kind !== "const" ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.id !== maximum.bindingIdentifier ||
    declaration.init !== init ||
    declaration.parent?.parent !== owner.body ||
    !isNodeOfType(init, "CallExpression") ||
    init.optional ||
    init.arguments.length !== 2 ||
    !isNodeOfType(init.callee, "Identifier")
  )
    return false;
  const memo = scopes.symbolFor(init.callee);
  const [compute, deps] = init.arguments;
  if (
    !memo ||
    getImportedName(memo.declarationNode) !== "useMemo" ||
    getValueImportSource(memo) !== "react" ||
    getWrites(memo).length !== 0 ||
    !isNodeOfType(compute, "ArrowFunctionExpression") ||
    compute.async ||
    compute.params.length !== 0 ||
    !isNodeOfType(deps, "ArrayExpression") ||
    deps.elements.length !== 2
  )
    return false;
  const result = getSingleReturnExpression(compute);
  if (
    !isNodeOfType(result, "BinaryExpression") ||
    result.operator !== "+" ||
    !isOne(result.right) ||
    !isNodeOfType(result.left, "CallExpression") ||
    result.left.optional ||
    result.left.arguments.length !== 1 ||
    !isNodeOfType(result.left.callee, "MemberExpression")
  )
    return false;
  const floor = result.left.callee;
  const quotient = stripParenExpression(result.left.arguments[0]);
  if (
    floor.computed ||
    floor.optional ||
    !isNodeOfType(floor.property, "Identifier") ||
    floor.property.name !== "floor" ||
    !isNodeOfType(floor.object, "Identifier") ||
    floor.object.name !== "Math" ||
    !scopes.isGlobalReference(floor.object) ||
    !isProvenUnmodifiedGlobalNamespaceReference(floor.object, "Math", scopes, "floor", true) ||
    !isNodeOfType(quotient, "BinaryExpression") ||
    quotient.operator !== "/"
  )
    return false;
  const numerator = stripParenExpression(quotient.left);
  if (
    !isNodeOfType(numerator, "BinaryExpression") ||
    numerator.operator !== "-" ||
    !isOne(numerator.right) ||
    !isNodeOfType(numerator.left, "Identifier") ||
    !isNodeOfType(quotient.right, "Identifier")
  )
    return false;
  const count = scopes.symbolFor(numerator.left);
  const pageSize = scopes.symbolFor(quotient.right);
  return (
    isOwnPropBinding(count, owner) &&
    isOwnPropBinding(pageSize, owner) &&
    count !== pageSize &&
    count !== page &&
    pageSize !== page &&
    getWrites(count).length === 0 &&
    getWrites(pageSize).length === 0 &&
    isBinding(deps.elements[0], count, scopes) &&
    isBinding(deps.elements[1], pageSize, scopes)
  );
};

const hasOnlyPageClamp = (
  page: SymbolDescriptor,
  maximum: SymbolDescriptor,
  render: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const writes = getWrites(page);
  if (writes.length === 0) return true;
  if (writes.length !== 1) return false;
  const [write] = writes;
  const assignment = write.parent;
  const statement = assignment?.parent;
  const block = statement?.parent;
  const guard = block?.parent;
  return (
    isNodeOfType(assignment, "AssignmentExpression") &&
    assignment.operator === "=" &&
    assignment.left === write &&
    isBinding(assignment.right, maximum, scopes) &&
    isNodeOfType(statement, "ExpressionStatement") &&
    isNodeOfType(block, "BlockStatement") &&
    block.body[0] === statement &&
    isNodeOfType(guard, "IfStatement") &&
    guard.consequent === block &&
    guard.parent === render.parent &&
    guard.range[1] < render.range[0] &&
    isNodeOfType(guard.test, "BinaryExpression") &&
    guard.test.operator === ">" &&
    isBinding(guard.test.left, page, scopes) &&
    isBinding(guard.test.right, maximum, scopes)
  );
};

const getDirectPageCalls = (helper: SymbolDescriptor) => {
  if (helper.references.length !== 3) return null;
  const calls = helper.references.map(({ identifier, flag }) => {
    const call = identifier.parent;
    const container = call?.parent;
    return flag === "read" &&
      isNodeOfType(call, "CallExpression") &&
      !call.optional &&
      call.callee === identifier &&
      call.arguments.length === 1 &&
      isNodeOfType(container, "JSXExpressionContainer") &&
      container.expression === call
      ? { call, container }
      : null;
  });
  if (calls.some((entry) => entry === null)) return null;
  const sorted = calls
    .filter((entry) => entry !== null)
    .sort((a, b) => a.call.range[0] - b.call.range[0]);
  const [before, now, after] = sorted;
  const list = now.container.parent;
  if (!isNativeElement(list, "ul")) return null;
  const siblings = meaningfulChildren(list.children);
  const first = siblings.indexOf(before.container);
  if (first < 0 || siblings[first + 1] !== now.container || siblings[first + 2] !== after.container)
    return null;
  return {
    before: before.call.arguments[0],
    now: now.call.arguments[0],
    after: after.call.arguments[0],
    list,
  };
};

// The closed group uses each page value as the label, key, and dispatched value.
export const isClosedPageLinkGroup = (
  helper: EsTreeNode,
  indexNode: EsTreeNode,
  key: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(helper, "ArrowFunctionExpression") ||
    helper.async ||
    helper.params.length !== 1
  )
    return false;
  const [parameter] = helper.params;
  const declarator = helper.parent;
  if (
    !isNodeOfType(parameter, "Identifier") ||
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.init !== helper ||
    !isNodeOfType(declarator.id, "Identifier")
  )
    return false;
  const owner = findEnclosingFunction(helper);
  if (
    !isNodeOfType(owner, "FunctionExpression") ||
    !owner.parent ||
    !isComponentAssignment(owner.parent) ||
    declarator.parent?.parent !== owner.body
  )
    return false;
  const symbol = scopes.symbolFor(declarator.id);
  const index = scopes.symbolFor(parameter);
  const program = scopes.rootScope.node;
  if (
    !symbol ||
    symbol.kind !== "const" ||
    !index ||
    !isBinding(indexNode, index, scopes) ||
    !isNodeOfType(program, "Program") ||
    program.sourceType !== "module" ||
    !hasCompleteSymbolReferences(symbol, program, scopes) ||
    !hasCompleteSymbolReferences(index, program, scopes) ||
    getWrites(index).length !== 0
  )
    return false;
  const calls = getDirectPageCalls(symbol);
  if (!calls || !isNodeOfType(calls.now, "Identifier")) return false;
  const page = scopes.symbolFor(calls.now);
  const jsx = getStaticJsxTreeRoot(calls.list.openingElement);
  const root = jsx ? findTransparentExpressionRoot(jsx) : null;
  const render = root?.parent;
  if (
    !isOwnPropBinding(page, owner) ||
    !isNodeOfType(page.bindingIdentifier.parent, "Property") ||
    !hasCompleteSymbolReferences(page, program, scopes) ||
    !isNodeOfType(render, "ReturnStatement") ||
    render.argument !== root ||
    render.parent !== owner.body ||
    declarator.range[1] >= render.range[0] ||
    !isNodeOfType(calls.before, "BinaryExpression") ||
    calls.before.operator !== "-" ||
    !isBinding(calls.before.left, page, scopes) ||
    !isOne(calls.before.right) ||
    !isNodeOfType(calls.after, "BinaryExpression") ||
    calls.after.operator !== "+" ||
    !isBinding(calls.after.left, page, scopes) ||
    !isOne(calls.after.right)
  )
    return false;
  const bounded = getPageRow(helper.body, index, scopes);
  if (
    !bounded ||
    bounded.maximum.declarationNode.range[1] >= declarator.range[0] ||
    !hasCompleteSymbolReferences(bounded.maximum, program, scopes) ||
    getWrites(bounded.maximum).length !== 0 ||
    !isPageCount(bounded.maximum, page, owner, scopes) ||
    !hasOnlyPageClamp(page, bounded.maximum, render, scopes) ||
    !matchesRow(bounded.row, key, index, page, owner, scopes)
  )
    return false;
  let hasDynamicScope = false;
  walkAst(owner, (node) => {
    if (hasDynamicScope) return false;
    const callee = isNodeOfType(node, "CallExpression") ? stripParenExpression(node.callee) : null;
    if (
      isNodeOfType(node, "WithStatement") ||
      (isNodeOfType(callee, "Identifier") && callee.name === "eval")
    ) {
      hasDynamicScope = true;
      return false;
    }
  });
  return !hasDynamicScope;
};
