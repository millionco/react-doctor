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

const COMPONENT_WRAPPER_CALLEE_NAMES = new Set(["memo", "forwardRef"]);

const resolveCalleeName = (callee: EsTreeNode): string | null => {
  if (isNodeOfType(callee, "Identifier")) return callee.name;
  if (isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")) {
    return callee.property.name;
  }
  return null;
};

// Peels `memo(...)` / `forwardRef(...)` / `React.memo(React.forwardRef(...))`
// down to the render function so those wrapped components are analyzed too.
const unwrapComponentDefinition = (node: EsTreeNode): EsTreeNode => {
  let current = stripParenExpression(node);
  while (isNodeOfType(current, "CallExpression")) {
    const calleeName = resolveCalleeName(current.callee);
    const firstArgument = current.arguments?.[0];
    if (!calleeName || !COMPONENT_WRAPPER_CALLEE_NAMES.has(calleeName) || !firstArgument) break;
    current = stripParenExpression(firstArgument);
  }
  return current;
};

// The local identifier the component's children are bound to: `children` for
// `({ children })` and props-object params, or the rename in
// `({ children: content })`.
const resolveChildrenLocalName = (functionNode: FunctionNode): string => {
  const firstParam = functionNode.params?.[0];
  if (!firstParam || !isNodeOfType(firstParam, "ObjectPattern")) return "children";
  for (const property of firstParam.properties ?? []) {
    if (!isNodeOfType(property, "Property")) continue;
    if (!isNodeOfType(property.key, "Identifier") || property.key.name !== "children") continue;
    const value = property.value;
    if (isNodeOfType(value, "Identifier")) return value.name;
    if (isNodeOfType(value, "AssignmentPattern") && isNodeOfType(value.left, "Identifier")) {
      return value.left.name;
    }
  }
  return "children";
};

// Collects the JSX roots a value can evaluate to, looking through parentheses,
// ternaries, and `&&` / `||` / `??` chains — e.g. both branches of
// `isLoading ? <Spinner /> : <View><Text>{children}</Text></View>`.
const collectJsxRootsFromExpression = (expression: EsTreeNode, roots: EsTreeNode[]): void => {
  const value = stripParenExpression(expression);
  if (isNodeOfType(value, "JSXElement") || isNodeOfType(value, "JSXFragment")) {
    roots.push(value);
    return;
  }
  if (isNodeOfType(value, "ConditionalExpression")) {
    if (value.consequent) collectJsxRootsFromExpression(value.consequent, roots);
    if (value.alternate) collectJsxRootsFromExpression(value.alternate, roots);
    return;
  }
  if (isNodeOfType(value, "LogicalExpression")) {
    if (value.left) collectJsxRootsFromExpression(value.left, roots);
    if (value.right) collectJsxRootsFromExpression(value.right, roots);
  }
};

// Resolves the JSX roots a component can return: the expression body, or the
// arguments of `ReturnStatement`s anywhere in the body (so early returns and
// returns inside `if` branches are seen).
const collectReturnedJsxRoots = (functionNode: FunctionNode): EsTreeNode[] => {
  const roots: EsTreeNode[] = [];
  const { body } = functionNode;
  if (!body) return roots;

  if (!isNodeOfType(body, "BlockStatement")) {
    collectJsxRootsFromExpression(body, roots);
    return roots;
  }

  walkAst(body, (node) => {
    if (isFunctionNode(node) && node !== functionNode) return false;
    if (isNodeOfType(node, "ReturnStatement") && node.argument) {
      collectJsxRootsFromExpression(node.argument, roots);
      return false;
    }
    return undefined;
  });
  return roots;
};

const isChildrenForwardingExpression = (
  expression: EsTreeNode | null | undefined,
  childrenLocalName: string,
): boolean => {
  if (!expression) return false;
  if (isNodeOfType(expression, "Identifier")) return expression.name === childrenLocalName;
  return (
    isNodeOfType(expression, "MemberExpression") &&
    isNodeOfType(expression.property, "Identifier") &&
    expression.property.name === "children"
  );
};

const isChildrenForwardingJsxChild = (child: EsTreeNode, childrenLocalName: string): boolean =>
  isNodeOfType(child, "JSXExpressionContainer") &&
  isChildrenForwardingExpression(child.expression, childrenLocalName);

const isChildrenForwardingAttribute = (attribute: EsTreeNode, childrenLocalName: string): boolean =>
  isNodeOfType(attribute, "JSXAttribute") &&
  isNodeOfType(attribute.name, "JSXIdentifier") &&
  attribute.name.name === "children" &&
  isNodeOfType(attribute.value, "JSXExpressionContainer") &&
  isChildrenForwardingExpression(attribute.value.expression, childrenLocalName);

// True when somewhere in the returned JSX a text-handling element directly
// receives the component's children — `<View><Text>{children}</Text></View>`,
// `<Text>{props.children}</Text>`, or `<Text children={children} />` — where
// the wrapper's raw string children still land inside a `<Text>` even though
// the root element isn't one.
const jsxRootForwardsChildrenIntoText = (
  jsxRoot: EsTreeNode,
  childrenLocalName: string,
  isTextHandlingElement: (elementName: string) => boolean,
): boolean => {
  let didForwardIntoText = false;
  walkAst(jsxRoot, (node) => {
    if (didForwardIntoText || isFunctionNode(node)) return false;
    if (!isNodeOfType(node, "JSXElement")) return undefined;
    const elementName = resolveJsxElementName(node.openingElement);
    if (!elementName || !isTextHandlingElement(elementName)) return;
    didForwardIntoText =
      (node.children ?? []).some((child) =>
        isChildrenForwardingJsxChild(child, childrenLocalName),
      ) ||
      (node.openingElement.attributes ?? []).some((attribute) =>
        isChildrenForwardingAttribute(attribute, childrenLocalName),
      );
  });
  return didForwardIntoText;
};

// Records a component declaration when its name is PascalCase and it forwards
// its children into a text-handling element — either a returned root that is
// itself text-handling (`const Label = (...) => <Text>…</Text>`) or a nested
// `<Text>{children}</Text>` inside any returned markup.
const recordWrapperFromDeclaration = (
  componentName: string | null,
  definitionNode: EsTreeNode | null | undefined,
  isTextHandlingElement: (elementName: string) => boolean,
  wrappers: Set<string>,
): void => {
  if (!componentName || !isReactComponentName(componentName)) return;
  if (wrappers.has(componentName)) return;
  if (!definitionNode) return;
  const functionNode = unwrapComponentDefinition(definitionNode);
  if (!isFunctionNode(functionNode)) return;
  const childrenLocalName = resolveChildrenLocalName(functionNode);
  for (const jsxRoot of collectReturnedJsxRoots(functionNode)) {
    if (isNodeOfType(jsxRoot, "JSXElement")) {
      const rootName = resolveJsxElementName(jsxRoot.openingElement);
      if (rootName && isTextHandlingElement(rootName)) {
        wrappers.add(componentName);
        return;
      }
    }
    if (jsxRootForwardsChildrenIntoText(jsxRoot, childrenLocalName, isTextHandlingElement)) {
      wrappers.add(componentName);
      return;
    }
  }
};

const MAX_TRANSITIVE_WRAPPER_PASSES = 3;

// Walks a program and returns the names of in-file components that forward
// their children into a text-handling element. These behave like configured
// `rawTextWrapperComponents`: raw text inside them is safe only when the
// children are string-only (mixed children still get reported), since the
// wrapper is assumed to forward `children` into a single `<Text>`. Repeats the
// walk a bounded number of times so wrappers-of-wrappers
// (`const Badge = ({ children }) => <Chip>{children}</Chip>`) are detected.
export const collectTextWrapperComponents = (
  programNode: EsTreeNode,
  isTextHandlingRoot: (elementName: string) => boolean,
): ReadonlySet<string> => {
  const wrappers = new Set<string>();
  const isTextHandlingElement = (elementName: string): boolean =>
    isTextHandlingRoot(elementName) || wrappers.has(elementName);

  for (let pass = 0; pass < MAX_TRANSITIVE_WRAPPER_PASSES; pass += 1) {
    const sizeBeforePass = wrappers.size;
    walkAst(programNode, (node) => {
      if (isNodeOfType(node, "VariableDeclarator")) {
        const componentName = node.id && isNodeOfType(node.id, "Identifier") ? node.id.name : null;
        recordWrapperFromDeclaration(componentName, node.init, isTextHandlingElement, wrappers);
      } else if (isNodeOfType(node, "FunctionDeclaration")) {
        const componentName = node.id && isNodeOfType(node.id, "Identifier") ? node.id.name : null;
        recordWrapperFromDeclaration(componentName, node, isTextHandlingElement, wrappers);
      }
    });
    if (wrappers.size === sizeBeforePass) break;
  }

  return wrappers;
};
