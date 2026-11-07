import { hasClosedJsonSnapshotJsxReferences } from "./has-closed-json-snapshot-jsx-references.js";
import { hasClosedJsonSnapshotNativeAttributes } from "./has-closed-json-snapshot-native-attributes.js";
import { isClosedJsonSnapshotOrdinalPresentation } from "./is-closed-json-snapshot-ordinal-presentation.js";
import { areStaticPropertyPathsDisjoint } from "./are-static-property-paths-disjoint.js";
import { isClosedJsonSnapshotFragmentOpening } from "./is-closed-json-snapshot-fragment-opening.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { getImportBindingForName } from "./find-import-source-for-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripGroupingParens } from "./strip-grouping-parens.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";
import {
  CLOSED_JSON_SNAPSHOT_LEAF_MAX_DEPTH,
  CLOSED_JSON_SNAPSHOT_LEAF_MAX_REFERENCES,
  CLOSED_JSON_SNAPSHOT_PROTOTYPE_PROPERTIES,
  CLOSED_JSON_SNAPSHOT_ROUTER_COMPONENT_NAMES,
} from "./closed-json-snapshot-leaf/constants.js";

export interface ClosedJsonSnapshotLeaf {
  readonly componentFunction: EsTreeNode;
  readonly parameterSymbol: SymbolDescriptor;
  readonly targetPath: readonly string[];
  readonly localTargetPath: readonly string[];
}

export interface ClosedJsonSnapshotLeafInput {
  readonly iteratorCall: EsTreeNodeOfType<"CallExpression">;
  readonly scopes: ScopeAnalysis;
  readonly hasAntdComponentRole?: boolean;
}

interface SnapshotParameterPath {
  readonly parameterSymbol: SymbolDescriptor;
  readonly targetPath: readonly string[];
  readonly localTargetPath: readonly string[];
}

interface SnapshotBranchRoot {
  readonly kind: "native" | "component" | "omitted";
  readonly tagName: string | null;
}

const readPropertyKey = (property: EsTreeNode): string | null => {
  if (!isNodeOfType(property, "Property") || property.method || property.kind !== "init")
    return null;
  if (!property.computed && isNodeOfType(property.key, "Identifier")) return property.key.name;
  return isNodeOfType(property.key, "Literal") && typeof property.key.value === "string"
    ? property.key.value
    : null;
};

const readParameterPath = (
  expression: EsTreeNode,
  componentFunction: EsTreeNode,
  scopes: ScopeAnalysis,
  depth = 0,
): SnapshotParameterPath | null => {
  if (depth > CLOSED_JSON_SNAPSHOT_LEAF_MAX_DEPTH || !isFunctionLike(componentFunction))
    return null;
  const unwrapped = stripParenExpression(expression);
  if (isNodeOfType(unwrapped, "MemberExpression")) {
    const propertyName = getStaticPropertyName(unwrapped);
    if (propertyName && CLOSED_JSON_SNAPSHOT_PROTOTYPE_PROPERTIES.has(propertyName)) return null;
    const parentPath = readParameterPath(unwrapped.object, componentFunction, scopes, depth + 1);
    return propertyName && parentPath
      ? {
          parameterSymbol: parentPath.parameterSymbol,
          targetPath: [...parentPath.targetPath, propertyName],
          localTargetPath: [...parentPath.localTargetPath, propertyName],
        }
      : null;
  }
  if (!isNodeOfType(unwrapped, "Identifier")) return null;
  const parameterSymbol = scopes.symbolFor(unwrapped);
  if (!parameterSymbol || parameterSymbol.kind !== "parameter") return null;
  const parameter = componentFunction.params[0];
  if (parameter === parameterSymbol.bindingIdentifier) {
    return { parameterSymbol, targetPath: [], localTargetPath: [] };
  }
  if (!isNodeOfType(parameter, "ObjectPattern")) return null;
  for (const property of parameter.properties) {
    if (!isNodeOfType(property, "Property") || property.value !== parameterSymbol.bindingIdentifier)
      continue;
    const propertyName = readPropertyKey(property);
    if (propertyName && !CLOSED_JSON_SNAPSHOT_PROTOTYPE_PROPERTIES.has(propertyName))
      return { parameterSymbol, targetPath: [propertyName], localTargetPath: [] };
  }
  return null;
};

const readDirectCallbackElement = (callback: EsTreeNode): EsTreeNodeOfType<"JSXElement"> | null => {
  if (!isFunctionLike(callback) || callback.async || callback.generator) return null;
  const body = stripGroupingParens(callback.body);
  if (isNodeOfType(body, "JSXElement")) return body;
  if (!isNodeOfType(body, "BlockStatement") || body.body.length !== 1) return null;
  const statement = body.body[0];
  if (!isNodeOfType(statement, "ReturnStatement") || !statement.argument) return null;
  const returned = stripGroupingParens(statement.argument);
  return isNodeOfType(returned, "JSXElement") ? returned : null;
};

const hasClosedParameterReads = (
  parameterSymbol: SymbolDescriptor,
  localTargetPath: readonly string[],
  iteratorCall: EsTreeNodeOfType<"CallExpression">,
): boolean => {
  if (parameterSymbol.references.length > CLOSED_JSON_SNAPSHOT_LEAF_MAX_REFERENCES) return false;
  let foundIteratorRead = false;
  for (const reference of parameterSymbol.references) {
    if (reference.flag !== "read") return false;
    let memberNode = reference.identifier;
    const referencePath: string[] = [];
    while (
      isNodeOfType(memberNode.parent, "MemberExpression") &&
      memberNode.parent.object === memberNode
    ) {
      const propertyName = getStaticPropertyName(memberNode.parent);
      if (!propertyName || CLOSED_JSON_SNAPSHOT_PROTOTYPE_PROPERTIES.has(propertyName))
        return false;
      referencePath.push(propertyName);
      memberNode = memberNode.parent;
      if (referencePath.length > CLOSED_JSON_SNAPSHOT_LEAF_MAX_DEPTH) return false;
    }
    if (areStaticPropertyPathsDisjoint(referencePath, localTargetPath)) continue;
    if (
      memberNode === iteratorCall.callee &&
      referencePath.length === localTargetPath.length + 1 &&
      referencePath.at(-1) === "map"
    ) {
      foundIteratorRead = true;
      continue;
    }
    return false;
  }
  return foundIteratorRead;
};

const readBranchRoot = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  hasAntdComponentRole: boolean,
): SnapshotBranchRoot | null => {
  let root = stripParenExpression(expression);
  if (isNodeOfType(root, "JSXFragment")) {
    const children = root.children.filter(
      (child) =>
        !(isNodeOfType(child, "JSXText") && child.value.trim().length === 0) &&
        !(
          isNodeOfType(child, "JSXExpressionContainer") &&
          isNodeOfType(child.expression, "JSXEmptyExpression")
        ),
    );
    if (children.length === 0) return { kind: "omitted", tagName: null };
    if (children.length !== 1) return null;
    const child = children[0];
    if (!child) return null;
    root = stripParenExpression(
      isNodeOfType(child, "JSXExpressionContainer") ? child.expression : child,
    );
  }
  if (
    (isNodeOfType(root, "Literal") && (root.value === null || root.value === false)) ||
    (isNodeOfType(root, "ArrayExpression") && root.elements.length === 0)
  )
    return { kind: "omitted", tagName: null };
  if (
    !isNodeOfType(root, "JSXElement") ||
    !isNodeOfType(root.openingElement.name, "JSXIdentifier") ||
    root.openingElement.attributes.some((attribute) =>
      isNodeOfType(attribute, "JSXSpreadAttribute"),
    )
  )
    return null;
  const name = root.openingElement.name;
  if (/^[a-z]/.test(name.name)) return { kind: "native", tagName: name.name };
  const symbol = scopes.symbolFor(name);
  const binding = getImportBindingForName(name, name.name);
  return symbol?.kind === "import" &&
    hasClosedJsonSnapshotJsxReferences(symbol) &&
    ((binding?.source === "react-router-dom" &&
      CLOSED_JSON_SNAPSHOT_ROUTER_COMPONENT_NAMES.has(binding.exportedName ?? "")) ||
      (hasAntdComponentRole && binding?.source === "antd" && binding.exportedName === "Carousel"))
    ? { kind: "component", tagName: null }
    : null;
};

const hasNonCompetingBranch = (
  selected: EsTreeNode,
  alternate: EsTreeNode,
  scopes: ScopeAnalysis,
  hasAntdComponentRole: boolean,
): boolean => {
  const alternateRoot = readBranchRoot(alternate, scopes, hasAntdComponentRole);
  if (!alternateRoot) return false;
  if (alternateRoot.kind === "omitted") return true;
  const selectedRoot = readBranchRoot(selected, scopes, hasAntdComponentRole);
  return Boolean(
    selectedRoot &&
    selectedRoot.kind !== "omitted" &&
    (selectedRoot.kind !== alternateRoot.kind ||
      (selectedRoot.kind === "native" && selectedRoot.tagName !== alternateRoot.tagName)),
  );
};

const hasSafeRenderAncestors = (
  iteratorCall: EsTreeNode,
  componentFunction: EsTreeNode,
  scopes: ScopeAnalysis,
  hasAntdComponentRole: boolean,
): boolean => {
  let child = iteratorCall;
  let ancestor = iteratorCall.parent;
  let depth = 0;
  let selectedReturn: EsTreeNodeOfType<"ReturnStatement"> | null = null;
  while (ancestor && ancestor !== componentFunction) {
    if (++depth > CLOSED_JSON_SNAPSHOT_LEAF_MAX_DEPTH) return false;
    if (isNodeOfType(ancestor, "ReturnStatement")) selectedReturn = ancestor;
    if (isNodeOfType(ancestor, "JSXElement")) {
      if (
        !hasClosedJsonSnapshotNativeAttributes(ancestor.openingElement, null, scopes) &&
        !isClosedJsonSnapshotFragmentOpening(ancestor.openingElement, scopes)
      )
        return false;
    } else if (isNodeOfType(ancestor, "ConditionalExpression")) {
      const alternate =
        ancestor.consequent === child
          ? ancestor.alternate
          : ancestor.alternate === child
            ? ancestor.consequent
            : null;
      if (!alternate) return false;
      if (!hasNonCompetingBranch(child, alternate, scopes, hasAntdComponentRole)) return false;
    } else if (isNodeOfType(ancestor, "LogicalExpression")) {
      if (ancestor.operator !== "&&" || ancestor.right !== child) return false;
    } else if (
      !isNodeOfType(ancestor, "JSXExpressionContainer") &&
      !isNodeOfType(ancestor, "JSXFragment") &&
      !isNodeOfType(ancestor, "ReturnStatement") &&
      !isNodeOfType(ancestor, "BlockStatement")
    )
      return false;
    child = ancestor;
    ancestor = ancestor.parent;
  }
  if (ancestor !== componentFunction || !isFunctionLike(componentFunction)) return false;
  if (!selectedReturn) return true;
  const selectedExpression = selectedReturn.argument;
  if (!selectedExpression) return false;
  let hasClosedReturns = true;
  walkAst(componentFunction.body, (node) => {
    if (!hasClosedReturns || isFunctionLike(node)) return false;
    if (
      isNodeOfType(node, "ReturnStatement") &&
      node !== selectedReturn &&
      (!node.argument ||
        !hasNonCompetingBranch(selectedExpression, node.argument, scopes, hasAntdComponentRole))
    ) {
      hasClosedReturns = false;
      return false;
    }
  });
  return hasClosedReturns;
};

const hasOpaqueParameterAccess = (
  componentFunction: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  let hasOpaqueAccess = false;
  walkAst(componentFunction, (node) => {
    if (
      isNodeOfType(node, "Identifier") &&
      ((node.name === "arguments" && !scopes.symbolFor(node)) ||
        (node.name === "eval" && scopes.isGlobalReference(node)))
    )
      hasOpaqueAccess = true;
  });
  return hasOpaqueAccess;
};

export const getClosedJsonSnapshotLeaf = ({
  iteratorCall,
  scopes,
  hasAntdComponentRole = false,
}: ClosedJsonSnapshotLeafInput): ClosedJsonSnapshotLeaf | null => {
  if (
    !isNodeOfType(iteratorCall.callee, "MemberExpression") ||
    getStaticPropertyName(iteratorCall.callee) !== "map" ||
    iteratorCall.optional ||
    iteratorCall.callee.optional ||
    iteratorCall.arguments.length !== 1
  )
    return null;
  const callback = iteratorCall.arguments[0];
  const element = callback && readDirectCallbackElement(callback);
  if (!element || !isFunctionLike(callback) || callback.params.length !== 2) return null;
  const itemParameter = callback.params[0];
  const indexParameter = callback.params[1];
  if (!isNodeOfType(itemParameter, "Identifier") || !isNodeOfType(indexParameter, "Identifier"))
    return null;
  const itemSymbol = scopes.symbolFor(itemParameter);
  const indexSymbol = scopes.symbolFor(indexParameter);
  if (
    !itemSymbol ||
    !indexSymbol ||
    itemSymbol.references.length !== 1 ||
    indexSymbol.references.some((reference) => reference.flag !== "read") ||
    !hasClosedJsonSnapshotNativeAttributes(element.openingElement, indexSymbol, scopes)
  )
    return null;
  const keyAttributes = element.openingElement.attributes.filter(
    (attribute) =>
      isNodeOfType(attribute, "JSXAttribute") &&
      isNodeOfType(attribute.name, "JSXIdentifier") &&
      attribute.name.name === "key",
  );
  const keyAttribute = keyAttributes[0];
  if (
    keyAttributes.length !== 1 ||
    !isNodeOfType(keyAttribute, "JSXAttribute") ||
    !isNodeOfType(keyAttribute.value, "JSXExpressionContainer") ||
    !isNodeOfType(stripParenExpression(keyAttribute.value.expression), "Identifier") ||
    scopes.symbolFor(stripParenExpression(keyAttribute.value.expression)) !== indexSymbol
  )
    return null;
  let itemChildCount = 0;
  for (const child of element.children) {
    if (isNodeOfType(child, "JSXText")) continue;
    if (!isNodeOfType(child, "JSXExpressionContainer")) return null;
    const expression = stripParenExpression(child.expression);
    if (isNodeOfType(expression, "Identifier") && scopes.symbolFor(expression) === itemSymbol)
      itemChildCount += 1;
    else if (!isClosedJsonSnapshotOrdinalPresentation(expression, indexSymbol, scopes)) return null;
  }
  if (itemChildCount !== 1) return null;
  const componentFunction = findEnclosingFunction(iteratorCall);
  if (
    !componentFunction ||
    !isFunctionLike(componentFunction) ||
    componentFunction.async ||
    componentFunction.generator ||
    componentFunction === callback ||
    !hasSafeRenderAncestors(iteratorCall, componentFunction, scopes, hasAntdComponentRole) ||
    hasOpaqueParameterAccess(componentFunction, scopes)
  )
    return null;
  const parameterPath = readParameterPath(iteratorCall.callee.object, componentFunction, scopes);
  if (
    !parameterPath ||
    parameterPath.targetPath.length === 0 ||
    !hasClosedParameterReads(
      parameterPath.parameterSymbol,
      parameterPath.localTargetPath,
      iteratorCall,
    )
  )
    return null;
  return { componentFunction, ...parameterPath };
};
