import { defineRule } from "../../utils/define-rule.js";
import { isTypeOnlyImport } from "../../utils/is-type-only-import.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { getStaticObjectPropertyValue } from "../../utils/get-static-object-property-value.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { resolveImportedApiReference } from "../../utils/resolve-imported-api-reference.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const REACT_NATIVE_MODULE = "react-native";
const ANIMATED_IMPORT_NAME = "Animated";
const JS_THREAD_ANIMATION_IMPORTS = new Set([ANIMATED_IMPORT_NAME, "LayoutAnimation"]);

// The `Animated` APIs that take a `useNativeDriver` config; `loop` /
// `sequence` / `parallel` only compose these.
const ANIMATION_CONFIG_METHODS = new Set(["timing", "spring", "decay", "event"]);
const ANIMATION_CONFIG_ARGUMENT_INDEX = 1;
const USE_NATIVE_DRIVER_PROPERTY = "useNativeDriver";

const isReactNativeAnimatedReference = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const reference = resolveImportedApiReference(node, scopes);
  return (
    reference?.source === REACT_NATIVE_MODULE && reference.importedName === ANIMATED_IMPORT_NAME
  );
};

const isNativeDriverConfig = (config: EsTreeNode | undefined, scopes: ScopeAnalysis): boolean => {
  if (!config) return false;
  const configObject = resolveConstIdentifierAlias(config, scopes)?.initializer ?? config;
  const driverValue = getStaticObjectPropertyValue(configObject, USE_NATIVE_DRIVER_PROPERTY);
  return Boolean(driverValue && isNodeOfType(driverValue, "Literal") && driverValue.value === true);
};

export const rnPreferReanimated = defineRule({
  id: "rn-prefer-reanimated",
  title: "JS-thread animation instead of Reanimated",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "Use `import Animated from 'react-native-reanimated'` so animations run on the UI thread instead of the JS thread, which keeps them smooth.",
  create: (context: RuleContext) => {
    const animatedSpecifiers: EsTreeNodeOfType<"ImportSpecifier">[] = [];
    let hasNativeDriverAnimation = false;
    let hasJsThreadAnimation = false;

    return {
      ImportDeclaration(node: EsTreeNodeOfType<"ImportDeclaration">) {
        if (node.source?.value !== REACT_NATIVE_MODULE) return;
        if (isTypeOnlyImport(node)) return;

        for (const specifier of node.specifiers ?? []) {
          if (!isNodeOfType(specifier, "ImportSpecifier")) continue;
          if (specifier.importKind === "type") continue;
          const importedName = getImportedName(specifier);
          if (!importedName || !JS_THREAD_ANIMATION_IMPORTS.has(importedName)) continue;

          if (importedName === ANIMATED_IMPORT_NAME) {
            animatedSpecifiers.push(specifier);
            continue;
          }
          context.report({
            node: specifier,
            message: "Your users see stutter when LayoutAnimation runs on the JS thread.",
          });
        }
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isNodeOfType(node.callee, "MemberExpression")) return;
        const methodName = getStaticPropertyName(node.callee);
        if (!methodName || !ANIMATION_CONFIG_METHODS.has(methodName)) return;
        if (!isReactNativeAnimatedReference(node.callee.object, context.scopes)) return;

        if (isNativeDriverConfig(node.arguments[ANIMATION_CONFIG_ARGUMENT_INDEX], context.scopes)) {
          hasNativeDriverAnimation = true;
        } else {
          hasJsThreadAnimation = true;
        }
      },
      "Program:exit"() {
        if (hasNativeDriverAnimation && !hasJsThreadAnimation) return;
        for (const specifier of animatedSpecifiers) {
          context.report({
            node: specifier,
            message:
              "Your users see stutter when Animated from react-native runs on the JS thread.",
          });
        }
      },
    };
  },
});
