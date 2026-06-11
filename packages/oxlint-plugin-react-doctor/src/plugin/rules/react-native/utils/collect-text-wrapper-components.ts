import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactComponentName } from "../../../utils/is-react-component-name.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { resolveJsxElementName } from "./resolve-jsx-element-name.js";

type FunctionNode =
  | EsTreeNodeOfType<"ArrowFunctionExpression">
  | EsTreeNodeOfType<"FunctionExpression">
  | EsTreeNodeOfType<"FunctionDeclaration">;

const isFunctionNode = (node: EsTreeNode): node is FunctionNode =>
  isNodeOfType(node, "ArrowFunctionExpression") ||
  isNodeOfType(node, "FunctionExpression") ||
  isNodeOfType(node, "FunctionDeclaration");

// Resolves the single JSX element a component returns at the top level of its
// body, or `null` when the component returns a fragment, conditional markup,
// or no JSX. We deliberately stay shallow (expression body, or a
// `ReturnStatement` at the block's top level) to keep detection high-confidence.
const resolveReturnedRootElement = (
  functionNode: FunctionNode,
): EsTreeNodeOfType<"JSXElement"> | null => {
  const { body } = functionNode;
  if (!body) return null;

  if (!isNodeOfType(body, "BlockStatement")) {
    const expressionBody = stripParenExpression(body);
    return isNodeOfType(expressionBody, "JSXElement") ? expressionBody : null;
  }

  for (const statement of body.body) {
    if (!isNodeOfType(statement, "ReturnStatement")) continue;
    if (!statement.argument) continue;
    const argument = stripParenExpression(statement.argument);
    if (isNodeOfType(argument, "JSXElement")) return argument;
  }
  return null;
};

const isChildrenForwardingExpression = (child: EsTreeNode): boolean => {
  if (!isNodeOfType(child, "JSXExpressionContainer") || !child.expression) return false;
  const expression = child.expression;
  if (isNodeOfType(expression, "Identifier")) return expression.name === "children";
  return (
    isNodeOfType(expression, "MemberExpression") &&
    isNodeOfType(expression.property, "Identifier") &&
    expression.property.name === "children"
  );
};

// True when somewhere in the returned JSX a text-handling element directly
// receives `{children}` (or `{props.children}`) — the `<View><Text>{children}
// </Text></View>` shape, where the wrapper's raw string children still land
// inside a `<Text>` even though the root element isn't one.
const elementForwardsChildrenIntoText = (
  rootElement: EsTreeNodeOfType<"JSXElement">,
  isTextHandlingRoot: (elementName: string) => boolean,
): boolean => {
  let didForwardIntoText = false;
  walkAst(rootElement, (node) => {
    if (didForwardIntoText || !isNodeOfType(node, "JSXElement")) return;
    const elementName = resolveJsxElementName(node.openingElement);
    if (!elementName || !isTextHandlingRoot(elementName)) return;
    didForwardIntoText = (node.children ?? []).some(isChildrenForwardingExpression);
  });
  return didForwardIntoText;
};

// Records a component declaration when its name is PascalCase and it forwards
// its children into a text-handling element — either the returned root itself
// (`const Label = (...) => <Text>…</Text>`) or a nested `<Text>{children}</Text>`
// inside the returned markup. Both variable declarators and function
// declarations are covered.
const recordWrapperFromDeclaration = (
  componentName: string | null,
  functionNode: EsTreeNode | null | undefined,
  isTextHandlingRoot: (elementName: string) => boolean,
  wrappers: Set<string>,
): void => {
  if (!componentName || !isReactComponentName(componentName)) return;
  if (!functionNode || !isFunctionNode(functionNode)) return;
  const rootElement = resolveReturnedRootElement(functionNode);
  if (!rootElement) return;
  const rootName = resolveJsxElementName(rootElement.openingElement);
  if (rootName && isTextHandlingRoot(rootName)) {
    wrappers.add(componentName);
    return;
  }
  if (elementForwardsChildrenIntoText(rootElement, isTextHandlingRoot)) {
    wrappers.add(componentName);
  }
};

// Walks a program once and returns the names of in-file components that
// forward their children into a text-handling element. These behave like
// configured `rawTextWrapperComponents`: raw text inside them is safe only when
// the children are string-only (mixed children still get reported), since the
// wrapper is assumed to forward `children` into a single `<Text>`.
export const collectTextWrapperComponents = (
  programNode: EsTreeNode,
  isTextHandlingRoot: (elementName: string) => boolean,
): ReadonlySet<string> => {
  const wrappers = new Set<string>();

  walkAst(programNode, (node) => {
    if (isNodeOfType(node, "VariableDeclarator")) {
      const componentName = node.id && isNodeOfType(node.id, "Identifier") ? node.id.name : null;
      recordWrapperFromDeclaration(componentName, node.init, isTextHandlingRoot, wrappers);
    } else if (isNodeOfType(node, "FunctionDeclaration")) {
      const componentName = node.id && isNodeOfType(node.id, "Identifier") ? node.id.name : null;
      recordWrapperFromDeclaration(componentName, node, isTextHandlingRoot, wrappers);
    }
  });

  return wrappers;
};
