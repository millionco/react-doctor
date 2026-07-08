import { defineRule } from "../../utils/define-rule.js";
import { findDeclaratorForBinding } from "../../utils/find-declarator-for-binding.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import type { BindingInfo } from "../../utils/find-variable-initializer.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { flattenCalleeName } from "../../utils/flatten-callee-name.js";
import {
  getImportBindingForName,
  getImportSourceForName,
  getImportedNameFromModule,
} from "../../utils/find-import-source-for-name.js";
import { getInitializerModuleSource } from "../../utils/get-initializer-module-source.js";
import { getRequireCallSource } from "../../utils/get-require-call-source.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isInsideFunctionScope } from "../../utils/is-inside-function-scope.js";
import { isMemberProperty } from "../../utils/is-member-property.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const IMPORT_SPECIFIER_TYPES = new Set([
  "ImportSpecifier",
  "ImportDefaultSpecifier",
  "ImportNamespaceSpecifier",
]);

const REACT_NATIVE_MODULE = "react-native";

// Classifies an in-scope binding as React Native's `Dimensions` export —
// direct import, renamed import, namespace member, or require destructuring.
const isBindingReactNativeDimensions = (
  node: EsTreeNode,
  binding: BindingInfo,
  localName: string,
): boolean => {
  if (binding.initializer && IMPORT_SPECIFIER_TYPES.has(binding.initializer.type)) {
    const importSource = getImportSourceForName(node, localName);
    if (importSource !== REACT_NATIVE_MODULE) return false;
    const importedName = getImportedNameFromModule(node, localName, REACT_NATIVE_MODULE);
    return importedName === null || importedName === "Dimensions";
  }
  const declarator = findDeclaratorForBinding(binding.bindingIdentifier);
  if (declarator === null) return false;
  const declaratorInitializer = declarator.init;
  if (!declaratorInitializer) return true;
  if (getInitializerModuleSource(node, declaratorInitializer) === REACT_NATIVE_MODULE) return true;
  if (
    isNodeOfType(declaratorInitializer, "MemberExpression") &&
    !declaratorInitializer.computed &&
    isNodeOfType(declaratorInitializer.property, "Identifier") &&
    declaratorInitializer.property.name === "Dimensions"
  ) {
    return getInitializerModuleSource(node, declaratorInitializer.object) === REACT_NATIVE_MODULE;
  }
  return false;
};

const isReactNativeDimensionsCallee = (node: EsTreeNode, callee: EsTreeNode): boolean => {
  if (!isNodeOfType(callee, "MemberExpression")) return false;

  if (isNodeOfType(callee.object, "Identifier")) {
    const localName = callee.object.name;
    const binding = findVariableInitializer(node, localName);
    if (binding !== null) return isBindingReactNativeDimensions(node, binding, localName);
    return localName === "Dimensions";
  }

  if (
    isNodeOfType(callee.object, "MemberExpression") &&
    !callee.object.computed &&
    isNodeOfType(callee.object.property, "Identifier") &&
    callee.object.property.name === "Dimensions"
  ) {
    const moduleSource = getInitializerModuleSource(node, callee.object.object);
    if (moduleSource === REACT_NATIVE_MODULE) return true;
    const rootName = getRootIdentifierName(callee.object.object);
    if (rootName === null) return false;
    const importBinding = getImportBindingForName(node, rootName);
    return (
      importBinding !== null &&
      importBinding.isNamespace &&
      importBinding.source === REACT_NATIVE_MODULE
    );
  }

  const requireSource = getRequireCallSource(callee.object);
  if (requireSource === REACT_NATIVE_MODULE) {
    return (
      isNodeOfType(callee.object, "MemberExpression") &&
      !callee.object.computed &&
      isNodeOfType(callee.object.property, "Identifier") &&
      callee.object.property.name === "Dimensions"
    );
  }

  return false;
};

// Theme-aware stylesheet factories (`makeStyles`, `createStyles`,
// `createUseStyles`) evaluate their callback once and cache the result, so a
// Dimensions.get() inside one behaves like a module-level static style
// constant — the doc's explicit false-positive carve-out.
const STYLE_FACTORY_CALLEE_PATTERN = /(?:^|\.)(?:make|create)(?:Use)?Styles$/;

const isInsideStyleFactoryCallback = (node: EsTreeNode): boolean => {
  const enclosingFunction = findEnclosingFunction(node);
  if (!enclosingFunction) return false;
  const callExpression = enclosingFunction.parent;
  if (!callExpression || !isNodeOfType(callExpression, "CallExpression")) return false;
  if (!callExpression.arguments?.some((argument) => argument === enclosingFunction)) return false;
  const calleeName = flattenCalleeName(callExpression.callee);
  return calleeName !== null && STYLE_FACTORY_CALLEE_PATTERN.test(calleeName);
};

export const rnNoDimensionsGet = defineRule({
  id: "rn-no-dimensions-get",
  title: "Dimensions.get over useWindowDimensions",
  tags: ["test-noise"],
  requires: ["react-native"],
  severity: "warn",
  recommendation:
    "Use `const { width, height } = useWindowDimensions()` so the size updates automatically on rotation and resize.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isReactNativeDimensionsCallee(node, node.callee)) return;

      if (isMemberProperty(node.callee, "get")) {
        // One-shot module-level reads (static style constants) are the doc's
        // FP carve-out; the staleness claim only holds inside code that runs
        // per render. `addEventListener` below stays unguarded — the removed
        // API crashes regardless of where it's called.
        if (!isInsideFunctionScope(node)) return;
        if (isInsideStyleFactoryCallback(node)) return;
        context.report({
          node,
          message:
            "Dimensions.get() reads the size once and never updates, so layouts built from it go stale on rotation or resize.",
        });
      }

      if (isMemberProperty(node.callee, "addEventListener")) {
        context.report({
          node,
          message:
            "Your users hit a crash from Dimensions.addEventListener(), which was removed in React Native 0.72.",
        });
      }
    },
  }),
});
