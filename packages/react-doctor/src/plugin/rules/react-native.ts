import {
  DEPRECATED_RN_MODULE_REPLACEMENTS,
  LEGACY_EXPO_PACKAGE_REPLACEMENTS,
  LEGACY_SHADOW_STYLE_PROPERTIES,
  RAW_TEXT_PREVIEW_MAX_CHARS,
  REACT_NATIVE_LIST_COMPONENTS,
  REACT_NATIVE_TEXT_COMPONENTS,
} from "../constants.js";
import { hasDirective, isMemberProperty } from "../helpers.js";
import type { EsTreeNode, Rule, RuleContext } from "../types.js";

const resolveJsxElementName = (openingElement: EsTreeNode): string | null => {
  const elementName = openingElement?.name;
  if (!elementName) return null;
  if (elementName.type === "JSXIdentifier") return elementName.name;
  if (elementName.type === "JSXMemberExpression") return elementName.property?.name ?? null;
  return null;
};

const truncateText = (text: string): string =>
  text.length > RAW_TEXT_PREVIEW_MAX_CHARS
    ? `${text.slice(0, RAW_TEXT_PREVIEW_MAX_CHARS)}...`
    : text;

const isRawTextContent = (child: EsTreeNode): boolean => {
  if (child.type === "JSXText") return Boolean(child.value?.trim());
  if (child.type !== "JSXExpressionContainer" || !child.expression) return false;

  const expression = child.expression;
  return (
    (expression.type === "Literal" &&
      (typeof expression.value === "string" || typeof expression.value === "number")) ||
    expression.type === "TemplateLiteral"
  );
};

const getRawTextDescription = (child: EsTreeNode): string => {
  if (child.type === "JSXText") {
    return `"${truncateText(child.value.trim())}"`;
  }

  if (child.type === "JSXExpressionContainer" && child.expression) {
    const expression = child.expression;
    if (expression.type === "Literal" && typeof expression.value === "string") {
      return `"${truncateText(expression.value)}"`;
    }
    if (expression.type === "Literal" && typeof expression.value === "number") {
      return `{${expression.value}}`;
    }
    if (expression.type === "TemplateLiteral") return "template literal";
  }

  return "text content";
};

export const rnNoRawText: Rule = {
  create: (context: RuleContext) => {
    let isDomComponentFile = false;

    return {
      Program(programNode: EsTreeNode) {
        isDomComponentFile = hasDirective(programNode, "use dom");
      },
      JSXElement(node: EsTreeNode) {
        if (isDomComponentFile) return;

        const elementName = resolveJsxElementName(node.openingElement);
        if (elementName && REACT_NATIVE_TEXT_COMPONENTS.has(elementName)) return;

        for (const child of node.children ?? []) {
          if (!isRawTextContent(child)) continue;

          context.report({
            node: child,
            message: `Raw ${getRawTextDescription(child)} outside a <Text> component — this will crash on React Native`,
          });
        }
      },
    };
  },
};

export const rnNoDeprecatedModules: Rule = {
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNode) {
      if (node.source?.value !== "react-native") return;

      for (const specifier of node.specifiers ?? []) {
        if (specifier.type !== "ImportSpecifier") continue;
        const importedName = specifier.imported?.name;
        if (!importedName) continue;

        const replacement = DEPRECATED_RN_MODULE_REPLACEMENTS[importedName];
        if (!replacement) continue;

        context.report({
          node: specifier,
          message: `"${importedName}" was removed from react-native — use ${replacement} instead`,
        });
      }
    },
  }),
};

export const rnNoLegacyExpoPackages: Rule = {
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNode) {
      const source = node.source?.value;
      if (typeof source !== "string") return;

      for (const [packageName, replacement] of Object.entries(LEGACY_EXPO_PACKAGE_REPLACEMENTS)) {
        if (source === packageName || source.startsWith(`${packageName}/`)) {
          context.report({
            node,
            message: `"${packageName}" is deprecated — use ${replacement}`,
          });
          return;
        }
      }
    },
  }),
};

export const rnNoDimensionsGet: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (node.callee?.type !== "MemberExpression") return;
      if (node.callee.object?.type !== "Identifier" || node.callee.object.name !== "Dimensions")
        return;

      if (isMemberProperty(node.callee, "get")) {
        context.report({
          node,
          message:
            "Dimensions.get() does not update on screen rotation or resize — use useWindowDimensions() for reactive layout",
        });
      }

      if (isMemberProperty(node.callee, "addEventListener")) {
        context.report({
          node,
          message:
            "Dimensions.addEventListener() was removed in React Native 0.72 — use useWindowDimensions() instead",
        });
      }
    },
  }),
};

export const rnNoInlineFlatlistRenderitem: Rule = {
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      if (node.name?.type !== "JSXIdentifier" || node.name.name !== "renderItem") return;
      if (!node.value || node.value.type !== "JSXExpressionContainer") return;

      const openingElement = node.parent;
      if (!openingElement || openingElement.type !== "JSXOpeningElement") return;

      const listComponentName = resolveJsxElementName(openingElement);
      if (!listComponentName || !REACT_NATIVE_LIST_COMPONENTS.has(listComponentName)) return;

      const expression = node.value.expression;
      if (
        expression?.type !== "ArrowFunctionExpression" &&
        expression?.type !== "FunctionExpression"
      )
        return;

      context.report({
        node: expression,
        message: `Inline renderItem on <${listComponentName}> creates a new function reference every render — extract to a named function or wrap in useCallback`,
      });
    },
  }),
};

const reportLegacyShadowProperties = (objectExpression: EsTreeNode, context: RuleContext): void => {
  const legacyShadowPropertyNames: string[] = [];

  for (const property of objectExpression.properties ?? []) {
    if (property.type !== "Property") continue;
    const propertyName = property.key?.type === "Identifier" ? property.key.name : null;
    if (propertyName && LEGACY_SHADOW_STYLE_PROPERTIES.has(propertyName)) {
      legacyShadowPropertyNames.push(propertyName);
    }
  }

  if (legacyShadowPropertyNames.length === 0) return;

  const quotedPropertyNames = legacyShadowPropertyNames.map((name) => `"${name}"`).join(", ");
  context.report({
    node: objectExpression,
    message: `Legacy shadow style${legacyShadowPropertyNames.length > 1 ? "s" : ""} ${quotedPropertyNames} — use boxShadow for cross-platform shadows on the new architecture`,
  });
};

export const rnNoLegacyShadowStyles: Rule = {
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      if (node.name?.type !== "JSXIdentifier" || node.name.name !== "style") return;
      if (node.value?.type !== "JSXExpressionContainer") return;

      const expression = node.value.expression;

      if (expression?.type === "ObjectExpression") {
        reportLegacyShadowProperties(expression, context);
      } else if (expression?.type === "ArrayExpression") {
        for (const element of expression.elements ?? []) {
          if (element?.type === "ObjectExpression") {
            reportLegacyShadowProperties(element, context);
          }
        }
      }
    },
    CallExpression(node: EsTreeNode) {
      if (node.callee?.type !== "MemberExpression") return;
      if (node.callee.object?.type !== "Identifier" || node.callee.object.name !== "StyleSheet")
        return;
      if (!isMemberProperty(node.callee, "create")) return;

      const stylesArgument = node.arguments?.[0];
      if (stylesArgument?.type !== "ObjectExpression") return;

      for (const styleDefinition of stylesArgument.properties ?? []) {
        if (styleDefinition.type !== "Property") continue;
        if (styleDefinition.value?.type !== "ObjectExpression") continue;
        reportLegacyShadowProperties(styleDefinition.value, context);
      }
    },
  }),
};

export const rnPreferReanimated: Rule = {
  create: (context: RuleContext) => ({
    ImportDeclaration(node: EsTreeNode) {
      if (node.source?.value !== "react-native") return;

      for (const specifier of node.specifiers ?? []) {
        if (specifier.type !== "ImportSpecifier") continue;
        if (specifier.imported?.name !== "Animated") continue;

        context.report({
          node: specifier,
          message:
            "Animated from react-native runs animations on the JS thread — use react-native-reanimated for performant UI-thread animations",
        });
      }
    },
  }),
};

export const rnNoSingleElementStyleArray: Rule = {
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNode) {
      const propName = node.name?.type === "JSXIdentifier" ? node.name.name : null;
      if (!propName) return;
      if (propName !== "style" && !propName.endsWith("Style")) return;
      if (node.value?.type !== "JSXExpressionContainer") return;

      const expression = node.value.expression;
      if (expression?.type !== "ArrayExpression") return;
      if (expression.elements?.length !== 1) return;

      context.report({
        node: expression,
        message: `Single-element style array on "${propName}" — use ${propName}={value} instead of ${propName}={[value]} to avoid unnecessary array allocation`,
      });
    },
  }),
};
