import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { getImportBindingForName } from "./find-import-source-for-name.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isFunctionLike } from "./is-function-like.js";
import { isTestLibraryImportSource } from "./is-test-library-import-source.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "./is-proven-unmodified-global-namespace-reference.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

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

const getJestRegistration = (
  callback: EsTreeNode,
  name: string,
  context: RuleContext,
): EsTreeNodeOfType<"CallExpression"> | null => {
  const call = callback.parent;
  if (!isNodeOfType(call, "CallExpression") || call.optional || call.arguments[1] !== callback) {
    return null;
  }
  const [title] = call.arguments;
  return isNodeOfType(title, "Literal") &&
    typeof title.value === "string" &&
    isNodeOfType(call.callee, "Identifier") &&
    call.callee.name === name &&
    isProvenUnmodifiedGlobalNamespaceReference(call.callee, name, context.scopes, undefined, true)
    ? call
    : null;
};

const isRenderedInJestCallback = (reference: EsTreeNode, context: RuleContext): boolean => {
  const opening = reference.parent;
  if (
    !isNodeOfType(opening, "JSXOpeningElement") ||
    opening.name !== reference ||
    !opening.selfClosing ||
    !isNodeOfType(opening.parent, "JSXElement")
  ) {
    return false;
  }
  const element = opening.parent;
  const renderCall = element.parent;
  if (
    !isNodeOfType(renderCall, "CallExpression") ||
    renderCall.optional ||
    renderCall.arguments[0] !== element ||
    !isNodeOfType(renderCall.callee, "Identifier") ||
    context.scopes.symbolFor(renderCall.callee)?.kind !== "import"
  ) {
    return false;
  }
  const imported = resolveImportedApiReference(renderCall.callee, context.scopes);
  if (imported?.source !== "@testing-library/react" || imported.importedName !== "render") {
    return false;
  }
  const testCallback = findEnclosingFunction(renderCall);
  const testRegistration = testCallback && getJestRegistration(testCallback, "test", context);
  const suiteCallback = testRegistration && findEnclosingFunction(testRegistration);
  const suiteRegistration =
    suiteCallback && getJestRegistration(suiteCallback, "describe", context);
  const suiteStatement = suiteRegistration?.parent;
  return (
    isNodeOfType(suiteStatement, "ExpressionStatement") &&
    isNodeOfType(suiteStatement.parent, "Program")
  );
};

const evalUsageByProgram = new WeakMap<EsTreeNode, boolean>();

export const isLocalJestRenderComponent = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): boolean => {
  const filename = context.filename?.replaceAll("\\", "/");
  if (!filename || !/(?:^|\/)unittest\/.+-spec\.tsx?$/.test(filename)) return false;
  const owner = findEnclosingFunction(node);
  if (!isNodeOfType(owner, "ArrowFunctionExpression")) return false;
  const declarator = owner.parent;
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    !isNodeOfType(declarator.id, "Identifier") ||
    !isNodeOfType(declarator.parent, "VariableDeclaration") ||
    !isNodeOfType(declarator.parent.parent, "Program") ||
    declarator.parent.parent.sourceType !== "module"
  ) {
    return false;
  }
  const symbol = context.scopes.symbolFor(declarator.id);
  const program = declarator.parent.parent;
  if (
    !symbol ||
    getDirectConstInitializer(symbol) !== owner ||
    symbol.references.length === 0 ||
    !hasCompleteSymbolReferences(symbol, program, context.scopes) ||
    !symbol.references.every(
      (reference) =>
        reference.flag === "read" && isRenderedInJestCallback(reference.identifier, context),
    )
  ) {
    return false;
  }
  const cachedEval = evalUsageByProgram.get(program);
  if (cachedEval !== undefined) return !cachedEval;
  let hasEval = false;
  walkAst(program, (candidate) => {
    if (hasEval) return false;
    if (
      isNodeOfType(candidate, "Identifier") &&
      candidate.name === "eval" &&
      context.scopes.isGlobalReference(candidate)
    ) {
      hasEval = true;
      return false;
    }
  });
  evalUsageByProgram.set(program, hasEval);
  return !hasEval;
};
