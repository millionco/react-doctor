import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { getImportBindingForName } from "./find-import-source-for-name.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isTestLibraryImportSource } from "./is-test-library-import-source.js";
import { isNodeOfType } from "./is-node-of-type.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const TEST_CALLBACK_EXPORT_NAMES: ReadonlySet<string> = new Set(["it", "test"]);
const TEST_CALLBACK_MEMBER_NAMES: ReadonlySet<string> = new Set(["concurrent", "only", "skip"]);
const TEST_CALLBACK_TABLE_MEMBER_NAME = "each";
const TEST_MOCK_METHOD_NAMES: ReadonlySet<string> = new Set([
  "doMock",
  "mock",
  "unstable_mockModule",
]);
const TEST_RUNTIME_EXPORT_NAMES: ReadonlySet<string> = new Set(["jest", "vi"]);
const TEST_RUNTIME_MODULE_SOURCES: ReadonlySet<string> = new Set([
  "@jest/globals",
  "bun:test",
  "node:test",
  "vitest",
]);
const REACT_MODULE_SOURCES: ReadonlySet<string> = new Set([
  "react",
  "react/jsx-dev-runtime",
  "react/jsx-runtime",
]);

const hasUnitTestFilename = (rawFilename: string | undefined): boolean => {
  if (!rawFilename) return false;
  const filename = `/${rawFilename.replaceAll("\\", "/")}`;
  const basename = filename.slice(filename.lastIndexOf("/") + 1);
  return (
    basename.includes(".test.") ||
    basename.includes(".spec.") ||
    filename.includes("/__tests__/") ||
    filename.includes("/__test__/") ||
    filename.includes("/__mocks__/")
  );
};

const isExactImportedBinding = (
  identifier: EsTreeNodeOfType<"Identifier">,
  expectedExportNames: ReadonlySet<string>,
  context: RuleContext,
): boolean => {
  const reference = context.scopes.referenceFor(identifier);
  if (reference?.resolvedSymbol?.kind !== "import") return false;
  const importBinding = getImportBindingForName(identifier, identifier.name);
  return Boolean(
    importBinding &&
    TEST_RUNTIME_MODULE_SOURCES.has(importBinding.source) &&
    importBinding.exportedName &&
    expectedExportNames.has(importBinding.exportedName),
  );
};

const isRecognizedTestGlobal = (
  identifier: EsTreeNodeOfType<"Identifier">,
  expectedNames: ReadonlySet<string>,
  context: RuleContext,
): boolean =>
  hasUnitTestFilename(context.filename) &&
  expectedNames.has(identifier.name) &&
  context.scopes.isGlobalReference(identifier);

const isRecognizedTestBinding = (
  identifier: EsTreeNodeOfType<"Identifier">,
  expectedNames: ReadonlySet<string>,
  context: RuleContext,
): boolean =>
  isExactImportedBinding(identifier, expectedNames, context) ||
  isRecognizedTestGlobal(identifier, expectedNames, context);

const getTestCallbackBaseIdentifier = (
  callee: EsTreeNode,
): EsTreeNodeOfType<"Identifier"> | null => {
  const unwrappedCallee = stripParenExpression(callee);
  if (isNodeOfType(unwrappedCallee, "Identifier")) return unwrappedCallee;
  if (isNodeOfType(unwrappedCallee, "MemberExpression")) {
    const memberName = getStaticPropertyName(unwrappedCallee);
    if (!memberName || !TEST_CALLBACK_MEMBER_NAMES.has(memberName)) return null;
    return getTestCallbackBaseIdentifier(unwrappedCallee.object);
  }
  const tableBuilderCallee = isNodeOfType(unwrappedCallee, "CallExpression")
    ? stripParenExpression(unwrappedCallee.callee)
    : isNodeOfType(unwrappedCallee, "TaggedTemplateExpression")
      ? stripParenExpression(unwrappedCallee.tag)
      : null;
  if (!isNodeOfType(tableBuilderCallee, "MemberExpression")) return null;
  if (getStaticPropertyName(tableBuilderCallee) !== TEST_CALLBACK_TABLE_MEMBER_NAME) return null;
  return getTestCallbackBaseIdentifier(tableBuilderCallee.object);
};

const isDirectTestCallback = (functionNode: EsTreeNode, context: RuleContext): boolean => {
  const callbackRoot = findTransparentExpressionRoot(functionNode);
  const callExpression = callbackRoot.parent;
  if (!callExpression || !isNodeOfType(callExpression, "CallExpression")) return false;
  if (!callExpression.arguments.some((argument) => argument === callbackRoot)) return false;
  const baseIdentifier = getTestCallbackBaseIdentifier(callExpression.callee);
  return Boolean(
    baseIdentifier && isRecognizedTestBinding(baseIdentifier, TEST_CALLBACK_EXPORT_NAMES, context),
  );
};

const isRecognizedMockFactoryCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  factoryRoot: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (callExpression.arguments[1] !== factoryRoot) return false;
  const moduleSpecifier = callExpression.arguments[0];
  if (!moduleSpecifier || !isNodeOfType(moduleSpecifier, "Literal")) return false;
  if (typeof moduleSpecifier.value !== "string") return false;
  const callee = stripParenExpression(callExpression.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const methodName = getStaticPropertyName(callee);
  if (!methodName || !TEST_MOCK_METHOD_NAMES.has(methodName)) return false;
  const receiver = stripParenExpression(callee.object);
  return (
    isNodeOfType(receiver, "Identifier") &&
    isRecognizedTestBinding(receiver, TEST_RUNTIME_EXPORT_NAMES, context)
  );
};

const isInsideRecognizedMockFactory = (node: EsTreeNode, context: RuleContext): boolean => {
  let current: EsTreeNode | null | undefined = node.parent;
  while (current) {
    if (isFunctionLike(current)) {
      const factoryRoot = findTransparentExpressionRoot(current);
      const callExpression = factoryRoot.parent;
      if (
        callExpression &&
        isNodeOfType(callExpression, "CallExpression") &&
        isRecognizedMockFactoryCall(callExpression, factoryRoot, context)
      ) {
        return true;
      }
    }
    current = current.parent;
  }
  return false;
};

const hasImportedProductComponentAttributeAncestor = (
  node: EsTreeNode,
  enclosingFunction: EsTreeNode,
  context: RuleContext,
): boolean => {
  let current: EsTreeNode | null | undefined = node.parent;
  let attributeAncestor: EsTreeNodeOfType<"JSXAttribute"> | null = null;
  if (current && isNodeOfType(current, "JSXElement") && current.openingElement === node) {
    current = current.parent;
  }
  while (current && current !== enclosingFunction) {
    if (isFunctionLike(current)) return false;
    if (isNodeOfType(current, "JSXAttribute")) {
      attributeAncestor = current;
    }
    if (isNodeOfType(current, "JSXElement")) {
      const componentName = current.openingElement.name;
      if (isNodeOfType(componentName, "JSXIdentifier")) {
        const reference = context.scopes.referenceFor(componentName);
        const importBinding = getImportBindingForName(componentName, componentName.name);
        if (
          reference?.resolvedSymbol?.kind === "import" &&
          importBinding &&
          !REACT_MODULE_SOURCES.has(importBinding.source) &&
          !isTestLibraryImportSource(importBinding.source) &&
          attributeAncestor?.parent === current.openingElement &&
          isNodeOfType(attributeAncestor.name, "JSXIdentifier") &&
          attributeAncestor.name.name !== "children"
        ) {
          return true;
        }
      }
      attributeAncestor = null;
    }
    current = current.parent;
  }
  return false;
};

export const isLocalTestScaffoldJsx = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): boolean => {
  if (isInsideRecognizedMockFactory(node, context)) return true;
  const enclosingFunction = findEnclosingFunction(node);
  if (!enclosingFunction || !isDirectTestCallback(enclosingFunction, context)) return false;
  return hasImportedProductComponentAttributeAncestor(node, enclosingFunction, context);
};
