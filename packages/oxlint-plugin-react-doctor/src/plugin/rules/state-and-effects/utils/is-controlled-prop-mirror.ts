import { collectPatternNames } from "../../../utils/collect-pattern-names.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getJsxAttributeName } from "../../../utils/get-jsx-attribute-name.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { isEventHandlerName } from "./event-handler-reference.js";

// Memoized per component function node — the prop-name set is a pure
// function of the (immutable) subtree, and every isControlledPropMirror
// query for the same component recomputes it otherwise.
const componentPropNamesCache = new WeakMap<EsTreeNode, ReadonlySet<string>>();

const collectComponentPropNames = (componentFunction: EsTreeNode): ReadonlySet<string> => {
  const cached = componentPropNamesCache.get(componentFunction);
  if (cached) return cached;
  const propNames = new Set<string>();
  if (!isFunctionLike(componentFunction)) return propNames;
  const propsObjectParamNames = new Set<string>();
  for (const param of componentFunction.params ?? []) {
    collectPatternNames(param, propNames);
    if (isNodeOfType(param, "Identifier")) propsObjectParamNames.add(param.name);
  }
  const componentBody: EsTreeNode | null | undefined = componentFunction.body;
  if (!componentBody) return propNames;
  walkAst(componentBody, (child: EsTreeNode): boolean | void => {
    if (child !== componentBody && isFunctionLike(child)) return false;
    if (
      isNodeOfType(child, "VariableDeclarator") &&
      isNodeOfType(child.id, "ObjectPattern") &&
      isNodeOfType(child.init, "Identifier") &&
      propsObjectParamNames.has(child.init.name)
    ) {
      collectPatternNames(child.id, propNames);
    }
  });
  componentPropNamesCache.set(componentFunction, propNames);
  return propNames;
};

// Own-scope bound names (params + non-nested declarators) per function node,
// memoized so the repeated "does this nested function declare X" checks are
// a Set lookup instead of a fresh subtree walk each time.
const ownScopeBoundNamesCache = new WeakMap<EsTreeNode, ReadonlySet<string>>();

const getOwnScopeBoundNames = (functionNode: EsTreeNode): ReadonlySet<string> => {
  const cached = ownScopeBoundNamesCache.get(functionNode);
  if (cached) return cached;
  const boundNames = new Set<string>();
  if (isFunctionLike(functionNode)) {
    for (const param of functionNode.params ?? []) collectPatternNames(param, boundNames);
  }
  walkAst(functionNode, (child: EsTreeNode): boolean | void => {
    if (child !== functionNode && isFunctionLike(child)) return false;
    if (isNodeOfType(child, "VariableDeclarator")) {
      collectPatternNames(child.id, boundNames);
    }
  });
  ownScopeBoundNamesCache.set(functionNode, boundNames);
  return boundNames;
};

const declaresBindingNamed = (functionNode: EsTreeNode, bindingName: string): boolean =>
  getOwnScopeBoundNames(functionNode).has(bindingName);

const isPropertyNamePosition = (identifier: EsTreeNode): boolean => {
  const parent = identifier.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "MemberExpression")) {
    return parent.property === identifier && !parent.computed;
  }
  if (isNodeOfType(parent, "Property")) {
    return parent.key === identifier && !parent.computed;
  }
  return false;
};

const referencesIdentifierNamed = (root: EsTreeNode, identifierName: string): boolean => {
  let isReferenced = false;
  walkAst(root, (child: EsTreeNode): boolean | void => {
    if (isReferenced) return false;
    if (child !== root && isFunctionLike(child) && declaresBindingNamed(child, identifierName)) {
      return false;
    }
    if (
      isNodeOfType(child, "Identifier") &&
      child.name === identifierName &&
      !isPropertyNamePosition(child)
    ) {
      isReferenced = true;
      return false;
    }
  });
  return isReferenced;
};

const isSetterWiredToJsxHandler = (componentFunction: EsTreeNode, setterName: string): boolean => {
  let isWired = false;
  walkAst(componentFunction, (child: EsTreeNode): boolean | void => {
    if (isWired) return false;
    if (
      child !== componentFunction &&
      isFunctionLike(child) &&
      declaresBindingNamed(child, setterName)
    ) {
      return false;
    }
    if (!isNodeOfType(child, "JSXAttribute") || !child.value) return;
    const attributeName = getJsxAttributeName(child.name);
    if (!attributeName || !isEventHandlerName(attributeName)) return;
    if (referencesIdentifierNamed(child.value, setterName)) {
      isWired = true;
      return false;
    }
  });
  return isWired;
};

// Controlled/uncontrolled value mirror: `useState(value)` +
// `useEffect(() => setDraft(value), [value])` where the SAME setter is wired
// into a JSX event-handler attribute — passed directly
// (`onChange={setDraft}`) or called from an inline attribute handler
// (`onChange={(e) => setDraft(e.target.value)}`). The state holds the user's
// live edits and merely re-syncs to the controlled prop, so it is NOT a
// value derivable while rendering — a `useMemo` would erase the user's
// input. A setter that only reaches JSX through a body-defined handler
// (`onChange={onChangeHandler}`) does NOT count: that indirection is the
// mirror shape the derived-state rules must keep detecting. The mirrored
// argument must be a bare prop identifier; body destructures
// (`const { value: color } = props`) count as props. Callers verify the
// callee is a useState setter before calling this.
export const isControlledPropMirror = (effectNode: EsTreeNode, setterCall: EsTreeNode): boolean => {
  if (!isNodeOfType(setterCall, "CallExpression")) return false;
  if (!isNodeOfType(setterCall.callee, "Identifier")) return false;
  const setterArguments = setterCall.arguments ?? [];
  if (setterArguments.length !== 1) return false;
  const mirroredArgument = setterArguments[0];
  if (!isNodeOfType(mirroredArgument, "Identifier")) return false;

  const componentFunction = findEnclosingFunction(effectNode);
  if (!componentFunction) return false;

  if (!collectComponentPropNames(componentFunction).has(mirroredArgument.name)) return false;

  return isSetterWiredToJsxHandler(componentFunction, setterCall.callee.name);
};
