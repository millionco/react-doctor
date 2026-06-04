import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactComponentName } from "../../../utils/is-react-component-name.js";
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

// Resolves the tag name of the single JSX element a component returns at the
// top level of its body, or `null` when the component returns a fragment,
// conditional markup, or no JSX. Only the *root* element matters here: a
// wrapper like `({ children }) => <Text>{children}</Text>` forwards its
// children into that root, so the root's identity decides whether the wrapper
// is text-handling. We deliberately stay shallow (expression body, or a
// `ReturnStatement` at the block's top level) to keep detection high-confidence.
const resolveReturnedRootElementName = (functionNode: FunctionNode): string | null => {
  const { body } = functionNode;
  if (!body) return null;

  if (!isNodeOfType(body, "BlockStatement")) {
    return isNodeOfType(body, "JSXElement") ? resolveJsxElementName(body.openingElement) : null;
  }

  for (const statement of body.body) {
    if (!isNodeOfType(statement, "ReturnStatement")) continue;
    const argument = statement.argument;
    if (argument && isNodeOfType(argument, "JSXElement")) {
      return resolveJsxElementName(argument.openingElement);
    }
  }
  return null;
};

// Records a component declaration when its name is PascalCase and its returned
// root element is text-handling. Both `const Label = (...) => <Text>…</Text>`
// (variable declarator) and `function Label(...) { return <Text>…</Text> }`
// (declaration) are covered.
const recordWrapperFromDeclaration = (
  componentName: string | null,
  functionNode: EsTreeNode | null | undefined,
  isTextHandlingRoot: (elementName: string) => boolean,
  wrappers: Set<string>,
): void => {
  if (!componentName || !isReactComponentName(componentName)) return;
  if (!functionNode || !isFunctionNode(functionNode)) return;
  const rootName = resolveReturnedRootElementName(functionNode);
  if (rootName && isTextHandlingRoot(rootName)) wrappers.add(componentName);
};

// Walks a program once and returns the names of in-file components that
// forward their children into a text-handling root element. These behave like
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
