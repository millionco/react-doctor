import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import { REACT_RUNTIME_MODULE_SOURCES } from "../constants/react.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { getAuthoritativeJsxAttribute } from "./get-authoritative-jsx-attribute.js";
import { getImportedName } from "./get-imported-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { getValueImportSource } from "./get-value-import-declaration.js";
import { readStaticBoolean } from "./read-static-boolean.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import type { RuleContext } from "./rule-context.js";
import { walkAst } from "./walk-ast.js";
import {
  ALWAYS_TRUTHY_LOADING_SELECTOR_NODE_TYPES,
  LOADING_STATE_INITIALIZER_ARGUMENT_COUNT,
  LOADING_STATE_TUPLE_LENGTH,
  REACT_VALUE_API_NAMES,
  UNIQUE_LOADING_ATTRIBUTE_COUNT,
  UNSUPPORTED_LOADING_ROLE_NODE_TYPES,
} from "./rendered-antd-loading-setter/constants.js";

const renderedSetterByScopes = new WeakMap<ScopeAnalysis, WeakMap<SymbolDescriptor, boolean>>();
const supportedProgramByScopes = new WeakMap<ScopeAnalysis, boolean>();
const childrenByJsxParent = new WeakMap<EsTreeNode, WeakSet<EsTreeNode>>();

const isDirectCallCallee = (node: EsTreeNode): boolean =>
  isNodeOfType(node.parent, "CallExpression") &&
  node.parent.callee === node &&
  !node.parent.optional;

const hasDirectReactProviderReferences = (symbol: SymbolDescriptor): boolean => {
  const importedName = getImportedName(symbol.declarationNode);
  return symbol.references.every((reference) => {
    if (reference.flag !== "read") return false;
    const identifier = reference.identifier;
    if (isNodeOfType(symbol.declarationNode, "ImportSpecifier") && importedName !== "default") {
      return isDirectCallCallee(identifier);
    }
    const member = identifier.parent;
    return Boolean(
      isNodeOfType(member, "MemberExpression") &&
      member.object === identifier &&
      !member.optional &&
      REACT_VALUE_API_NAMES.has(getStaticPropertyName(member) ?? "") &&
      isDirectCallCallee(member),
    );
  });
};

const hasSupportedLoadingRoleProgram = (context: RuleContext): boolean => {
  const cachedSupport = supportedProgramByScopes.get(context.scopes);
  if (cachedSupport !== undefined) return cachedSupport;
  let supported = true;
  walkAst(context.scopes.rootScope.node, (node) => {
    if (!supported) return false;
    if (isTypeScriptTypePosition(node)) return false;
    if (
      UNSUPPORTED_LOADING_ROLE_NODE_TYPES.has(node.type) ||
      ("declare" in node && node.declare === true)
    ) {
      supported = false;
      return false;
    }
    if (!isNodeOfType(node, "Identifier")) return;
    const reference = context.scopes.referenceFor(node);
    if (!reference) return;
    if (
      node.name === "eval" ||
      reference.resolvedSymbol?.kind === "ts-interface" ||
      reference.resolvedSymbol?.kind === "ts-type-alias"
    ) {
      supported = false;
    }
  });
  if (!supported) {
    supportedProgramByScopes.set(context.scopes, false);
    return false;
  }
  const supportedProviders = context.scopes.rootScope.symbols.every((symbol) => {
    const source = getValueImportSource(symbol);
    if (source && REACT_RUNTIME_MODULE_SOURCES.has(source)) {
      return hasDirectReactProviderReferences(symbol);
    }
    if (source !== "antd") return true;
    if (getImportedName(symbol.declarationNode) === "Button") {
      return symbol.references.every((reference) => {
        const parent = reference.identifier.parent;
        return (
          reference.flag === "read" &&
          (isNodeOfType(parent, "JSXOpeningElement") ||
            isNodeOfType(parent, "JSXClosingElement")) &&
          parent.name === reference.identifier
        );
      });
    }
    return symbol.references.length === 0;
  });
  supportedProgramByScopes.set(context.scopes, supportedProviders);
  return supportedProviders;
};

const isNativeJsxContainer = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "JSXElement")) return false;
  const name = node.openingElement.name;
  return (
    isNodeOfType(name, "JSXIdentifier") &&
    /^[a-z][a-z0-9]*$/u.test(name.name) &&
    node.openingElement.attributes.every(
      (attribute) =>
        isNodeOfType(attribute, "JSXAttribute") &&
        isNodeOfType(attribute.name, "JSXIdentifier") &&
        attribute.name.name !== "is" &&
        attribute.name.name !== "children" &&
        attribute.name.name !== "dangerouslySetInnerHTML",
    )
  );
};

const hasUnsupportedLiteralSelector = (node: EsTreeNode): boolean => {
  let expression = stripParenExpression(node);
  let hasUnarySelector = false;
  while (isNodeOfType(expression, "UnaryExpression")) {
    if (expression.operator === "void" || expression.operator === "typeof") return true;
    hasUnarySelector = true;
    expression = stripParenExpression(expression.argument);
  }
  if (ALWAYS_TRUTHY_LOADING_SELECTOR_NODE_TYPES.has(expression.type)) return true;
  if (isNodeOfType(expression, "TemplateLiteral") && expression.expressions.length === 0) {
    return true;
  }
  if (!isNodeOfType(expression, "Literal")) return false;
  if (hasUnarySelector) return true;
  if ("regex" in expression && expression.regex !== null && expression.regex !== undefined) {
    return true;
  }
  if ("bigint" in expression && expression.bigint !== null && expression.bigint !== undefined) {
    return true;
  }
  const value = expression.value;
  return (
    value !== null &&
    typeof value !== "boolean" &&
    typeof value !== "string" &&
    typeof value !== "number"
  );
};

const readPrimitiveLiteralTruthiness = (node: EsTreeNode): boolean | null => {
  const booleanValue = readStaticBoolean(node);
  if (booleanValue !== null) return booleanValue;
  const expression = stripParenExpression(node);
  if (!isNodeOfType(expression, "Literal")) return null;
  const value = expression.value;
  return value === null || typeof value === "string" || typeof value === "number"
    ? Boolean(value)
    : null;
};

const reachesOwnerReturn = (element: EsTreeNode, owner: EsTreeNode): boolean => {
  let current: EsTreeNode = element;
  while (current.parent) {
    const parent = current.parent;
    const parentType: string = parent.type;
    if (isNodeOfType(parent, "ReturnStatement")) {
      return parent.argument === current && findEnclosingFunction(parent) === owner;
    }
    if (parent === owner && isFunctionLike(owner)) return owner.body === current;
    if (
      parentType === "ParenthesizedExpression" &&
      "expression" in parent &&
      parent.expression === current
    ) {
      current = parent;
      continue;
    }
    if (
      isNodeOfType(parent, "LogicalExpression") &&
      (parent.operator === "&&" || parent.operator === "||") &&
      (parent.left === current || parent.right === current)
    ) {
      if (parent.left !== current && hasUnsupportedLiteralSelector(parent.left)) return false;
      const leftTruthiness = readPrimitiveLiteralTruthiness(parent.left);
      if (parent.operator === "&&" && (parent.left === current || leftTruthiness === false))
        return false;
      if (parent.operator === "||" && parent.right === current && leftTruthiness === true) {
        return false;
      }
      current = parent;
      continue;
    }
    if (
      isNodeOfType(parent, "ConditionalExpression") &&
      (parent.consequent === current || parent.alternate === current)
    ) {
      if (hasUnsupportedLiteralSelector(parent.test)) return false;
      const testTruthiness = readPrimitiveLiteralTruthiness(parent.test);
      if (
        (testTruthiness === true && parent.alternate === current) ||
        (testTruthiness === false && parent.consequent === current)
      )
        return false;
      current = parent;
      continue;
    }
    if (isNodeOfType(parent, "JSXExpressionContainer") && parent.expression === current) {
      current = parent;
      continue;
    }
    if (
      (isNodeOfType(parent, "JSXFragment") || isNativeJsxContainer(parent)) &&
      (isNodeOfType(parent, "JSXElement") || isNodeOfType(parent, "JSXFragment"))
    ) {
      let children = childrenByJsxParent.get(parent);
      if (!children) {
        children = new WeakSet(parent.children);
        childrenByJsxParent.set(parent, children);
      }
      if (!children.has(current)) return false;
      current = parent;
      continue;
    }
    return false;
  }
  return false;
};

const isLoadingAttribute = (identifier: EsTreeNode): boolean => {
  const container = identifier.parent;
  const attribute = container?.parent;
  return Boolean(
    isNodeOfType(container, "JSXExpressionContainer") &&
    container.expression === identifier &&
    isNodeOfType(attribute, "JSXAttribute") &&
    isNodeOfType(attribute.name, "JSXIdentifier") &&
    attribute.name.name === "loading",
  );
};

const hasRenderedButtonLoading = (
  state: SymbolDescriptor,
  owner: EsTreeNode,
  context: RuleContext,
): boolean => {
  let didFindRenderedButton = false;
  for (const reference of state.references) {
    const identifier = reference.identifier;
    if (reference.flag !== "read" || !isLoadingAttribute(identifier)) return false;
    const opening = identifier.parent?.parent?.parent;
    if (!isNodeOfType(opening, "JSXOpeningElement")) return false;
    const element = opening.parent;
    const button = context.scopes.symbolFor(opening.name);
    if (
      !button ||
      getValueImportSource(button) !== "antd" ||
      getImportedName(button.declarationNode) !== "Button" ||
      !isNodeOfType(opening.name, "JSXIdentifier") ||
      findEnclosingFunction(opening) !== owner ||
      opening.attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute")) ||
      opening.attributes.filter(
        (attribute) =>
          isNodeOfType(attribute, "JSXAttribute") &&
          isNodeOfType(attribute.name, "JSXIdentifier") &&
          attribute.name.name === "loading",
      ).length !== UNIQUE_LOADING_ATTRIBUTE_COUNT ||
      getAuthoritativeJsxAttribute(opening.attributes, "loading") !== identifier.parent?.parent ||
      !isNodeOfType(element, "JSXElement")
    )
      return false;
    if (reachesOwnerReturn(element, owner)) didFindRenderedButton = true;
  }
  return didFindRenderedButton;
};

const computeRenderedLoadingSetter = (setter: SymbolDescriptor, context: RuleContext): boolean => {
  const declaration = setter.declarationNode;
  if (
    setter.kind !== "const" ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "ArrayPattern") ||
    declaration.id.elements.length !== LOADING_STATE_TUPLE_LENGTH ||
    !isNodeOfType(declaration.parent, "VariableDeclaration") ||
    declaration.parent.kind !== "const"
  )
    return false;
  const [stateBinding, setterBinding] = declaration.id.elements;
  const initializer = declaration.init;
  const owner = findEnclosingFunction(declaration);
  if (
    setterBinding !== setter.bindingIdentifier ||
    !isNodeOfType(stateBinding, "Identifier") ||
    !isNodeOfType(setterBinding, "Identifier") ||
    !owner ||
    !isFunctionLike(owner) ||
    owner.async ||
    owner.generator ||
    !isNodeOfType(initializer, "CallExpression") ||
    initializer.optional ||
    initializer.arguments.length !== LOADING_STATE_INITIALIZER_ARGUMENT_COUNT ||
    !isReactApiCall(initializer, "useState", context.scopes)
  )
    return false;
  const callee = initializer.callee;
  const provider = isNodeOfType(callee, "Identifier")
    ? callee
    : isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.object, "Identifier")
      ? callee.object
      : null;
  const providerSymbol = provider ? context.scopes.symbolFor(provider) : null;
  if (!providerSymbol || getValueImportSource(providerSymbol) !== "react") return false;
  const [initialValue] = initializer.arguments;
  const state = context.scopes.symbolFor(stateBinding);
  if (!isNodeOfType(initialValue, "Literal") || typeof initialValue.value !== "boolean" || !state) {
    return false;
  }
  if (
    !setter.references.every((reference) => {
      const call = reference.identifier.parent;
      if (
        reference.flag !== "read" ||
        !isDirectCallCallee(reference.identifier) ||
        !isNodeOfType(call, "CallExpression") ||
        call.arguments.length !== LOADING_STATE_INITIALIZER_ARGUMENT_COUNT
      )
        return false;
      const [value] = call.arguments;
      return isNodeOfType(value, "Literal") && typeof value.value === "boolean";
    })
  )
    return false;
  return hasSupportedLoadingRoleProgram(context) && hasRenderedButtonLoading(state, owner, context);
};

export const isRenderedAntdLoadingSetter = (
  identifier: EsTreeNode,
  context: RuleContext,
): boolean => {
  const setter = context.scopes.symbolFor(identifier);
  if (!setter) return false;
  let setters = renderedSetterByScopes.get(context.scopes);
  if (!setters) {
    setters = new WeakMap();
    renderedSetterByScopes.set(context.scopes, setters);
  }
  const cached = setters.get(setter);
  if (cached !== undefined) return cached;
  const result = computeRenderedLoadingSetter(setter, context);
  setters.set(setter, result);
  return result;
};
