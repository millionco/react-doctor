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

interface ChildrenBindings {
  // Identifiers that hold the component's children (`children`, a destructure
  // rename, or a later alias like `const content = children`).
  childrenNames: Set<string>;
  // Identifiers whose `.children` (and whose spread) carries the component's
  // children — the props param or an object rest that still includes children.
  propsObjectNames: Set<string>;
}

const resolveChildrenPropertyLocalName = (property: EsTreeNode): string | null => {
  if (!isNodeOfType(property, "Property")) return null;
  if (!isNodeOfType(property.key, "Identifier") || property.key.name !== "children") return null;
  const value = property.value;
  if (isNodeOfType(value, "Identifier")) return value.name;
  if (isNodeOfType(value, "AssignmentPattern") && isNodeOfType(value.left, "Identifier")) {
    return value.left.name;
  }
  return null;
};

// The identifiers the component's children are bound to: `children` for
// `({ children })` and props-object params, the rename in
// `({ children: content })`, plus the props object itself (`props` or an
// object rest that still carries children).
const resolveParamChildrenBindings = (functionNode: FunctionNode): ChildrenBindings => {
  const bindings: ChildrenBindings = {
    childrenNames: new Set(),
    propsObjectNames: new Set(),
  };
  const firstParam = functionNode.params?.[0];
  if (!firstParam) return bindings;
  if (isNodeOfType(firstParam, "Identifier")) {
    bindings.propsObjectNames.add(firstParam.name);
    return bindings;
  }
  if (!isNodeOfType(firstParam, "ObjectPattern")) return bindings;
  let didDestructureChildren = false;
  let restName: string | null = null;
  for (const property of firstParam.properties ?? []) {
    if (isNodeOfType(property, "RestElement") && isNodeOfType(property.argument, "Identifier")) {
      restName = property.argument.name;
      continue;
    }
    const localName = resolveChildrenPropertyLocalName(property);
    if (localName) {
      didDestructureChildren = true;
      bindings.childrenNames.add(localName);
    }
  }
  if (restName && !didDestructureChildren) bindings.propsObjectNames.add(restName);
  return bindings;
};

const MAX_CHILDREN_ALIAS_PASSES = 3;

// The props object itself: a param identifier (or qualifying rest), or
// `this.props` inside a class render method.
const isPropsObjectExpression = (
  expression: EsTreeNode | null | undefined,
  bindings: ChildrenBindings,
): boolean => {
  if (!expression) return false;
  const value = stripParenExpression(expression);
  if (isNodeOfType(value, "Identifier")) return bindings.propsObjectNames.has(value.name);
  return (
    isNodeOfType(value, "MemberExpression") &&
    isNodeOfType(value.object, "ThisExpression") &&
    isNodeOfType(value.property, "Identifier") &&
    value.property.name === "props"
  );
};

const isChildrenValueExpression = (
  expression: EsTreeNode | null | undefined,
  bindings: ChildrenBindings,
): boolean => {
  if (!expression) return false;
  const value = stripParenExpression(expression);
  if (isNodeOfType(value, "Identifier")) return bindings.childrenNames.has(value.name);
  return (
    isNodeOfType(value, "MemberExpression") &&
    isNodeOfType(value.property, "Identifier") &&
    value.property.name === "children" &&
    isPropsObjectExpression(value.object, bindings)
  );
};

// Folds body-level aliases into the bindings: `const content = children`,
// `const { children } = props` (or `this.props`), and re-aliases of aliases
// (bounded passes).
const collectChildrenAliases = (functionNode: FunctionNode, bindings: ChildrenBindings): void => {
  const { body } = functionNode;
  if (!body || !isNodeOfType(body, "BlockStatement")) return;
  for (let pass = 0; pass < MAX_CHILDREN_ALIAS_PASSES; pass += 1) {
    const sizeBeforePass = bindings.childrenNames.size;
    walkAst(body, (node) => {
      if (isFunctionNode(node)) return false;
      if (!isNodeOfType(node, "VariableDeclarator") || !node.init) return undefined;
      if (isNodeOfType(node.id, "Identifier")) {
        if (isChildrenValueExpression(node.init, bindings)) {
          bindings.childrenNames.add(node.id.name);
        }
        return undefined;
      }
      if (isNodeOfType(node.id, "ObjectPattern") && isPropsObjectExpression(node.init, bindings)) {
        for (const property of node.id.properties ?? []) {
          const localName = resolveChildrenPropertyLocalName(property);
          if (localName) bindings.childrenNames.add(localName);
        }
      }
      return undefined;
    });
    if (bindings.childrenNames.size === sizeBeforePass) break;
  }
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

const isChildrenForwardingJsxChild = (child: EsTreeNode, bindings: ChildrenBindings): boolean =>
  isNodeOfType(child, "JSXExpressionContainer") &&
  isChildrenValueExpression(child.expression, bindings);

// `children={children}` or a props spread (`{...props}` / `{...this.props}`)
// that carries the component's children onto the element.
const isChildrenForwardingAttribute = (
  attribute: EsTreeNode,
  bindings: ChildrenBindings,
): boolean => {
  if (isNodeOfType(attribute, "JSXSpreadAttribute")) {
    return isPropsObjectExpression(attribute.argument, bindings);
  }
  return (
    isNodeOfType(attribute, "JSXAttribute") &&
    isNodeOfType(attribute.name, "JSXIdentifier") &&
    attribute.name.name === "children" &&
    isNodeOfType(attribute.value, "JSXExpressionContainer") &&
    isChildrenValueExpression(attribute.value.expression, bindings)
  );
};

// True when somewhere in the returned JSX a text-handling element directly
// receives the component's children — `<View><Text>{children}</Text></View>`,
// `<Text>{props.children}</Text>`, or `<Text children={children} />` — where
// the wrapper's raw string children still land inside a `<Text>` even though
// the root element isn't one.
const jsxRootForwardsChildrenIntoText = (
  jsxRoot: EsTreeNode,
  bindings: ChildrenBindings,
  isTextHandlingElement: (elementName: string) => boolean,
): boolean => {
  let didForwardIntoText = false;
  walkAst(jsxRoot, (node) => {
    if (didForwardIntoText || isFunctionNode(node)) return false;
    if (!isNodeOfType(node, "JSXElement")) return undefined;
    const elementName = resolveJsxElementName(node.openingElement);
    if (!elementName || !isTextHandlingElement(elementName)) return;
    didForwardIntoText =
      (node.children ?? []).some((child) => isChildrenForwardingJsxChild(child, bindings)) ||
      (node.openingElement.attributes ?? []).some((attribute) =>
        isChildrenForwardingAttribute(attribute, bindings),
      );
  });
  return didForwardIntoText;
};

const isMeaningfulJsxChild = (child: EsTreeNode): boolean =>
  !isNodeOfType(child, "JSXText") || Boolean(child.value?.trim());

// True when a non-text element directly receives the component's children
// (`<View>{children}</View>`, or a children-carrying attribute like
// `<View {...props} />` with no JSX children to override it) — a return path
// like this would render the wrapper's raw string children outside any
// `<Text>`, so the component must not be treated as a safe wrapper even if
// another path forwards into text.
const jsxRootRendersChildrenOutsideText = (
  jsxRoot: EsTreeNode,
  bindings: ChildrenBindings,
  isTextHandlingElement: (elementName: string) => boolean,
): boolean => {
  let didRenderOutsideText = false;
  walkAst(jsxRoot, (node) => {
    if (didRenderOutsideText || isFunctionNode(node)) return false;
    if (!isNodeOfType(node, "JSXElement") && !isNodeOfType(node, "JSXFragment")) {
      return undefined;
    }
    if (isNodeOfType(node, "JSXElement")) {
      const elementName = resolveJsxElementName(node.openingElement);
      if (elementName && isTextHandlingElement(elementName)) return false;
      const hasJsxChildren = (node.children ?? []).some(isMeaningfulJsxChild);
      if (
        !hasJsxChildren &&
        (node.openingElement.attributes ?? []).some((attribute) =>
          isChildrenForwardingAttribute(attribute, bindings),
        )
      ) {
        didRenderOutsideText = true;
        return undefined;
      }
    }
    didRenderOutsideText = (node.children ?? []).some((child) =>
      isChildrenForwardingJsxChild(child, bindings),
    );
    return undefined;
  });
  return didRenderOutsideText;
};

// Resolves a styled-component factory back to its base element name —
// `styled(Text)`…``, `styled.Text`…``, `styled(Text)({})`, and
// `styled(Text).attrs(…)`…`` all resolve to "Text".
const resolveStyledFactoryBaseName = (definitionNode: EsTreeNode): string | null => {
  let current: EsTreeNode | null = stripParenExpression(definitionNode);
  while (current) {
    if (isNodeOfType(current, "TaggedTemplateExpression")) {
      current = stripParenExpression(current.tag);
      continue;
    }
    if (isNodeOfType(current, "CallExpression")) {
      const callee = stripParenExpression(current.callee);
      if (isNodeOfType(callee, "Identifier") && callee.name === "styled") {
        const baseArgument = current.arguments?.[0];
        if (!baseArgument) return null;
        const base = stripParenExpression(baseArgument);
        return isNodeOfType(base, "Identifier") ? base.name : null;
      }
      current = callee;
      continue;
    }
    if (isNodeOfType(current, "MemberExpression")) {
      if (
        isNodeOfType(current.object, "Identifier") &&
        current.object.name === "styled" &&
        isNodeOfType(current.property, "Identifier")
      ) {
        return current.property.name;
      }
      current = stripParenExpression(current.object);
      continue;
    }
    return null;
  }
  return null;
};

// The render function of a class component (`class Chip extends Component {
// render() { … } }`), or `null` when the node isn't a class or has no render.
const resolveClassRenderFunction = (classNode: EsTreeNode): FunctionNode | null => {
  if (!isNodeOfType(classNode, "ClassDeclaration") && !isNodeOfType(classNode, "ClassExpression")) {
    return null;
  }
  for (const member of classNode.body?.body ?? []) {
    if (!isNodeOfType(member, "MethodDefinition")) continue;
    if (!isNodeOfType(member.key, "Identifier") || member.key.name !== "render") continue;
    return member.value && isFunctionNode(member.value) ? member.value : null;
  }
  return null;
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
  const unwrapped = unwrapComponentDefinition(definitionNode);
  const styledBaseName = resolveStyledFactoryBaseName(unwrapped);
  if (styledBaseName && isTextHandlingElement(styledBaseName)) {
    wrappers.add(componentName);
    return;
  }
  const functionNode =
    resolveClassRenderFunction(unwrapped) ?? (isFunctionNode(unwrapped) ? unwrapped : null);
  if (!functionNode) return;
  const bindings = resolveParamChildrenBindings(functionNode);
  collectChildrenAliases(functionNode, bindings);
  const jsxRoots = collectReturnedJsxRoots(functionNode);
  if (
    jsxRoots.some((jsxRoot) =>
      jsxRootRendersChildrenOutsideText(jsxRoot, bindings, isTextHandlingElement),
    )
  ) {
    return;
  }
  for (const jsxRoot of jsxRoots) {
    if (isNodeOfType(jsxRoot, "JSXElement")) {
      const rootName = resolveJsxElementName(jsxRoot.openingElement);
      if (rootName && isTextHandlingElement(rootName)) {
        wrappers.add(componentName);
        return;
      }
    }
    if (jsxRootForwardsChildrenIntoText(jsxRoot, bindings, isTextHandlingElement)) {
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
      } else if (
        isNodeOfType(node, "FunctionDeclaration") ||
        isNodeOfType(node, "ClassDeclaration")
      ) {
        const componentName = node.id && isNodeOfType(node.id, "Identifier") ? node.id.name : null;
        recordWrapperFromDeclaration(componentName, node, isTextHandlingElement, wrappers);
      }
    });
    if (wrappers.size === sizeBeforePass) break;
  }

  return wrappers;
};
