import { SPREAD_KEY_RESOLUTION_DEPTH } from "../../constants/thresholds.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getFunctionBindingIdentifier } from "../../utils/get-function-binding-name.js";
import { getStaticTemplateLiteralValue } from "../../utils/get-static-template-literal-value.js";
import { hasJsxKeyAttribute } from "../../utils/has-jsx-key-attribute.js";
import { isComponentFunction } from "../../utils/is-component-function.js";
import { isConstDeclaredBinding } from "../../utils/is-const-declared-binding.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNonChildrenJsxAttributeValue } from "../../utils/is-non-children-jsx-attribute-value.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import type { Rule } from "../../utils/rule.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const ITERATOR_METHOD_NAMES = new Set(["map", "flatMap", "from"]);
const RENDERING_CALL_NAMES = new Set(["createPortal", "hydrate", "hydrateRoot", "render"]);
const MISSING_KEY_ARRAY = "Your users can see the wrong data when this array reorders.";
const MISSING_KEY_ITERATOR = "Your users can see the wrong data when this list reorders.";
const KEY_BEFORE_SPREAD =
  "Place this `key` after the `{...spread}` so the spread cannot override it.";
const DUPLICATE_KEY = (keyValue: string): string =>
  `Your users can see the wrong data because two elements share the key "${keyValue}".`;

interface JsxKeySettings {
  checkKeyMustBeforeSpread?: boolean;
  warnOnDuplicates?: boolean;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<JsxKeySettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { jsxKey?: JsxKeySettings }).jsxKey ?? {})
      : {};
  return {
    checkKeyMustBeforeSpread: ruleSettings.checkKeyMustBeforeSpread ?? true,
    warnOnDuplicates: ruleSettings.warnOnDuplicates ?? false,
  };
};

const findArrayVariableDeclarator = (
  arrayExpression: EsTreeNode,
): EsTreeNodeOfType<"VariableDeclarator"> | null => {
  const wrapped = findTransparentExpressionRoot(arrayExpression);
  const ancestor = wrapped.parent;
  if (
    ancestor &&
    isNodeOfType(ancestor, "VariableDeclarator") &&
    ancestor.init === wrapped &&
    isNodeOfType(ancestor.id, "Identifier")
  ) {
    return ancestor;
  }
  return null;
};

const isArrayNestedInObjectProperty = (arrayExpression: EsTreeNode): boolean => {
  let current = findTransparentExpressionRoot(arrayExpression);
  while (current.parent) {
    const parent = current.parent;
    if (
      (isNodeOfType(parent, "ConditionalExpression") &&
        (parent.consequent === current || parent.alternate === current)) ||
      (isNodeOfType(parent, "LogicalExpression") &&
        (parent.left === current || parent.right === current))
    ) {
      current = findTransparentExpressionRoot(parent);
      continue;
    }
    return isNodeOfType(parent, "Property") && parent.value === current;
  }
  return false;
};

const isArrayPassedToNonRenderingCall = (
  arrayExpression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const transparentArray = findTransparentExpressionRoot(arrayExpression);
  const callExpression = transparentArray.parent;
  if (
    !callExpression ||
    !isNodeOfType(callExpression, "CallExpression") ||
    !callExpression.arguments.some((argument) => argument === transparentArray)
  ) {
    return false;
  }
  const argumentIndex = callExpression.arguments.findIndex(
    (argument) => argument === transparentArray,
  );
  if (
    isReactApiCall(callExpression, "createElement", scopes, {
      allowGlobalReactNamespace: true,
      allowUnboundBareCalls: true,
      resolveNamedAliases: true,
    })
  ) {
    return argumentIndex < 2;
  }
  const callee = stripParenExpression(callExpression.callee);
  if (isNodeOfType(callee, "Identifier")) return !RENDERING_CALL_NAMES.has(callee.name);
  if (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.property, "Identifier")
  ) {
    return !RENDERING_CALL_NAMES.has(callee.property.name);
  }
  return true;
};

// `.map(x => x)` returns the raw elements, so their keys still matter.
// A callback that builds NEW elements (wrapping each item) makes the raw
// elements' keys irrelevant — the map output is what renders as siblings,
// and the iterator check covers that output separately.
const isIdentityIteratorCallback = (callback: EsTreeNode): boolean => {
  const callbackFunction = stripParenExpression(callback);
  if (
    !isNodeOfType(callbackFunction, "ArrowFunctionExpression") &&
    !isNodeOfType(callbackFunction, "FunctionExpression")
  ) {
    // A named function reference — can't see the body, assume identity.
    return true;
  }
  const firstParam = callbackFunction.params[0];
  if (!firstParam || !isNodeOfType(firstParam, "Identifier")) return false;
  const itemName = firstParam.name;
  if (
    isNodeOfType(callbackFunction, "ArrowFunctionExpression") &&
    callbackFunction.body &&
    callbackFunction.body.type !== "BlockStatement"
  ) {
    const bodyExpression = stripParenExpression(callbackFunction.body);
    return isNodeOfType(bodyExpression, "Identifier") && bodyExpression.name === itemName;
  }
  let doesReturnItem = false;
  walkAst(callbackFunction.body, (node) => {
    if (isNodeOfType(node, "ReturnStatement") && node.argument) {
      const returned = stripParenExpression(node.argument);
      if (isNodeOfType(returned, "Identifier") && returned.name === itemName) doesReturnItem = true;
    }
  });
  return doesReturnItem;
};

const isListRenderingReference = (reference: EsTreeNode): boolean => {
  const parent = reference.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "JSXExpressionContainer")) {
    const containerParent = parent.parent;
    if (
      containerParent &&
      (isNodeOfType(containerParent, "JSXElement") || isNodeOfType(containerParent, "JSXFragment"))
    ) {
      return true;
    }
    if (
      containerParent &&
      isNodeOfType(containerParent, "JSXAttribute") &&
      isNodeOfType(containerParent.name, "JSXIdentifier") &&
      containerParent.name.name === "children"
    ) {
      return true;
    }
    return false;
  }
  if (isNodeOfType(parent, "ReturnStatement")) return true;
  if (isNodeOfType(parent, "ArrowFunctionExpression") && parent.body === reference) return true;
  if (
    isNodeOfType(parent, "MemberExpression") &&
    parent.object === reference &&
    isNodeOfType(parent.property, "Identifier") &&
    ITERATOR_METHOD_NAMES.has(parent.property.name)
  ) {
    const callExpression = parent.parent;
    if (
      callExpression &&
      isNodeOfType(callExpression, "CallExpression") &&
      callExpression.callee === parent
    ) {
      const callback = callExpression.arguments[0];
      return callback ? isIdentityIteratorCallback(callback) : true;
    }
  }
  return false;
};

const renderedAsListCache = new WeakMap<EsTreeNode, boolean>();

// A JSX array literal bound to a variable is only a keyed-list hazard when
// some reference actually renders the array as sibling children (`{items}`,
// `children={items}`, `return items`, or an identity `.map`). Test fixtures
// iterated with `forEach(render)`, positional lookup tables (`{icons[i]}`),
// and arrays whose elements are re-wrapped in keyed elements never render
// the raw elements as a list, so their keys are inert.
const isArrayVariableRenderedAsList = (
  declarator: EsTreeNodeOfType<"VariableDeclarator">,
): boolean => {
  const cached = renderedAsListCache.get(declarator);
  if (cached !== undefined) return cached;
  const bindingIdentifier = declarator.id;
  if (!isNodeOfType(bindingIdentifier, "Identifier")) return true;
  const programRoot = findProgramRoot(declarator);
  if (!programRoot) return true;
  let didFindRenderingUse = false;
  walkAst(programRoot, (node) => {
    if (didFindRenderingUse) return false;
    if (!isNodeOfType(node, "Identifier") || node === bindingIdentifier) return;
    if (node.name !== bindingIdentifier.name) return;
    const parent = node.parent;
    if (parent && isNodeOfType(parent, "MemberExpression") && parent.property === node) return;
    if (parent && isNodeOfType(parent, "Property") && parent.key === node && !parent.computed) {
      return;
    }
    const resolved = findVariableInitializer(node, node.name);
    if (!resolved || resolved.bindingIdentifier !== bindingIdentifier) return;
    if (isListRenderingReference(node)) didFindRenderingUse = true;
  });
  renderedAsListCache.set(declarator, didFindRenderingUse);
  return didFindRenderingUse;
};

interface IteratorContextArray {
  kind: "array";
}
interface IteratorContextIterator {
  kind: "iterator";
  callExpression: EsTreeNode;
}
type IteratorContext = IteratorContextArray | IteratorContextIterator;

const namedCallbackIteratorCallCache = new WeakMap<EsTreeNode, EsTreeNode | null>();

const findNamedCallbackIteratorCall = (functionNode: EsTreeNode): EsTreeNode | null => {
  const cached = namedCallbackIteratorCallCache.get(functionNode);
  if (cached !== undefined) return cached;
  const bindingIdentifier = getFunctionBindingIdentifier(functionNode);
  if (!bindingIdentifier) {
    namedCallbackIteratorCallCache.set(functionNode, null);
    return null;
  }
  const programRoot = findProgramRoot(functionNode);
  if (!programRoot) {
    namedCallbackIteratorCallCache.set(functionNode, null);
    return null;
  }
  let iteratorCall: EsTreeNode | null = null;
  walkAst(programRoot, (node) => {
    if (iteratorCall) return false;
    if (
      !isNodeOfType(node, "Identifier") ||
      node === bindingIdentifier ||
      node.name !== bindingIdentifier.name
    ) {
      return;
    }
    const binding = findVariableInitializer(node, node.name);
    if (!binding || binding.bindingIdentifier !== bindingIdentifier) return;
    const callbackExpression = findTransparentExpressionRoot(node);
    const callExpression = callbackExpression.parent;
    if (!callExpression || !isNodeOfType(callExpression, "CallExpression")) return;
    const callee = callExpression.callee;
    if (
      !isNodeOfType(callee, "MemberExpression") ||
      !isNodeOfType(callee.property, "Identifier") ||
      !ITERATOR_METHOD_NAMES.has(callee.property.name)
    ) {
      return;
    }
    const callbackIndex = callee.property.name === "from" ? 1 : 0;
    if (callExpression.arguments[callbackIndex] !== callbackExpression) return;
    if (isNonChildrenJsxAttributeValue(callExpression)) return;
    iteratorCall = callExpression;
    return false;
  });
  namedCallbackIteratorCallCache.set(functionNode, iteratorCall);
  return iteratorCall;
};

const findEnclosingIteratorContext = (
  jsxNode: EsTreeNode,
  scopes: ScopeAnalysis,
): IteratorContext | null => {
  let current: EsTreeNode | null | undefined = jsxNode;
  let isOutsideContainingFunction = false;
  let didSeeReturnStatement = false;

  while (current && current.parent) {
    const parent: EsTreeNode = current.parent;
    if (
      isNodeOfType(parent, "ArrowFunctionExpression") ||
      isNodeOfType(parent, "FunctionExpression") ||
      isNodeOfType(parent, "FunctionDeclaration")
    ) {
      // Arrow function with expression body counts as implicit return.
      if (isNodeOfType(parent, "ArrowFunctionExpression")) {
        const isExpressionBody = parent.body && parent.body.type !== "BlockStatement";
        if (!didSeeReturnStatement && !isExpressionBody) return null;
      } else if (!didSeeReturnStatement) {
        return null;
      }

      const grandparent = parent.parent;
      if (grandparent && isNodeOfType(grandparent, "Property")) return null;
      if (isOutsideContainingFunction) return null;
      const namedCallbackIteratorCall = findNamedCallbackIteratorCall(parent);
      if (namedCallbackIteratorCall) {
        return { kind: "iterator", callExpression: namedCallbackIteratorCall };
      }
      isOutsideContainingFunction = true;
    } else if (isNodeOfType(parent, "ArrayExpression")) {
      if (isOutsideContainingFunction) return null;
      if (isArrayNestedInObjectProperty(parent)) return null;
      if (isArrayPassedToNonRenderingCall(parent, scopes)) return null;
      // Config arrays — `description: [<>...</>]`, `messages: [<Foo />]`,
      // `tooltip: [...]`, Map entry tuples `[[key, <X />], ...]` — aren't
      // iterated for rendering; they're data assigned to a property.
      // The array's elements get consumed as-is via `description[0]`,
      // `Map.get(key)`, etc. Reconciliation only cares about keys when
      // siblings render in a list; these aren't sibling renders.
      const arrayParent = parent.parent;
      if (arrayParent && isNodeOfType(arrayParent, "Property")) return null;
      // Tuple inside another array (e.g. `Map` entries:
      // `[[key, <Foo/>], [key, <Bar/>]]`) — the inner array is data,
      // outer array is what gets iterated.
      if (arrayParent && isNodeOfType(arrayParent, "ArrayExpression")) return null;
      // Element array handed to a non-`children` prop (`<Tabs items={[...]} />`).
      // React never key-validates props, so the receiving component owns keying.
      if (isNonChildrenJsxAttributeValue(parent)) return null;
      const arrayDeclarator = findArrayVariableDeclarator(parent);
      if (arrayDeclarator && !isArrayVariableRenderedAsList(arrayDeclarator)) return null;
      return { kind: "array" };
    } else if (isNodeOfType(parent, "CallExpression")) {
      const callee = parent.callee;
      if (!isNodeOfType(callee, "MemberExpression")) return null;
      if (!isNodeOfType(callee.property, "Identifier")) return null;
      const methodName = callee.property.name;
      if (!ITERATOR_METHOD_NAMES.has(methodName)) return null;
      const targetArgIndex = methodName === "from" ? 1 : 0;
      const targetArg = parent.arguments[targetArgIndex];
      if (!targetArg) return null;
      // Confirm `current` is the function passed as the target arg, or
      // its descendant.
      let walker: EsTreeNode | null = current;
      while (walker && walker !== parent) {
        if (walker === targetArg) {
          // `<Menu items={xs.map(...)} />` — the mapped collection is a
          // non-`children` prop, so React never key-validates it.
          if (isNonChildrenJsxAttributeValue(parent)) return null;
          return { kind: "iterator", callExpression: parent };
        }
        walker = walker.parent ?? null;
      }
      return null;
    } else if (
      isNodeOfType(parent, "JSXElement") ||
      isNodeOfType(parent, "JSXOpeningElement") ||
      isNodeOfType(parent, "JSXFragment") ||
      isNodeOfType(parent, "Property")
    ) {
      return null;
    } else if (isNodeOfType(parent, "ReturnStatement")) {
      didSeeReturnStatement = true;
    }
    current = parent;
  }
  return null;
};

// Resolves the name of an iterator callback's first parameter — the "item"
// each element is built from. `xs.map((item) => ...)` → `"item"`. Only plain
// identifier params resolve; destructured params (`({ id }) => ...`) return
// null since there's no single binding to match a spread against.
const resolveIterationItemName = (callExpression: EsTreeNode): string | null => {
  if (!isNodeOfType(callExpression, "CallExpression")) return null;
  const callee = callExpression.callee;
  if (!isNodeOfType(callee, "MemberExpression")) return null;
  if (!isNodeOfType(callee.property, "Identifier")) return null;
  const targetArgIndex = callee.property.name === "from" ? 1 : 0;
  const callbackArgument = callExpression.arguments[targetArgIndex];
  if (!callbackArgument) return null;
  const unwrappedCallback = stripParenExpression(callbackArgument);
  const callback = isNodeOfType(unwrappedCallback, "Identifier")
    ? findVariableInitializer(unwrappedCallback, unwrappedCallback.name)?.initializer
    : unwrappedCallback;
  if (
    !callback ||
    (!isNodeOfType(callback, "ArrowFunctionExpression") &&
      !isNodeOfType(callback, "FunctionExpression"))
  ) {
    return null;
  }
  const firstParam = callback.params[0];
  return firstParam && isNodeOfType(firstParam, "Identifier") ? firstParam.name : null;
};

// React never forwards `key` through `{...spread}`, so `xs.map(x => <X {...x} />)`
// is technically keyless. But spreading the *whole iteration item* is the
// canonical "the data row carries its own identity" shape — flagging it is the
// dominant source of jsx-key noise on real lists (every row spread fires) while
// rarely catching a genuine reorder bug. We treat that one shape as borderline
// and stay silent; genuine keyless lists (`<X name={x.name} />`, index keys,
// array literals) still report.
const spreadsIterationItem = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  iterationItemName: string,
): boolean => {
  for (const attribute of openingElement.attributes) {
    if (!isNodeOfType(attribute, "JSXSpreadAttribute")) continue;
    const argument = attribute.argument;
    if (isNodeOfType(argument, "Identifier") && argument.name === iterationItemName) return true;
  }
  return false;
};

// Prop-getter APIs deliver the key through the returned props object:
// react-table v7 (`{...row.getRowProps()}`), prism-react-renderer
// (`{...getLineProps({ line, key: i })}`), MUI Autocomplete
// (`{...getTagProps({ index })}`). Static analysis can't see inside the
// call, so a call-expression spread makes "missing key" unprovable.
const hasCallExpressionSpread = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  for (const attribute of openingElement.attributes) {
    if (!isNodeOfType(attribute, "JSXSpreadAttribute")) continue;
    if (isNodeOfType(stripParenExpression(attribute.argument), "CallExpression")) return true;
  }
  return false;
};

const isWithinChildrenToArray = (jsxNode: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = jsxNode.parent;
  while (current) {
    if (isNodeOfType(current, "CallExpression")) {
      const callee = current.callee;
      if (
        isNodeOfType(callee, "MemberExpression") &&
        isNodeOfType(callee.property, "Identifier") &&
        callee.property.name === "toArray"
      ) {
        // Accept any of:
        //   - Children.toArray(...)        (named import)
        //   - <X>.Children.toArray(...)    (e.g. React.Children, Act.Children)
        const objectExpression = callee.object;
        if (isNodeOfType(objectExpression, "Identifier") && objectExpression.name === "Children") {
          return true;
        }
        if (
          isNodeOfType(objectExpression, "MemberExpression") &&
          isNodeOfType(objectExpression.property, "Identifier") &&
          objectExpression.property.name === "Children"
        ) {
          return true;
        }
      }
    }
    current = current.parent ?? null;
  }
  return false;
};

const isKeyPropertyName = (propertyKey: EsTreeNode): boolean => {
  if (isNodeOfType(propertyKey, "Identifier")) return propertyKey.name === "key";
  if (isNodeOfType(propertyKey, "Literal")) return String(propertyKey.value) === "key";
  return false;
};

// `this.props` inside a class component can never carry `key` — React
// strips it before props reach the component.
const isThisPropsMember = (expression: EsTreeNode): boolean =>
  isNodeOfType(expression, "MemberExpression") &&
  !expression.computed &&
  isNodeOfType(expression.object, "ThisExpression") &&
  isNodeOfType(expression.property, "Identifier") &&
  expression.property.name === "props";

const isDirectComponentPropsParameter = (
  bindingIdentifier: EsTreeNode,
  functionNode: EsTreeNode,
): boolean => {
  if (!isFunctionLike(functionNode) || !isComponentFunction(functionNode)) return false;
  const firstParameter = functionNode.params?.[0];
  if (!firstParameter) return false;
  const parameterBinding = isNodeOfType(firstParameter, "AssignmentPattern")
    ? firstParameter.left
    : firstParameter;
  return parameterBinding === bindingIdentifier;
};

// `({ prop, ...rest }) => …` — a rest binding in a function parameter's
// top-level ObjectPattern receives the component's props, and React strips
// `key` before props reach the component, so `rest` provably cannot carry
// one (same guarantee as `this.props`). Rest bindings from arbitrary
// destructured objects (`const { a, ...rest } = obj`) stay key-capable.
const isFunctionParameterPropsRest = (bindingIdentifier: EsTreeNode): boolean => {
  const restElement = bindingIdentifier.parent;
  if (!restElement || !isNodeOfType(restElement, "RestElement")) return false;
  const objectPattern = restElement.parent;
  if (!objectPattern || !isNodeOfType(objectPattern, "ObjectPattern")) return false;
  const patternParent = objectPattern.parent;
  const parameterNode =
    patternParent &&
    isNodeOfType(patternParent, "AssignmentPattern") &&
    patternParent.left === objectPattern
      ? patternParent
      : objectPattern;
  const functionNode = parameterNode.parent;
  if (
    !functionNode ||
    (!isNodeOfType(functionNode, "ArrowFunctionExpression") &&
      !isNodeOfType(functionNode, "FunctionExpression") &&
      !isNodeOfType(functionNode, "FunctionDeclaration"))
  ) {
    return false;
  }
  return isComponentFunction(functionNode) && functionNode.params[0] === parameterNode;
};

// `const { key, ...rest } = anything` — `key` is destructured away, so
// `rest` provably cannot carry one.
const isRestBindingWithKeyExtracted = (bindingIdentifier: EsTreeNode): boolean => {
  const restElement = bindingIdentifier.parent;
  if (!restElement || !isNodeOfType(restElement, "RestElement")) return false;
  const objectPattern = restElement.parent;
  if (!objectPattern || !isNodeOfType(objectPattern, "ObjectPattern")) return false;
  for (const property of objectPattern.properties) {
    if (!isNodeOfType(property, "Property") || property.computed) continue;
    if (isKeyPropertyName(property.key)) return true;
  }
  return false;
};

const isBindingAssignedKey = (scopeOwner: EsTreeNode, bindingName: string): boolean => {
  let didFindKeyAssignment = false;
  walkAst(scopeOwner, (node) => {
    if (didFindKeyAssignment) return false;
    if (isNodeOfType(node, "AssignmentExpression") && isNodeOfType(node.left, "MemberExpression")) {
      const assignedObject = stripParenExpression(node.left.object);
      if (
        isNodeOfType(assignedObject, "Identifier") &&
        assignedObject.name === bindingName &&
        isKeyPropertyName(node.left.property)
      ) {
        didFindKeyAssignment = true;
        return false;
      }
    }
    if (isNodeOfType(node, "CallExpression")) {
      const callee = node.callee;
      if (
        isNodeOfType(callee, "MemberExpression") &&
        isNodeOfType(callee.object, "Identifier") &&
        callee.object.name === "Object" &&
        isNodeOfType(callee.property, "Identifier") &&
        callee.property.name === "assign"
      ) {
        const firstArgument = node.arguments[0];
        if (
          firstArgument &&
          isNodeOfType(firstArgument, "Identifier") &&
          firstArgument.name === bindingName
        ) {
          for (const sourceArgument of node.arguments.slice(1)) {
            const source = stripParenExpression(sourceArgument);
            if (!isNodeOfType(source, "ObjectExpression")) continue;
            if (
              source.properties.some(
                (property) => isNodeOfType(property, "Property") && isKeyPropertyName(property.key),
              )
            ) {
              didFindKeyAssignment = true;
              return false;
            }
          }
        }
      }
    }
  });
  return didFindKeyAssignment;
};

const spreadExpressionHasKey = (expression: EsTreeNode, depth: number): boolean => {
  const inner = stripParenExpression(expression);
  if (isNodeOfType(inner, "ObjectExpression")) {
    for (const property of inner.properties) {
      if (isNodeOfType(property, "SpreadElement")) {
        if (depth >= SPREAD_KEY_RESOLUTION_DEPTH) continue;
        if (spreadExpressionHasKey(property.argument, depth + 1)) return true;
        continue;
      }
      if (!isNodeOfType(property, "Property")) continue;
      if (isKeyPropertyName(property.key)) return true;
    }
    return false;
  }
  if (isNodeOfType(inner, "ConditionalExpression")) {
    if (depth >= SPREAD_KEY_RESOLUTION_DEPTH) return false;
    return (
      spreadExpressionHasKey(inner.consequent, depth + 1) ||
      spreadExpressionHasKey(inner.alternate, depth + 1)
    );
  }
  if (isNodeOfType(inner, "LogicalExpression")) {
    if (depth >= SPREAD_KEY_RESOLUTION_DEPTH) return false;
    if (inner.operator === "&&") return spreadExpressionHasKey(inner.right, depth + 1);
    return (
      spreadExpressionHasKey(inner.left, depth + 1) ||
      spreadExpressionHasKey(inner.right, depth + 1)
    );
  }
  if (isNodeOfType(inner, "Literal")) return false;
  if (isThisPropsMember(inner)) return false;
  if (isNodeOfType(inner, "Identifier")) {
    if (inner.name === "undefined") return false;
    if (depth >= SPREAD_KEY_RESOLUTION_DEPTH) return false;
    const binding = findVariableInitializer(inner, inner.name);
    if (!binding) return false;
    if (isRestBindingWithKeyExtracted(binding.bindingIdentifier)) return false;
    if (isFunctionParameterPropsRest(binding.bindingIdentifier)) return false;
    if (isDirectComponentPropsParameter(binding.bindingIdentifier, binding.scopeOwner))
      return false;
    if (!isConstDeclaredBinding(binding) || !binding.initializer) return false;
    if (isBindingAssignedKey(binding.scopeOwner, inner.name)) return true;
    return spreadExpressionHasKey(binding.initializer, depth + 1);
  }
  return false;
};

const spreadCanOverwriteKey = (spreadAttribute: EsTreeNodeOfType<"JSXSpreadAttribute">): boolean =>
  spreadExpressionHasKey(spreadAttribute.argument, 0);

const checkKeyBeforeSpread = (
  context: Parameters<Rule["create"]>[0],
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): void => {
  // A key-capable spread placed after the explicit key can override it in
  // both the classic and automatic JSX runtimes. A later explicit key wins.
  let keyIndex: number | null = null;
  let keyAttribute: EsTreeNode | null = null;
  let lastKeyCarryingSpreadIndex: number | null = null;
  for (
    let attributeIndex = 0;
    attributeIndex < openingElement.attributes.length;
    attributeIndex++
  ) {
    const attribute = openingElement.attributes[attributeIndex];
    if (isNodeOfType(attribute, "JSXAttribute")) {
      if (isNodeOfType(attribute.name, "JSXIdentifier") && attribute.name.name === "key") {
        keyIndex = attributeIndex;
        keyAttribute = attribute;
      }
    } else if (isNodeOfType(attribute, "JSXSpreadAttribute") && spreadCanOverwriteKey(attribute)) {
      lastKeyCarryingSpreadIndex = attributeIndex;
    }
  }
  if (
    keyIndex !== null &&
    lastKeyCarryingSpreadIndex !== null &&
    lastKeyCarryingSpreadIndex > keyIndex &&
    keyAttribute
  ) {
    context.report({ node: keyAttribute, message: KEY_BEFORE_SPREAD });
  }
};

const getKeyAttributeValueString = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): { keyValue: string; node: EsTreeNode } | null => {
  for (const attribute of openingElement.attributes) {
    if (!isNodeOfType(attribute, "JSXAttribute")) continue;
    if (!isNodeOfType(attribute.name, "JSXIdentifier") || attribute.name.name !== "key") continue;
    const value = attribute.value;
    if (!value) return null;
    if (isNodeOfType(value, "Literal")) {
      const literalValue = value.value;
      if (typeof literalValue === "string" || typeof literalValue === "number") {
        return { keyValue: String(literalValue), node: attribute };
      }
      return null;
    }
    if (isNodeOfType(value, "JSXExpressionContainer")) {
      const expression = value.expression;
      if (isNodeOfType(expression, "Literal")) {
        const literalValue = expression.value;
        if (typeof literalValue === "string" || typeof literalValue === "number") {
          return { keyValue: String(literalValue), node: attribute };
        }
        return null;
      }
      if (isNodeOfType(expression, "TemplateLiteral")) {
        const staticValue = getStaticTemplateLiteralValue(expression);
        if (staticValue !== null) return { keyValue: staticValue, node: attribute };
      }
    }
  }
  return null;
};

// Port of `oxc_linter::rules::react::jsx_key`. Reports JSX elements inside
// array literals or `.map` / `.flatMap` / `Array.from` callbacks that lack a
// `key` prop. Honors two settings:
//   - checkKeyMustBeforeSpread (default true): reports `<X key=… {...p}>`
//   - warnOnDuplicates (default false): duplicate `key` values among siblings
// Skips elements wrapped by `Children.toArray(...)` since React's runtime
// assigns synthetic keys for those.
export const jsxKey = defineRule({
  id: "jsx-key",
  title: "Missing key in list",
  severity: "error",
  recommendation:
    "Add a stable `key` prop so React can keep list items matched to the right data when the list changes.",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    return {
      JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
        const openingElement = node.openingElement;
        if (settings.checkKeyMustBeforeSpread) {
          checkKeyBeforeSpread(context, openingElement);
        }
        if (settings.warnOnDuplicates) {
          // Duplicate keys among children of this element.
          const seenKeys = new Set<string>();
          for (const child of node.children) {
            if (!isNodeOfType(child, "JSXElement")) continue;
            const keyValue = getKeyAttributeValueString(child.openingElement);
            if (!keyValue) continue;
            if (seenKeys.has(keyValue.keyValue)) {
              context.report({ node: keyValue.node, message: DUPLICATE_KEY(keyValue.keyValue) });
            } else {
              seenKeys.add(keyValue.keyValue);
            }
          }
        }
        // Missing key check: only on top-level JSX in an array/iterator.
        const enclosingContext = findEnclosingIteratorContext(node, context.scopes);
        if (!enclosingContext) return;
        if (isWithinChildrenToArray(node)) return;
        if (hasJsxKeyAttribute(openingElement)) return;
        if (hasCallExpressionSpread(openingElement)) return;
        if (enclosingContext.kind === "iterator") {
          const iterationItemName = resolveIterationItemName(enclosingContext.callExpression);
          if (iterationItemName && spreadsIterationItem(openingElement, iterationItemName)) return;
        }
        context.report({
          node: openingElement,
          message: enclosingContext.kind === "array" ? MISSING_KEY_ARRAY : MISSING_KEY_ITERATOR,
        });
      },
      ArrayExpression(node: EsTreeNodeOfType<"ArrayExpression">) {
        if (!settings.warnOnDuplicates) return;
        const seenKeys = new Set<string>();
        for (const element of node.elements) {
          if (!element) continue;
          if (!isNodeOfType(element, "JSXElement")) continue;
          const keyValue = getKeyAttributeValueString(element.openingElement);
          if (!keyValue) continue;
          if (seenKeys.has(keyValue.keyValue)) {
            context.report({ node: keyValue.node, message: DUPLICATE_KEY(keyValue.keyValue) });
          } else {
            seenKeys.add(keyValue.keyValue);
          }
        }
      },
    };
  },
});
