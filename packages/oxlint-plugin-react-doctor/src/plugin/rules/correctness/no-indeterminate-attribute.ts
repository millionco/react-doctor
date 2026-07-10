import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { classifyReactNativeFileTarget } from "../../utils/is-react-native-file.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getJsxPropStaticStringValues } from "../../utils/get-jsx-prop-static-string-values.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall, type ReactApiCallOptions } from "../../utils/is-react-api-call.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const MESSAGE =
  "The `indeterminate` HTML attribute does not set a checkbox's visual state. Assign the `HTMLInputElement.indeterminate` DOM property instead.";
const REACT_USE_REF_OPTIONS: ReactApiCallOptions = {
  allowGlobalReactNamespace: false,
  allowUnboundBareCalls: false,
};

const hasVisibleBindingNamed = (
  node: EsTreeNode,
  bindingName: string,
  scopes: ScopeAnalysis,
): boolean => {
  let scope = scopes.scopeFor(node);
  while (true) {
    if (scope.symbolsByName.has(bindingName)) return true;
    if (!scope.parent) return false;
    scope = scope.parent;
  }
};

const hasEnclosingTypeParameterNamed = (node: EsTreeNode, typeParameterName: string): boolean => {
  let ancestor = node.parent;
  while (ancestor) {
    if ("typeParameters" in ancestor) {
      const typeParameters = ancestor.typeParameters;
      if (
        typeParameters &&
        isNodeOfType(typeParameters, "TSTypeParameterDeclaration") &&
        typeParameters.params.some(
          (typeParameter) =>
            isNodeOfType(typeParameter, "TSTypeParameter") &&
            isNodeOfType(typeParameter.name, "Identifier") &&
            typeParameter.name.name === typeParameterName,
        )
      ) {
        return true;
      }
    }
    ancestor = ancestor.parent;
  }
  return false;
};

const isHtmlInputElementType = (typeNode: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (isNodeOfType(typeNode, "TSTypeReference")) {
    return (
      isNodeOfType(typeNode.typeName, "Identifier") &&
      typeNode.typeName.name === "HTMLInputElement" &&
      !hasVisibleBindingNamed(typeNode, "HTMLInputElement", scopes) &&
      !hasEnclosingTypeParameterNamed(typeNode, "HTMLInputElement")
    );
  }
  if (!isNodeOfType(typeNode, "TSUnionType")) return false;

  let hasHtmlInputElementMember = false;
  for (const unionMember of typeNode.types) {
    if (
      isNodeOfType(unionMember, "TSNullKeyword") ||
      isNodeOfType(unionMember, "TSUndefinedKeyword")
    ) {
      continue;
    }
    if (!isHtmlInputElementType(unionMember, scopes)) return false;
    hasHtmlInputElementMember = true;
  }
  return hasHtmlInputElementMember;
};

const getBindingTypeAnnotation = (symbol: SymbolDescriptor): EsTreeNode | null => {
  if (!isNodeOfType(symbol.bindingIdentifier, "Identifier")) return null;
  const annotation = symbol.bindingIdentifier.typeAnnotation;
  if (!annotation || !isNodeOfType(annotation, "TSTypeAnnotation")) return null;
  return annotation.typeAnnotation;
};

const getDirectConstInitializer = (symbol: SymbolDescriptor): EsTreeNode | null => {
  if (
    symbol.kind !== "const" ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier
  ) {
    return null;
  }
  return symbol.initializer;
};

const hasTypedHtmlInputRefOrigin = (rawExpression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const visitedSymbolIds = new Set<number>();
  let expression = stripParenExpression(rawExpression);
  while (isNodeOfType(expression, "Identifier")) {
    const symbol = scopes.symbolFor(expression);
    if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
    const initializer = getDirectConstInitializer(symbol);
    if (!initializer) return false;
    visitedSymbolIds.add(symbol.id);
    expression = stripParenExpression(initializer);
  }
  if (!isNodeOfType(expression, "CallExpression")) return false;
  if (!isReactApiCall(expression, "useRef", scopes, REACT_USE_REF_OPTIONS)) return false;
  if (!isNodeOfType(expression.typeArguments, "TSTypeParameterInstantiation")) return false;
  const typeArgument = expression.typeArguments.params[0];
  return Boolean(typeArgument && isHtmlInputElementType(typeArgument, scopes));
};

const isProvenHtmlInputElement = (rawExpression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const visitedSymbolIds = new Set<number>();
  let expression = stripParenExpression(rawExpression);
  while (true) {
    if (
      isNodeOfType(expression, "MemberExpression") &&
      !expression.computed &&
      isNodeOfType(expression.property, "Identifier") &&
      expression.property.name === "current"
    ) {
      return hasTypedHtmlInputRefOrigin(expression.object, scopes);
    }
    if (!isNodeOfType(expression, "Identifier")) return false;

    const symbol = scopes.symbolFor(expression);
    if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
    const typeAnnotation = getBindingTypeAnnotation(symbol);
    if (typeAnnotation && isHtmlInputElementType(typeAnnotation, scopes)) return true;
    const initializer = getDirectConstInitializer(symbol);
    if (!initializer) return false;

    visitedSymbolIds.add(symbol.id);
    expression = stripParenExpression(initializer);
  }
};

const getIndeterminateAttributeReceiver = (
  node: EsTreeNodeOfType<"CallExpression">,
): EsTreeNode | null => {
  const callee = stripParenExpression(node.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    !isNodeOfType(callee.property, "Identifier") ||
    (callee.property.name !== "setAttribute" && callee.property.name !== "toggleAttribute")
  ) {
    return null;
  }
  const attributeName = node.arguments[0];
  if (!isNodeOfType(attributeName, "Literal") || attributeName.value !== "indeterminate") {
    return null;
  }
  if (callee.property.name === "setAttribute") {
    const attributeValue = node.arguments[1];
    return attributeValue && !isNodeOfType(attributeValue, "SpreadElement") ? callee.object : null;
  }
  if (node.arguments.length === 1) return callee.object;

  const forceArgument = node.arguments[1];
  if (!forceArgument || isNodeOfType(forceArgument, "SpreadElement")) return null;
  const forceExpression = stripParenExpression(forceArgument);
  if (!isNodeOfType(forceExpression, "Literal") || forceExpression.value !== true) return null;
  return callee.object;
};

export const noIndeterminateAttribute = defineRule({
  id: "no-indeterminate-attribute",
  title: "Indeterminate checkbox state set as an attribute",
  severity: "warn",
  recommendation:
    "Assign the checkbox element's `indeterminate` DOM property, usually through a ref, because the HTML attribute does not control its visual state.",
  create: (context): RuleVisitors => {
    if (classifyReactNativeFileTarget(context) === "react-native") return {};

    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (!isNodeOfType(node.name, "JSXIdentifier") || node.name.name !== "input") return;
        let typeAttribute: EsTreeNodeOfType<"JSXAttribute"> | null = null;
        let typeAttributeIndex: number | null = null;
        let indeterminateAttribute: EsTreeNodeOfType<"JSXAttribute"> | null = null;
        let indeterminateAttributeIndex: number | null = null;
        let lastSpreadIndex: number | null = null;
        for (let attributeIndex = 0; attributeIndex < node.attributes.length; attributeIndex++) {
          const attribute = node.attributes[attributeIndex];
          if (isNodeOfType(attribute, "JSXSpreadAttribute")) {
            lastSpreadIndex = attributeIndex;
            continue;
          }
          if (
            !isNodeOfType(attribute, "JSXAttribute") ||
            !isNodeOfType(attribute.name, "JSXIdentifier")
          ) {
            continue;
          }
          if (attribute.name.name === "type") {
            typeAttribute = attribute;
            typeAttributeIndex = attributeIndex;
          } else if (attribute.name.name === "indeterminate") {
            indeterminateAttribute = attribute;
            indeterminateAttributeIndex = attributeIndex;
          }
        }
        if (
          !typeAttribute ||
          typeAttributeIndex === null ||
          !indeterminateAttribute ||
          indeterminateAttributeIndex === null
        ) {
          return;
        }
        if (
          lastSpreadIndex !== null &&
          (lastSpreadIndex > typeAttributeIndex || lastSpreadIndex > indeterminateAttributeIndex)
        ) {
          return;
        }
        const inputTypeValues = getJsxPropStaticStringValues(typeAttribute, context.scopes);
        if (
          !inputTypeValues ||
          !inputTypeValues.every((inputTypeValue) => inputTypeValue.toLowerCase() === "checkbox")
        ) {
          return;
        }
        context.report({ node: indeterminateAttribute, message: MESSAGE });
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const receiver = getIndeterminateAttributeReceiver(node);
        if (!receiver) return;
        if (!isProvenHtmlInputElement(receiver, context.scopes)) return;
        context.report({ node, message: MESSAGE });
      },
    };
  },
});
