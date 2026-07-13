import { defineRule } from "../../utils/define-rule.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isLegacyArchReactNativeFile } from "../../utils/is-legacy-arch-react-native-file.js";
import { normalizeFilename } from "../../utils/normalize-filename.js";
import { collectStylePropertyKeyNames } from "./utils/collect-style-property-key-names.js";
import { resolveStyleSheetCreateCallExpression } from "./utils/resolve-stylesheet-create-call-expression.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const EMPTY_VISITORS: RuleVisitors = {};

const IOS_SHADOW_KEYS = new Set(["shadowColor", "shadowOffset", "shadowOpacity", "shadowRadius"]);
const ANDROID_SHADOW_KEY = "elevation";

const LEGACY_SHADOW_KEYS = new Set([...IOS_SHADOW_KEYS, ANDROID_SHADOW_KEY]);

const STYLE_FACTORY_CALLEE_PATTERN = /(?:^|\.)(?:make|create)(?:Use)?Styles$/;

const styleFactoryCallbackObject = (node: EsTreeNode): EsTreeNode | null => {
  if (!isNodeOfType(node, "CallExpression")) return null;
  const calleeName = isNodeOfType(node.callee, "Identifier") ? node.callee.name : null;
  if (calleeName === null || !STYLE_FACTORY_CALLEE_PATTERN.test(calleeName)) return null;
  const factoryCallback = node.arguments?.[0];
  if (!factoryCallback) return null;
  if (isNodeOfType(factoryCallback, "ObjectExpression")) return factoryCallback;
  if (
    isNodeOfType(factoryCallback, "ArrowFunctionExpression") &&
    factoryCallback.body &&
    isNodeOfType(factoryCallback.body, "ObjectExpression")
  ) {
    return factoryCallback.body;
  }
  return null;
};

// The object literal declaring the named styles behind `styles.foo`:
// `const styles = StyleSheet.create({...})` directly, or
// `const styles = useStyles()` where `useStyles = makeStyles(() => ({...}))`.
const resolveStylesDeclarationObject = (
  node: EsTreeNode,
  stylesName: string,
): EsTreeNode | null => {
  const binding = findVariableInitializer(node, stylesName);
  const initializer = binding?.initializer;
  if (!initializer || !isNodeOfType(initializer, "CallExpression")) return null;
  const styleSheetCall = resolveStyleSheetCreateCallExpression(initializer);
  if (styleSheetCall) {
    const stylesArgument = styleSheetCall.arguments?.[0];
    return stylesArgument && isNodeOfType(stylesArgument, "ObjectExpression")
      ? stylesArgument
      : null;
  }
  if (isNodeOfType(initializer.callee, "Identifier")) {
    const hookBinding = findVariableInitializer(node, initializer.callee.name);
    const hookInitializer = hookBinding?.initializer;
    if (hookInitializer) return styleFactoryCallbackObject(hookInitializer);
  }
  return null;
};

// Resolves `styles.foo` against a same-file stylesheet declaration so sibling
// entries in a style array contribute their keys to the platform coverage
// check.
const resolveStyleSheetMemberKeys = (node: EsTreeNode): Set<string> | null => {
  if (!isNodeOfType(node, "MemberExpression") || node.computed) return null;
  if (!isNodeOfType(node.object, "Identifier") || !isNodeOfType(node.property, "Identifier")) {
    return null;
  }
  const declarationObject = resolveStylesDeclarationObject(node, node.object.name);
  if (!declarationObject || !isNodeOfType(declarationObject, "ObjectExpression")) return null;
  for (const styleDefinition of declarationObject.properties ?? []) {
    if (!isNodeOfType(styleDefinition, "Property")) continue;
    if (!isNodeOfType(styleDefinition.key, "Identifier")) continue;
    if (styleDefinition.key.name !== node.property.name) continue;
    if (!isNodeOfType(styleDefinition.value, "ObjectExpression")) return null;
    return collectStylePropertyKeyNames(styleDefinition.value);
  }
  return null;
};

const hasIosShadowKey = (keyNames: ReadonlySet<string>): boolean => {
  for (const keyName of keyNames) {
    if (IOS_SHADOW_KEYS.has(keyName)) return true;
  }
  return false;
};

const reportLegacyShadowProperty = (
  objectExpression: EsTreeNodeOfType<"ObjectExpression">,
  context: RuleContext,
  siblingKeyNames: ReadonlySet<string>,
): boolean => {
  const ownKeyNames = collectStylePropertyKeyNames(objectExpression);
  const combinedKeyNames = new Set([...ownKeyNames, ...siblingKeyNames]);

  // When elevation AND an iOS shadow* key are both present (in this object
  // or a sibling entry of the same style array), both platforms already
  // render a shadow — the "users on the other platform see no shadow"
  // premise is false.
  if (combinedKeyNames.has(ANDROID_SHADOW_KEY) && hasIosShadowKey(combinedKeyNames)) return false;

  for (const property of objectExpression.properties ?? []) {
    if (!isNodeOfType(property, "Property")) continue;
    if (!isNodeOfType(property.key, "Identifier")) continue;
    const keyName = property.key.name;
    if (!LEGACY_SHADOW_KEYS.has(keyName)) continue;
    // `{ zIndex: 4, elevation: 4 }` with no iOS shadow keys is the canonical
    // Android stacking-order idiom, not a shadow effect — a boxShadow string
    // can't replace the z-ordering it exists for.
    if (keyName === ANDROID_SHADOW_KEY && ownKeyNames.has("zIndex")) continue;
    context.report({
      node: property,
      message: `Your users on the other platform see no shadow when you use ${keyName}.`,
    });
    return true;
  }
  return false;
};

// HACK: React Native v7+ supports the standard CSS `boxShadow` string
// (`"0 2px 8px rgba(0,0,0,0.1)"`) which renders identically on iOS and
// Android. The legacy `shadowColor`/`shadowOffset`/`shadowOpacity`/
// `shadowRadius` keys only work on iOS, and `elevation` is Android-only,
// so cross-platform code historically had to declare both — `boxShadow`
// collapses that into one key.
export const rnStylePreferBoxShadow = defineRule({
  id: "rn-style-prefer-boxshadow",
  title: "Platform-specific shadow keys over boxShadow",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    'These shadow keys only work on one platform. On RN v7+, use the CSS `boxShadow` string instead, like `boxShadow: "0 2px 8px rgba(0,0,0,0.1)"`, which works on both.',
  create: (context: RuleContext) => {
    // The doc's FP carve-out: boxShadow shipped in RN 0.76 and needs the New
    // Architecture, so on older or legacy-arch apps the platform-specific
    // keys remain the only option.
    if (context.filename && isLegacyArchReactNativeFile(normalizeFilename(context.filename))) {
      return EMPTY_VISITORS;
    }
    return {
      JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
        if (!isNodeOfType(node.name, "JSXIdentifier")) return;
        const attrName = node.name.name;
        if (attrName !== "style" && !attrName.endsWith("Style")) return;
        if (!isNodeOfType(node.value, "JSXExpressionContainer")) return;
        const expression = node.value.expression;

        if (isNodeOfType(expression, "ObjectExpression")) {
          reportLegacyShadowProperty(expression, context, new Set());
        } else if (isNodeOfType(expression, "ArrayExpression")) {
          const elements = expression.elements ?? [];
          const siblingKeyNames = new Set<string>();
          for (const element of elements) {
            if (isNodeOfType(element, "ObjectExpression")) {
              for (const keyName of collectStylePropertyKeyNames(element)) {
                siblingKeyNames.add(keyName);
              }
              continue;
            }
            if (!element) continue;
            const resolvedKeys = resolveStyleSheetMemberKeys(element);
            if (resolvedKeys) {
              for (const keyName of resolvedKeys) siblingKeyNames.add(keyName);
            }
          }
          for (const element of elements) {
            if (!isNodeOfType(element, "ObjectExpression")) continue;
            if (reportLegacyShadowProperty(element, context, siblingKeyNames)) return;
          }
        }
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const styleSheetCall = resolveStyleSheetCreateCallExpression(node);
        if (!styleSheetCall) return;
        const arg = styleSheetCall.arguments?.[0];
        if (!isNodeOfType(arg, "ObjectExpression")) return;
        for (const property of arg.properties ?? []) {
          if (!isNodeOfType(property, "Property")) continue;
          if (!isNodeOfType(property.value, "ObjectExpression")) continue;
          reportLegacyShadowProperty(property.value, context, new Set());
        }
      },
    };
  },
});
