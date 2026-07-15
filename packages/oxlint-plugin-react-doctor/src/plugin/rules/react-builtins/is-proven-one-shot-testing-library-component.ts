import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isJsxElementOrFragment } from "../../utils/is-jsx-element-or-fragment.js";
import {
  isImportedFromReact,
  isReactApiCall,
  isReactNamespaceImport,
} from "../../utils/is-react-api-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const REACT_TESTING_LIBRARY_MODULE_SOURCE = "@testing-library/react";
const REACT_TESTING_LIBRARY_MODULE_SOURCES: ReadonlySet<string> = new Set([
  REACT_TESTING_LIBRARY_MODULE_SOURCE,
]);
const TEST_CALLBACK_NAMES: ReadonlySet<string> = new Set(["it", "test"]);
const TEST_RUNNER_MODULE_SOURCES: ReadonlySet<string> = new Set(["@jest/globals", "vitest"]);

const isNamedImportFromModule = (
  symbol: SymbolDescriptor | null,
  importedName: string,
  moduleSources: ReadonlySet<string>,
): boolean => {
  if (
    !symbol ||
    symbol.kind !== "import" ||
    !isNodeOfType(symbol.declarationNode, "ImportSpecifier") ||
    getImportedName(symbol.declarationNode) !== importedName
  ) {
    return false;
  }
  const importDeclaration = symbol.declarationNode.parent;
  return Boolean(
    importDeclaration &&
    isNodeOfType(importDeclaration, "ImportDeclaration") &&
    typeof importDeclaration.source.value === "string" &&
    moduleSources.has(importDeclaration.source.value),
  );
};

const isNamespaceImportFromModule = (
  symbol: SymbolDescriptor | null,
  moduleSource: string,
): boolean => {
  if (
    !symbol ||
    symbol.kind !== "import" ||
    !isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier")
  ) {
    return false;
  }
  const importDeclaration = symbol.declarationNode.parent;
  return Boolean(
    importDeclaration &&
    isNodeOfType(importDeclaration, "ImportDeclaration") &&
    importDeclaration.source.value === moduleSource,
  );
};

const isProvenTestCallback = (functionNode: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const callExpression = functionNode.parent;
  if (
    !callExpression ||
    !isNodeOfType(callExpression, "CallExpression") ||
    callExpression.arguments[1] !== functionNode
  ) {
    return false;
  }
  const callee = stripParenExpression(callExpression.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  if (TEST_CALLBACK_NAMES.has(callee.name) && scopes.isGlobalReference(callee)) return true;
  const symbol = scopes.symbolFor(callee);
  if (!symbol || symbol.kind !== "import") return false;
  const importedName = getImportedName(symbol.declarationNode);
  return Boolean(
    importedName &&
    TEST_CALLBACK_NAMES.has(importedName) &&
    isNamedImportFromModule(symbol, importedName, TEST_RUNNER_MODULE_SOURCES),
  );
};

const getDirectConstComponentSymbol = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  const declarator = functionNode.parent;
  if (
    !declarator ||
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.init !== functionNode ||
    !isNodeOfType(declarator.id, "Identifier")
  ) {
    return null;
  }
  const declaration = declarator.parent;
  if (
    !declaration ||
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    declaration.declarations.length !== 1
  ) {
    return null;
  }
  const testCallback = findEnclosingFunction(declarator);
  if (
    !testCallback ||
    !isFunctionLike(testCallback) ||
    !isProvenTestCallback(testCallback, scopes) ||
    !isNodeOfType(testCallback.body, "BlockStatement") ||
    declaration.parent !== testCallback.body
  ) {
    return null;
  }
  return scopes.symbolFor(declarator.id);
};

const isCreateRefDeclaration = (statement: EsTreeNode, scopes: ScopeAnalysis): boolean =>
  isNodeOfType(statement, "VariableDeclaration") &&
  statement.kind === "const" &&
  statement.declarations.length > 0 &&
  statement.declarations.every((declarator) => {
    const initializer = declarator.init ? stripParenExpression(declarator.init) : null;
    return Boolean(
      isNodeOfType(declarator.id, "Identifier") &&
      initializer &&
      isNodeOfType(initializer, "CallExpression") &&
      isReactApiCall(initializer, "createRef", scopes, {
        allowGlobalReactNamespace: true,
        allowUnboundBareCalls: true,
        resolveNamedAliases: true,
      }),
    );
  });

const isSafeReturnedJsx = (returnStatement: EsTreeNode): boolean => {
  if (!isNodeOfType(returnStatement, "ReturnStatement") || !returnStatement.argument) {
    return false;
  }
  const returnedExpression = stripParenExpression(returnStatement.argument);
  if (!isJsxElementOrFragment(returnedExpression)) return false;
  let isSafe = true;
  walkAst(returnedExpression, (node) => {
    if (isFunctionLike(node)) {
      isSafe = false;
      return false;
    }
    if (
      isNodeOfType(node, "AssignmentExpression") ||
      isNodeOfType(node, "AwaitExpression") ||
      isNodeOfType(node, "CallExpression") ||
      isNodeOfType(node, "NewExpression") ||
      isNodeOfType(node, "TaggedTemplateExpression") ||
      isNodeOfType(node, "UpdateExpression") ||
      isNodeOfType(node, "YieldExpression")
    ) {
      isSafe = false;
      return false;
    }
  });
  return isSafe;
};

const hasProvenOneShotComponentBody = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isFunctionLike(functionNode) || !isNodeOfType(functionNode.body, "BlockStatement")) {
    return false;
  }
  if (!functionNode.params.every((parameter) => isNodeOfType(parameter, "Identifier"))) {
    return false;
  }
  const statements = functionNode.body.body;
  if (statements.length < 2) return false;
  const returnStatement = statements.at(-1);
  return Boolean(
    returnStatement &&
    statements.slice(0, -1).every((statement) => isCreateRefDeclaration(statement, scopes)) &&
    isSafeReturnedJsx(returnStatement),
  );
};

const isProvenReactStrictModeElement = (
  jsxElement: EsTreeNodeOfType<"JSXElement">,
  scopes: ScopeAnalysis,
): boolean => {
  const elementName = jsxElement.openingElement.name;
  if (isNodeOfType(elementName, "JSXIdentifier")) {
    const symbol = scopes.symbolFor(elementName);
    return Boolean(
      symbol &&
      isImportedFromReact(symbol) &&
      getImportedName(symbol.declarationNode) === "StrictMode",
    );
  }
  return Boolean(
    isNodeOfType(elementName, "JSXMemberExpression") &&
    isNodeOfType(elementName.object, "JSXIdentifier") &&
    elementName.property.name === "StrictMode" &&
    isReactNamespaceImport(elementName.object, scopes),
  );
};

const isWhitespaceJsxChild = (node: EsTreeNode): boolean =>
  (isNodeOfType(node, "JSXText") && node.value.trim().length === 0) ||
  (isNodeOfType(node, "JSXExpressionContainer") &&
    isNodeOfType(node.expression, "JSXEmptyExpression"));

const getRootElementForComponentReference = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNodeOfType<"JSXElement"> | null => {
  const openingElement = identifier.parent;
  if (
    !openingElement ||
    !isNodeOfType(openingElement, "JSXOpeningElement") ||
    openingElement.name !== identifier ||
    !openingElement.selfClosing ||
    openingElement.attributes.length !== 0
  ) {
    return null;
  }
  const componentElement = openingElement.parent;
  if (!componentElement || !isNodeOfType(componentElement, "JSXElement")) return null;
  const strictModeElement = componentElement.parent;
  if (!strictModeElement || !isNodeOfType(strictModeElement, "JSXElement")) {
    return componentElement;
  }
  if (
    strictModeElement.openingElement.attributes.length !== 0 ||
    !isProvenReactStrictModeElement(strictModeElement, scopes)
  ) {
    return null;
  }
  const renderedChildren = strictModeElement.children.filter(
    (child) => !isWhitespaceJsxChild(child),
  );
  return renderedChildren.length === 1 && renderedChildren[0] === componentElement
    ? strictModeElement
    : null;
};

const isProvenTestingLibraryRenderCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const callee = stripParenExpression(callExpression.callee);
  if (isNodeOfType(callee, "Identifier")) {
    return isNamedImportFromModule(
      scopes.symbolFor(callee),
      "render",
      REACT_TESTING_LIBRARY_MODULE_SOURCES,
    );
  }
  return Boolean(
    isNodeOfType(callee, "MemberExpression") &&
    getStaticPropertyName(callee) === "render" &&
    isNodeOfType(callee.object, "Identifier") &&
    isNamespaceImportFromModule(
      scopes.symbolFor(callee.object),
      REACT_TESTING_LIBRARY_MODULE_SOURCE,
    ),
  );
};

const isSafeRenderResultBinding = (pattern: EsTreeNode): boolean => {
  if (!isNodeOfType(pattern, "ObjectPattern")) return false;
  return pattern.properties.every((property) => {
    if (!isNodeOfType(property, "Property") || property.computed) return false;
    return (
      isNodeOfType(property.value, "Identifier") &&
      getStaticPropertyKeyName(property) !== "rerender"
    );
  });
};

const isDirectSafeRenderStatement = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  testCallback: EsTreeNode,
): boolean => {
  if (!isFunctionLike(testCallback) || !isNodeOfType(testCallback.body, "BlockStatement")) {
    return false;
  }
  const expression = findTransparentExpressionRoot(callExpression);
  const parent = expression.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "ExpressionStatement")) {
    return parent.parent === testCallback.body;
  }
  if (
    !isNodeOfType(parent, "VariableDeclarator") ||
    parent.init !== expression ||
    !isSafeRenderResultBinding(parent.id)
  ) {
    return false;
  }
  const declaration = parent.parent;
  return Boolean(
    declaration &&
    isNodeOfType(declaration, "VariableDeclaration") &&
    declaration.declarations.length === 1 &&
    declaration.parent === testCallback.body,
  );
};

const getProvenIndependentRenderCall = (
  componentReference: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNodeOfType<"CallExpression"> | null => {
  const rootElement = getRootElementForComponentReference(componentReference, scopes);
  if (!rootElement) return null;
  const renderedArgument = findTransparentExpressionRoot(rootElement);
  const callExpression = renderedArgument.parent;
  if (
    !callExpression ||
    !isNodeOfType(callExpression, "CallExpression") ||
    callExpression.arguments.length !== 1 ||
    callExpression.arguments[0] !== renderedArgument ||
    !isProvenTestingLibraryRenderCall(callExpression, scopes)
  ) {
    return null;
  }
  return callExpression;
};

export const isProvenOneShotTestingLibraryComponent = (
  functionNode: EsTreeNode,
  filename: string | undefined,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !filename ||
    !isTestlikeFilename(filename) ||
    !hasProvenOneShotComponentBody(functionNode, scopes)
  ) {
    return false;
  }
  const componentSymbol = getDirectConstComponentSymbol(functionNode, scopes);
  if (!componentSymbol || componentSymbol.references.length === 0) return false;
  const testCallback = findEnclosingFunction(componentSymbol.bindingIdentifier);
  if (!testCallback) return false;
  const renderCalls = new Set<EsTreeNodeOfType<"CallExpression">>();
  for (const reference of componentSymbol.references) {
    if (reference.flag !== "read") return false;
    const renderCall = getProvenIndependentRenderCall(reference.identifier, scopes);
    if (
      !renderCall ||
      findEnclosingFunction(renderCall) !== testCallback ||
      !isDirectSafeRenderStatement(renderCall, testCallback)
    ) {
      return false;
    }
    renderCalls.add(renderCall);
  }
  return renderCalls.size > 0;
};
