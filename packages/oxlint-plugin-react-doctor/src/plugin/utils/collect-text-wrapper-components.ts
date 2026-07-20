import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isJsxFragmentElement } from "./is-jsx-fragment-element.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactComponentName } from "./is-react-component-name.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";
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

// A fragment's children render directly inside its parent, whether the fragment
// is shorthand (`<>…</>`, a JSXFragment) or named (`<Fragment>` /
// `<React.Fragment>`, a JSXElement). Returns those children when `child` is
// either form, else null.
const fragmentChildrenOrNull = (child: EsTreeNode): readonly EsTreeNode[] | null => {
  if (isNodeOfType(child, "JSXFragment")) return child.children ?? [];
  if (isNodeOfType(child, "JSXElement") && isJsxFragmentElement(child.openingElement)) {
    return child.children ?? [];
  }
  return null;
};

// Fragments are render-transparent: `<View><>{children}</></View>` places the
// children directly inside the View at runtime, so the forwarding check must
// see through fragment wrappers when scanning a host's children. Only
// fragments are pierced — an element child is its own receiver.
const isChildrenForwardingJsxChildThroughFragments = (
  child: EsTreeNode,
  bindings: ChildrenBindings,
): boolean => {
  if (isChildrenForwardingJsxChild(child, bindings)) return true;
  const fragmentChildren = fragmentChildrenOrNull(child);
  if (fragmentChildren === null) return false;
  return fragmentChildren.some((innerChild) =>
    isChildrenForwardingJsxChildThroughFragments(innerChild, bindings),
  );
};

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
  isTextHandlingElement: (elementName: string, contextNode: EsTreeNode) => boolean,
): boolean => {
  let didForwardIntoText = false;
  walkAst(jsxRoot, (node) => {
    if (didForwardIntoText || isFunctionNode(node)) return false;
    if (!isNodeOfType(node, "JSXElement")) return undefined;
    const elementName = resolveJsxElementName(node.openingElement);
    if (!elementName || !isTextHandlingElement(elementName, node)) return;
    didForwardIntoText =
      (node.children ?? []).some((child) =>
        isChildrenForwardingJsxChildThroughFragments(child, bindings),
      ) ||
      (node.openingElement.attributes ?? []).some((attribute) =>
        isChildrenForwardingAttribute(attribute, bindings),
      );
  });
  return didForwardIntoText;
};

// Deliberately looser than the shared utils/is-meaningful-jsx-child: here
// ANY expression child (even `{null}` or a comment container) counts as a
// child, because it can override an attribute-forwarded `children`.
const isNonWhitespaceJsxChild = (child: EsTreeNode): boolean =>
  !isNodeOfType(child, "JSXText") || Boolean(child.value?.trim());

// True when the component's children are forwarded into an element the caller
// counts as a forward target — directly (`<X>{children}</X>`) or via a
// children-carrying attribute (`<X {...props} />` with no JSX children to
// override it). Text-handling elements are always skipped (their children land
// safely inside text); `countsAsForwardTarget` selects which of the remaining
// receivers matter.
const jsxRootForwardsChildren = (
  jsxRoot: EsTreeNode,
  bindings: ChildrenBindings,
  isTextHandlingElement: (elementName: string, contextNode: EsTreeNode) => boolean,
  countsAsForwardTarget: (node: EsTreeNode) => boolean,
): boolean => {
  let didForward = false;
  walkAst(jsxRoot, (node) => {
    if (didForward || isFunctionNode(node)) return false;
    if (!isNodeOfType(node, "JSXElement") && !isNodeOfType(node, "JSXFragment")) {
      return undefined;
    }
    if (isNodeOfType(node, "JSXElement")) {
      const elementName = resolveJsxElementName(node.openingElement);
      if (elementName && isTextHandlingElement(elementName, node)) return false;
      const hasJsxChildren = (node.children ?? []).some(isNonWhitespaceJsxChild);
      if (
        !hasJsxChildren &&
        countsAsForwardTarget(node) &&
        (node.openingElement.attributes ?? []).some((attribute) =>
          isChildrenForwardingAttribute(attribute, bindings),
        )
      ) {
        didForward = true;
        return undefined;
      }
    }
    if (
      countsAsForwardTarget(node) &&
      (node.children ?? []).some((child) =>
        isChildrenForwardingJsxChildThroughFragments(child, bindings),
      )
    ) {
      didForward = true;
    }
    return undefined;
  });
  return didForward;
};

// True when a return path forwards the component's children into any non-text
// element — so the component must not be treated as a safe text wrapper, even
// if another path forwards into text.
const jsxRootRendersChildrenOutsideText = (
  jsxRoot: EsTreeNode,
  bindings: ChildrenBindings,
  isTextHandlingElement: (elementName: string, contextNode: EsTreeNode) => boolean,
): boolean => jsxRootForwardsChildren(jsxRoot, bindings, isTextHandlingElement, () => true);

// True when a return path forwards the component's children into a *known*
// non-text host (`<View>{children}</View>`, a lowercase intrinsic, or another
// proven non-text wrapper). This is the report-worthy subset of "outside text":
// forwarding into an unanalyzed import (`<MyButton>{children}</MyButton>`) is
// excluded, since that import may itself wrap its children in a `<Text>` — the
// same uncertainty that keeps a direct `<MyButton>text</MyButton>` unreported.
const jsxRootRendersChildrenIntoNonTextHost = (
  jsxRoot: EsTreeNode,
  bindings: ChildrenBindings,
  isTextHandlingElement: (elementName: string, contextNode: EsTreeNode) => boolean,
  isNonTextHostElement: (elementName: string, contextNode: EsTreeNode) => boolean,
): boolean =>
  jsxRootForwardsChildren(jsxRoot, bindings, isTextHandlingElement, (node) => {
    if (!isNodeOfType(node, "JSXElement")) return false;
    const elementName = resolveJsxElementName(node.openingElement);
    return elementName !== null && isNonTextHostElement(elementName, node);
  });

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

export interface ChildrenForwardingComponents {
  // Forward their children into a `<Text>` — raw text inside them is safe.
  textWrappers: ReadonlySet<string>;
  // Proven to render their children into a non-text host.
  nonTextWrappers: ReadonlySet<string>;
}

export type ChildrenForwardingKind = "text" | "nonText" | "unknown";

// Classifies a component definition by where it forwards its `children`:
// "text" — into a `<Text>` (raw text inside it is safe); "nonText" — into a
// known non-text host; "unknown" — into an unanalyzed import
// that may itself wrap them in `<Text>`, or not forwarded at all (so raw text
// renders nothing). `isTextHandlingElement` / `isNonTextHostElement` decide
// which receiving elements count as text vs. host — pass the in-file-aware
// closures for a same-file declaration, or the global root predicates for a
// component resolved from another file.
export const classifyChildrenForwarding = (
  definitionNode: EsTreeNode,
  isTextHandlingElement: (elementName: string, contextNode: EsTreeNode) => boolean,
  isNonTextHostElement: (elementName: string, contextNode: EsTreeNode) => boolean,
): ChildrenForwardingKind => {
  const unwrapped = unwrapComponentDefinition(definitionNode);
  const styledBaseName = resolveStyledFactoryBaseName(unwrapped);
  if (styledBaseName) {
    if (isTextHandlingElement(styledBaseName, definitionNode)) return "text";
    if (isNonTextHostElement(styledBaseName, definitionNode)) return "nonText";
    return "unknown";
  }
  const functionNode =
    resolveClassRenderFunction(unwrapped) ?? (isFunctionNode(unwrapped) ? unwrapped : null);
  if (!functionNode) return "unknown";
  const bindings = resolveParamChildrenBindings(functionNode);
  collectChildrenAliases(functionNode, bindings);
  const jsxRoots = collectReturnedJsxRoots(functionNode);
  if (
    jsxRoots.some((jsxRoot) =>
      jsxRootRendersChildrenIntoNonTextHost(
        jsxRoot,
        bindings,
        isTextHandlingElement,
        isNonTextHostElement,
      ),
    )
  ) {
    return "nonText";
  }
  // Forwarded somewhere non-text but not into a known host — an unanalyzed
  // import that may itself wrap them in `<Text>`. Not safe, but not proven non-text.
  if (
    jsxRoots.some((jsxRoot) =>
      jsxRootRendersChildrenOutsideText(jsxRoot, bindings, isTextHandlingElement),
    )
  ) {
    return "unknown";
  }
  for (const jsxRoot of jsxRoots) {
    if (isNodeOfType(jsxRoot, "JSXElement")) {
      const rootName = resolveJsxElementName(jsxRoot.openingElement);
      if (rootName && isTextHandlingElement(rootName, jsxRoot)) return "text";
    }
    if (jsxRootForwardsChildrenIntoText(jsxRoot, bindings, isTextHandlingElement)) return "text";
  }
  return "unknown";
};

// Records a same-file declaration into `wrappers` or `nonTextWrappers` per its
// `classifyChildrenForwarding` verdict ("unknown" lands in neither).
const recordWrapperFromDeclaration = (
  componentName: string | null,
  definitionNode: EsTreeNode | null | undefined,
  isTextHandlingElement: (elementName: string, contextNode: EsTreeNode) => boolean,
  isNonTextHostElement: (elementName: string, contextNode: EsTreeNode) => boolean,
  wrappers: Set<string>,
  nonTextWrappers: Set<string>,
): void => {
  if (!componentName || !isReactComponentName(componentName)) return;
  if (wrappers.has(componentName)) return;
  if (!definitionNode) return;
  const kind = classifyChildrenForwarding(
    definitionNode,
    isTextHandlingElement,
    isNonTextHostElement,
  );
  if (kind === "text") wrappers.add(componentName);
  else if (kind === "nonText") nonTextWrappers.add(componentName);
};

// Walks a program and classifies its in-file PascalCase components into
// `textWrappers` / `nonTextWrappers` (see `ChildrenForwardingComponents`).
// `isNonTextHostRoot` seeds the built-in non-text hosts; the walk extends it
// transitively (a component forwarding into a proven non-text wrapper is itself
// non-text), repeating to a fixpoint so wrappers-of-wrappers
// (`const Badge = ({ children }) => <Chip>{children}</Chip>`) resolve regardless
// of declaration order or chain depth — a fixed pass cap left deep chains
// declared in reverse dependency order unclassified. Termination is guaranteed:
// every non-final pass grows one of the (declaration-bounded) sets. A final
// pass drops any name that settled as a text wrapper from `nonTextWrappers`,
// since an early pass can mark a component non-text before the wrapper it
// forwards into is known.
export const collectTextWrapperComponents = (
  programNode: EsTreeNode,
  isTextHandlingRoot: (elementName: string, contextNode: EsTreeNode) => boolean,
  isNonTextHostRoot: (elementName: string, contextNode: EsTreeNode) => boolean,
): ChildrenForwardingComponents => {
  const wrappers = new Set<string>();
  const nonTextWrappers = new Set<string>();
  const componentBindingCounts = new Map<string, number>();
  walkAst(programNode, (node) => {
    let componentName: string | null = null;
    if (
      (isNodeOfType(node, "ImportSpecifier") ||
        isNodeOfType(node, "ImportDefaultSpecifier") ||
        isNodeOfType(node, "ImportNamespaceSpecifier")) &&
      isNodeOfType(node.local, "Identifier")
    ) {
      componentName = node.local.name;
    } else if (isNodeOfType(node, "VariableDeclarator") && isNodeOfType(node.id, "Identifier")) {
      componentName = node.id.name;
    } else if (
      (isNodeOfType(node, "FunctionDeclaration") || isNodeOfType(node, "ClassDeclaration")) &&
      isNodeOfType(node.id, "Identifier")
    ) {
      componentName = node.id.name;
    }
    if (!componentName || !isReactComponentName(componentName)) return;
    componentBindingCounts.set(componentName, (componentBindingCounts.get(componentName) ?? 0) + 1);
  });
  const isTextHandlingElement = (elementName: string, contextNode: EsTreeNode): boolean =>
    isTextHandlingRoot(elementName, contextNode) || wrappers.has(elementName);
  const isNonTextHostElement = (elementName: string, contextNode: EsTreeNode): boolean =>
    isNonTextHostRoot(elementName, contextNode) || nonTextWrappers.has(elementName);

  const recordDeclaration = (componentName: string | null, definitionNode: EsTreeNode | null) => {
    if (componentName && componentBindingCounts.get(componentName) !== 1) return;
    recordWrapperFromDeclaration(
      componentName,
      definitionNode,
      isTextHandlingElement,
      isNonTextHostElement,
      wrappers,
      nonTextWrappers,
    );
  };

  while (true) {
    const wrappersSizeBeforePass = wrappers.size;
    const nonTextSizeBeforePass = nonTextWrappers.size;
    walkAst(programNode, (node) => {
      if (isNodeOfType(node, "VariableDeclarator")) {
        const componentName = node.id && isNodeOfType(node.id, "Identifier") ? node.id.name : null;
        recordDeclaration(componentName, node.init ?? null);
      } else if (
        isNodeOfType(node, "FunctionDeclaration") ||
        isNodeOfType(node, "ClassDeclaration")
      ) {
        const componentName = node.id && isNodeOfType(node.id, "Identifier") ? node.id.name : null;
        recordDeclaration(componentName, node);
      }
    });
    if (
      wrappers.size === wrappersSizeBeforePass &&
      nonTextWrappers.size === nonTextSizeBeforePass
    ) {
      break;
    }
  }

  for (const wrapperName of wrappers) nonTextWrappers.delete(wrapperName);

  return { textWrappers: wrappers, nonTextWrappers };
};
