import { defineRule } from "../../utils/define-rule.js";
import type { SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const REANIMATED_MODULE = "react-native-reanimated";

const REANIMATED_LAYOUT_STYLE_PROPERTIES = new Set([
  "width",
  "height",
  "top",
  "left",
  "right",
  "bottom",
  "minWidth",
  "minHeight",
  "maxWidth",
  "maxHeight",
  "margin",
  "marginTop",
  "marginBottom",
  "marginLeft",
  "marginRight",
  "marginHorizontal",
  "marginVertical",
  "padding",
  "paddingTop",
  "paddingBottom",
  "paddingLeft",
  "paddingRight",
  "paddingHorizontal",
  "paddingVertical",
  "flex",
  "flexBasis",
  "flexGrow",
  "flexShrink",
  "borderWidth",
  "borderTopWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderRightWidth",
  "fontSize",
  "lineHeight",
  "letterSpacing",
]);

const REANIMATED_ANIMATION_HELPERS = new Set([
  "withTiming",
  "withSpring",
  "withDecay",
  "withDelay",
  "withRepeat",
  "withSequence",
  "withClamp",
]);

const findImportDeclaration = (
  symbol: SymbolDescriptor,
): EsTreeNodeOfType<"ImportDeclaration"> | null => {
  let currentNode: EsTreeNode | null | undefined = symbol.declarationNode.parent;
  while (currentNode && !isNodeOfType(currentNode, "ImportDeclaration")) {
    currentNode = currentNode.parent ?? null;
  }
  return currentNode && isNodeOfType(currentNode, "ImportDeclaration") ? currentNode : null;
};

const isReanimatedImport = (symbol: SymbolDescriptor): boolean => {
  const importDeclaration = findImportDeclaration(symbol);
  if (!importDeclaration) return false;
  return importDeclaration.source.value === REANIMATED_MODULE;
};

const getReanimatedNamedImport = (node: EsTreeNode, context: RuleContext): string | null => {
  if (!isNodeOfType(node, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(node);
  if (!symbol || symbol.kind !== "import") return null;
  if (!isReanimatedImport(symbol)) return null;
  const declarationNode = symbol.declarationNode;
  if (!isNodeOfType(declarationNode, "ImportSpecifier")) return null;
  const importedName = declarationNode.imported;
  if (isNodeOfType(importedName, "Identifier")) return importedName.name;
  if (isNodeOfType(importedName, "Literal") && typeof importedName.value === "string") {
    return importedName.value;
  }
  return null;
};

const isReanimatedNamespace = (node: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(node, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(node);
  if (!symbol || symbol.kind !== "import") return false;
  if (!isReanimatedImport(symbol)) return false;
  return isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier");
};

const isUseAnimatedStyleCallee = (callee: EsTreeNode, context: RuleContext): boolean => {
  if (isNodeOfType(callee, "Identifier")) {
    return getReanimatedNamedImport(callee, context) === "useAnimatedStyle";
  }
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return false;
  if (!isNodeOfType(callee.property, "Identifier")) return false;
  if (callee.property.name !== "useAnimatedStyle") return false;
  return isReanimatedNamespace(callee.object, context);
};

const isReanimatedAnimationHelperCallee = (callee: EsTreeNode, context: RuleContext): boolean => {
  if (isNodeOfType(callee, "Identifier")) {
    const importedName = getReanimatedNamedImport(callee, context);
    return importedName !== null && REANIMATED_ANIMATION_HELPERS.has(importedName);
  }
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return false;
  if (!isNodeOfType(callee.property, "Identifier")) return false;
  if (!REANIMATED_ANIMATION_HELPERS.has(callee.property.name)) return false;
  return isReanimatedNamespace(callee.object, context);
};

const isFunctionLike = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "ArrowFunctionExpression") ||
  isNodeOfType(node, "FunctionExpression") ||
  isNodeOfType(node, "FunctionDeclaration");

const containsReanimatedAnimationHelperCall = (
  expression: EsTreeNode,
  context: RuleContext,
): boolean => {
  const rootExpression = stripParenExpression(expression);
  let didFindAnimationHelper = false;
  walkAst(rootExpression, (node) => {
    if (didFindAnimationHelper) return false;
    if (node !== rootExpression && isFunctionLike(node)) return false;
    if (
      isNodeOfType(node, "CallExpression") &&
      isReanimatedAnimationHelperCallee(node.callee, context)
    ) {
      didFindAnimationHelper = true;
      return false;
    }
  });
  return didFindAnimationHelper;
};

const findReturnedObject = (callback: EsTreeNode): EsTreeNodeOfType<"ObjectExpression"> | null => {
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") &&
    !isNodeOfType(callback, "FunctionExpression")
  ) {
    return null;
  }
  const body = stripParenExpression(callback.body);
  if (isNodeOfType(body, "ObjectExpression")) return body;
  if (!isNodeOfType(body, "BlockStatement")) return null;
  for (const statement of body.body ?? []) {
    if (!isNodeOfType(statement, "ReturnStatement")) continue;
    if (!statement.argument) continue;
    const returnArgument = stripParenExpression(statement.argument);
    if (isNodeOfType(returnArgument, "ObjectExpression")) return returnArgument;
  }
  return null;
};

const getStaticPropertyName = (property: EsTreeNodeOfType<"Property">): string | null => {
  if (!property.computed && isNodeOfType(property.key, "Identifier")) return property.key.name;
  if (isNodeOfType(property.key, "Literal") && typeof property.key.value === "string") {
    return property.key.value;
  }
  return null;
};

export const rnAnimateLayoutProperty = defineRule<Rule>({
  id: "rn-animate-layout-property",
  title: "Animating a layout property",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  category: "Performance",
  recommendation:
    "Prefer transform or opacity when a Reanimated animation helper drives purely visual motion; use layout-affecting styles only when the layout itself must change.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isUseAnimatedStyleCallee(node.callee, context)) return;
      const callback = node.arguments?.[0];
      if (!callback) return;
      const returnedObject = findReturnedObject(callback);
      if (!returnedObject) return;

      for (const property of returnedObject.properties ?? []) {
        if (!isNodeOfType(property, "Property")) continue;
        const propertyName = getStaticPropertyName(property);
        if (propertyName === null) continue;
        if (!REANIMATED_LAYOUT_STYLE_PROPERTIES.has(propertyName)) continue;
        const propertyValue = property.value;
        if (!containsReanimatedAnimationHelperCall(propertyValue, context)) continue;

        context.report({
          node: property,
          message: `Reanimated can animate "${propertyName}", but this layout-affecting style recalculates layout while the animation runs; prefer transform or opacity when the motion is only visual.`,
        });
      }
    },
  }),
});
