import { MUTATING_ARRAY_METHODS, MUTATING_COLLECTION_METHODS } from "../../constants/js.js";
import { REDUCER_PATH_STATE_LIMIT } from "../../constants/thresholds.js";
import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { isLodashMutatorCall } from "./utils/lodash-mutator-call.js";
import { resolveReducerFunction } from "./utils/resolve-reducer-function.js";
import { getStaticMemberPropertyName } from "./utils/static-member-property-name.js";

const MESSAGE = "This reducer changes state in place, so your update is silently skipped.";

const SAME_REFERENCE_ARRAY_RETURN_METHODS = new Set(["copyWithin", "fill", "reverse", "sort"]);

const SAME_REFERENCE_COLLECTION_RETURN_METHODS = new Set(["add", "set"]);

const OBJECT_MUTATION_METHODS = new Set(["assign", "defineProperties", "defineProperty"]);

const REFLECT_MUTATION_METHODS = new Set(["deleteProperty", "set"]);

// React reducer state is compared by identity (`Object.is`). A reducer may
// legitimately return the previous state object for no-op actions, and it may
// legitimately mutate freshly-cloned data before returning the clone. The bug
// this rule targets is narrower:
//
//   1. a reducer that is actually wired to React's `useReducer`,
//   2. mutates the original reducer state object, or an alias/reachable value
//      derived from that original object,
//   3. and then returns the original top-level state reference on the same
//      control-flow path.
//
// The implementation mirrors those three requirements. First, it resolves only
// real React imports (`useReducer`, aliased named imports, and `React.useReducer`
// through namespace/default React imports) so Array.reduce callbacks and
// user-defined useReducer helpers are ignored. Second, it tracks identity through
// each reducer path: `const next = state` remains the original reference, while
// `const next = { ...state }`, `[...state.items]`, `new Map(state)`, etc. do not.
// Third, it reports only when a remembered mutation is followed by a same-path
// same-reference return such as `return state`, `return alias`,
// `return state.sort(...)`, or `return Object.assign(state, patch)`.
//
// Cross-file resolution: when the reducer is imported from a
// sibling file, the rule resolves the import via
// `resolveRelativeImportPath` (which handles `.ts` / `.tsx` /
// extension probing / package `exports` maps), then follows barrel
// re-exports via `resolveBarrelExportFilePath`. Imported reducer
// bodies are parsed with the cached `parseSourceFile` and the
// exported function is located by `findExportedFunctionBody`. The
// same path analysis then runs on the resolved function.
//
// Out of scope for cross-file:
//   - Non-relative imports (`from "@/store/reducer"`) until TS path
//     aliases are honoured. Project-level path-alias resolution
//     would require reading `tsconfig.json` paths; skipping for now
//     since most reducer imports in real codebases are relative.
//   - Reducers defined in `node_modules` packages — those are
//     packaged code, never the user's bug.
//   - Generated files larger than 2 MB (skipped to keep lint runs
//     bounded).
//   - Duplicate-report suppression when the same reducer is wired to
//     `useReducer` in many components — the rule de-dupes via the
//     `analyzedReducers` WeakSet, so each unique reducer function
//     body is reported only once per lint run.
//
// TODO(v2 - nested identity): this intentionally does not diagnose
// nested-reference preservation like `state.user.name = "Ada"; return { ...state }`.
// React will see a new top-level state object in that case, so it belongs to a
// separate, lower-confidence rule.
//
// TODO(v2 - broader mutation APIs): this rule only models syntactically obvious
// mutations plus a small set of built-in mutating APIs. Helper calls like
// `mutate(state)`, lodash-style `set(state, path, value)`, and type-dependent
// custom methods are skipped unless we can prove the mutation target.
//
// Destructured aliases (`const { items } = state` /
// `const { items: localItems } = state`) ARE tracked: each top-level
// binding in the ObjectPattern / ArrayPattern is added to
// `mutableStateSourceNames` when the initializer is reachable from
// the reducer state. Nested patterns
// (`const { a: { b } } = state`) are not modelled — single-level
// destructure covers the canonical reducer pattern.
//
// Logical assignments (`??=`, `||=`, `&&=`) are treated as reducer mutations.
// They may be no-ops at runtime, but reducer mutation is nonstandard enough that
// callers can ignore the diagnostic if they intentionally rely on that behavior.
//
// TODO(v2 - deeper control flow): current path analysis is precise for
// straight-line code, `if`, `switch`, and standalone blocks. Loops,
// try/catch/finally, labeled flow, breaks/continues, and short-circuit
// reachability are approximated because mutation collection walks their AST
// without modeling every execution path. Add CFG-backed path analysis before
// treating those cases as precise.
interface ReducerStateMutation {
  node: EsTreeNode;
}

interface ReducerPathState {
  // Names that refer to the original reducer state object, so returning one
  // of them returns the same top-level reference React compares with Object.is.
  originalStateReferenceNames: Set<string>;
  // Names that refer to either the original state object or data reachable
  // from it. Mutating any of these mutates the previous reducer state.
  mutableStateSourceNames: Set<string>;
  mutations: ReducerStateMutation[];
}

const cloneReducerPathState = (state: ReducerPathState): ReducerPathState => ({
  originalStateReferenceNames: new Set(state.originalStateReferenceNames),
  mutableStateSourceNames: new Set(state.mutableStateSourceNames),
  mutations: [...state.mutations],
});

const isSpecifierImportedFromReact = (node: EsTreeNode): boolean => {
  const parent = node.parent ?? null;
  return (
    parent !== null && isNodeOfType(parent, "ImportDeclaration") && parent.source.value === "react"
  );
};

// Matches `import { useReducer } from "react"` and aliased variants such as
// `import { useReducer as useReactReducer } from "react"`.
const isNamedReactUseReducerImportSpecifier = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "ImportSpecifier")) return false;
  if (!isSpecifierImportedFromReact(node)) return false;
  const imported = node.imported;
  if (isNodeOfType(imported, "Identifier")) return imported.name === "useReducer";
  if (isNodeOfType(imported, "Literal")) return imported.value === "useReducer";
  return false;
};

// Matches `import * as React from "react"` and default React imports that can
// be used as `React.useReducer(...)`.
const isReactNamespaceOrDefaultImportSpecifier = (node: EsTreeNode): boolean =>
  isSpecifierImportedFromReact(node) &&
  (isNodeOfType(node, "ImportNamespaceSpecifier") || isNodeOfType(node, "ImportDefaultSpecifier"));

// Verifies that a call expression is wired to React's useReducer import rather
// than a local helper, another library's hook, or Array.prototype.reduce.
const isCallToImportedReactUseReducer = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  const callee = node.callee;
  if (isNodeOfType(callee, "Identifier")) {
    const binding = findVariableInitializer(callee, callee.name);
    return Boolean(
      binding?.initializer && isNamedReactUseReducerImportSpecifier(binding.initializer),
    );
  }

  if (!isNodeOfType(callee, "MemberExpression")) return false;
  if (!isNodeOfType(callee.object, "Identifier")) return false;
  if (!isNodeOfType(callee.property, "Identifier")) return false;
  if (callee.property.name !== "useReducer") return false;

  const binding = findVariableInitializer(callee.object, callee.object.name);
  return Boolean(
    binding?.initializer && isReactNamespaceOrDefaultImportSpecifier(binding.initializer),
  );
};

// TODO(v2 - reducer wrappers): wrapper calls are skipped entirely today. If we
// later unwrap reducer wrappers, suppress known draft-producing wrappers like
// Immer `produce` / `useImmerReducer`, and only analyze wrappers whose semantics
// preserve plain reducer state.

// Matches static calls like `Object.assign(...)` or `Reflect.set(...)` and
// guards against the rare-but-real shadow case where a local binding
// hides the built-in:
//
//   import { Object } from "./my-types";           // type re-export shadow
//   const Object = require("./safe-object");       // utility shadow
//   function reducer(state, action) {
//     const Object = makeWrapper(state);           // path-local shadow
//     Object.assign(state, action.patch);         // ← would FP
//   }
//
// We resolve the identifier through `findVariableInitializer`: if it
// has a same-file binding the static call is treated as opaque and
// skipped. Only an unresolved (i.e. global) name passes through.
const isStaticMethodCallOnNamedObject = (
  node: EsTreeNode,
  objectName: string,
  methodNames: ReadonlySet<string>,
): boolean => {
  const unwrappedNode = stripParenExpression(node);
  if (!isNodeOfType(unwrappedNode, "CallExpression")) return false;
  if (!isNodeOfType(unwrappedNode.callee, "MemberExpression")) return false;
  const calleeObject = unwrappedNode.callee.object;
  if (!isNodeOfType(calleeObject, "Identifier")) return false;
  if (calleeObject.name !== objectName) return false;
  if (!methodNames.has(getStaticMemberPropertyName(unwrappedNode.callee) ?? "")) return false;
  // If the global name is shadowed by an in-scope binding, abstain.
  const shadow = findVariableInitializer(calleeObject, calleeObject.name);
  if (shadow) return false;
  return true;
};

// Determines whether an expression's root identifier is known to be the
// original reducer state, an alias to it, or a value reachable from it.
const isExpressionRootedInMutableReducerStateSource = (
  node: EsTreeNode,
  state: ReducerPathState,
): boolean => {
  let current: EsTreeNode | null | undefined = stripParenExpression(node);
  while (current && isNodeOfType(current, "MemberExpression")) {
    current = stripParenExpression(current.object);
  }
  return isNodeOfType(current, "Identifier") && state.mutableStateSourceNames.has(current.name);
};

const isExpressionOriginalReducerStateReference = (
  node: EsTreeNode | null | undefined,
  state: ReducerPathState,
): boolean => {
  if (!node) return false;
  const unwrappedNode = stripParenExpression(node);
  return (
    isNodeOfType(unwrappedNode, "Identifier") &&
    state.originalStateReferenceNames.has(unwrappedNode.name)
  );
};

// Captures assignments like `const items = state.items`, where mutating `items`
// still mutates data reachable from the original reducer state.
const isExpressionReachableFromOriginalReducerState = (
  node: EsTreeNode | null | undefined,
  state: ReducerPathState,
): boolean => {
  if (!node) return false;
  if (isExpressionOriginalReducerStateReference(node, state)) return true;
  const unwrappedNode = stripParenExpression(node);
  return (
    isNodeOfType(unwrappedNode, "MemberExpression") &&
    isExpressionRootedInMutableReducerStateSource(unwrappedNode, state)
  );
};

// Detects whether a return expression can hand React the original state object
// back, including conditional/logical expressions and APIs that return their
// receiver or first argument.
const canExpressionReturnOriginalReducerStateReference = (
  node: EsTreeNode | null | undefined,
  state: ReducerPathState,
): boolean => {
  if (!node) return false;
  const unwrappedNode = stripParenExpression(node);

  // Direct same-reference return:
  //
  //   return state;
  //   return alias;
  //
  // where `alias` was established by `const alias = state`.
  if (isExpressionOriginalReducerStateReference(unwrappedNode, state)) return true;

  if (isNodeOfType(unwrappedNode, "CallExpression")) {
    // Object.assign returns its first argument, so this is still a same-reference
    // return when the first argument is the original reducer state:
    //
    //   return Object.assign(state, patch);
    if (isNodeOfType(unwrappedNode.callee, "MemberExpression")) {
      const methodName = getStaticMemberPropertyName(unwrappedNode.callee);
      if (
        methodName === "assign" &&
        isNodeOfType(unwrappedNode.callee.object, "Identifier") &&
        unwrappedNode.callee.object.name === "Object"
      ) {
        return isExpressionOriginalReducerStateReference(unwrappedNode.arguments?.[0], state);
      }

      // In-place array methods like sort/reverse/fill return the same array
      // receiver. Only count this when the receiver is the top-level reducer
      // state or a top-level alias, not a nested array like `state.items`.
      if (
        methodName &&
        SAME_REFERENCE_ARRAY_RETURN_METHODS.has(methodName) &&
        isExpressionOriginalReducerStateReference(unwrappedNode.callee.object, state)
      ) {
        return true;
      }
      // Map#set and Set#add return the collection receiver. Only count this as
      // a top-level same-reference return when the receiver itself is the
      // reducer state reference, not merely a nested collection in a new wrapper.
      if (
        methodName &&
        SAME_REFERENCE_COLLECTION_RETURN_METHODS.has(methodName) &&
        isExpressionOriginalReducerStateReference(unwrappedNode.callee.object, state)
      ) {
        return true;
      }
    }
  }

  // Conditional/logical expressions may return the old state on just one side:
  //
  //   return changed ? { ...state } : state;
  //   return maybeNext || state;
  //
  // If any possible branch returns the original reference, a prior mutation on
  // this path is enough to report.
  if (isNodeOfType(unwrappedNode, "ConditionalExpression")) {
    return (
      canExpressionReturnOriginalReducerStateReference(unwrappedNode.consequent, state) ||
      canExpressionReturnOriginalReducerStateReference(unwrappedNode.alternate, state)
    );
  }

  if (isNodeOfType(unwrappedNode, "LogicalExpression")) {
    return (
      canExpressionReturnOriginalReducerStateReference(unwrappedNode.left, state) ||
      canExpressionReturnOriginalReducerStateReference(unwrappedNode.right, state)
    );
  }

  // Sequence expressions return their last expression, so earlier expressions
  // don't affect whether React receives the original state reference.
  if (isNodeOfType(unwrappedNode, "SequenceExpression")) {
    return canExpressionReturnOriginalReducerStateReference(
      unwrappedNode.expressions[unwrappedNode.expressions.length - 1],
      state,
    );
  }

  return false;
};

// Walks one statement/expression and records direct mutations of the original
// reducer state, aliases to it, or values reachable from it.
const collectReducerStateMutationsInExpressionOrStatement = (
  node: EsTreeNode,
  state: ReducerPathState,
): ReducerStateMutation[] => {
  // Nested reducer-local helpers are declarations, not code that runs on this
  // path. Their bodies may mutate a parameter named `state`, but that is a
  // different binding and should not be attributed to the outer reducer path.
  if (isFunctionLike(node)) return [];
  const mutations: ReducerStateMutation[] = [];
  walkAst(node, (child: EsTreeNode) => {
    const unwrappedChild = stripParenExpression(child);
    // Prune nested function bodies for the same reason: only collect mutations
    // that execute in the currently analyzed reducer path.
    if (child !== node && isFunctionLike(unwrappedChild)) return false;

    if (isNodeOfType(unwrappedChild, "AssignmentExpression")) {
      // Direct property writes mutate the previous state when their left-hand
      // side is rooted in the original state or a state-derived alias:
      //
      //   state.count = 1;
      //   alias.items[index] = item;
      if (
        isNodeOfType(stripParenExpression(unwrappedChild.left), "MemberExpression") &&
        isExpressionRootedInMutableReducerStateSource(unwrappedChild.left, state)
      ) {
        mutations.push({ node: unwrappedChild });
      }
      return;
    }

    if (isNodeOfType(unwrappedChild, "UpdateExpression")) {
      // Updates are writes too:
      //
      //   state.count++;
      //   --alias.count;
      if (
        isNodeOfType(stripParenExpression(unwrappedChild.argument), "MemberExpression") &&
        isExpressionRootedInMutableReducerStateSource(unwrappedChild.argument, state)
      ) {
        mutations.push({ node: unwrappedChild });
      }
      return;
    }

    if (isNodeOfType(unwrappedChild, "UnaryExpression") && unwrappedChild.operator === "delete") {
      // Deleting a property mutates the containing object:
      //
      //   delete state.items[id];
      if (
        isNodeOfType(stripParenExpression(unwrappedChild.argument), "MemberExpression") &&
        isExpressionRootedInMutableReducerStateSource(unwrappedChild.argument, state)
      ) {
        mutations.push({ node: unwrappedChild });
      }
      return;
    }

    if (!isNodeOfType(unwrappedChild, "CallExpression")) return;
    const firstArgument = unwrappedChild.arguments?.[0];
    // Built-in object APIs mutate their first argument:
    //
    //   Object.assign(state, patch);
    //   Reflect.set(state, key, value);
    //
    // Only count them when that first argument is rooted in reducer state.
    if (
      firstArgument &&
      isExpressionRootedInMutableReducerStateSource(firstArgument, state) &&
      (isStaticMethodCallOnNamedObject(unwrappedChild, "Object", OBJECT_MUTATION_METHODS) ||
        isStaticMethodCallOnNamedObject(unwrappedChild, "Reflect", REFLECT_MUTATION_METHODS))
    ) {
      mutations.push({ node: unwrappedChild });
      return;
    }
    // Lodash mutators take the target object as their first argument:
    //
    //   _.set(state, "user.name", "Ada");
    //   set(state, "user.name", "Ada");
    //
    // Resolved via `findVariableInitializer` so we only fire when the
    // callee resolves back to an import from the mutating lodash
    // package (NOT lodash/fp, which is non-mutating).
    if (
      firstArgument &&
      isExpressionRootedInMutableReducerStateSource(firstArgument, state) &&
      isLodashMutatorCall(unwrappedChild)
    ) {
      mutations.push({ node: unwrappedChild });
      return;
    }
    if (!isNodeOfType(unwrappedChild.callee, "MemberExpression")) return;
    const methodName = getStaticMemberPropertyName(unwrappedChild.callee);
    // Receiver-mutating methods mutate the object/array/collection they are
    // called on. We only record them when the receiver is state-derived:
    //
    //   state.items.push(item);
    //   items.splice(index, 1);
    //   stateMap.set(key, value);
    //
    // Collection method names like `set` and `add` are assumed mutating
    // when called on state-derived values. The residual false-positive
    // risk is when state holds a custom immutable-API value whose
    // `.set`/`.add`/`.delete` return a NEW container (Immutable.js
    // Map, Mori, persistent collections). Distinguishing those from
    // Map/Set requires TS type info which the lint pipeline doesn't
    // have. In practice the discard-the-result-of-an-immutable-API
    // pattern is itself a bug, so this rule's diagnostic still points
    // at code that needs attention.
    if (
      !methodName ||
      (!MUTATING_ARRAY_METHODS.has(methodName) && !MUTATING_COLLECTION_METHODS.has(methodName))
    )
      return;
    if (isExpressionRootedInMutableReducerStateSource(unwrappedChild.callee.object, state)) {
      mutations.push({ node: unwrappedChild });
    }
  });
  return mutations;
};

const collectBlockScopedBindingNames = (
  blockStatement: EsTreeNodeOfType<"BlockStatement">,
): Set<string> => {
  const blockScopedBindingNames = new Set<string>();
  for (const statement of blockStatement.body ?? []) {
    if (!isNodeOfType(statement, "VariableDeclaration")) continue;
    if (statement.kind !== "let" && statement.kind !== "const") continue;
    for (const declarator of statement.declarations ?? []) {
      collectPatternNames(declarator.id, blockScopedBindingNames);
    }
  }
  return blockScopedBindingNames;
};

const restoreOuterIdentityForBlockScopedNames = (
  blockState: ReducerPathState,
  outerState: ReducerPathState,
  blockScopedBindingNames: ReadonlySet<string>,
): ReducerPathState => {
  const nextState = cloneReducerPathState(blockState);
  for (const name of blockScopedBindingNames) {
    if (outerState.originalStateReferenceNames.has(name)) {
      nextState.originalStateReferenceNames.add(name);
    } else {
      nextState.originalStateReferenceNames.delete(name);
    }
    if (outerState.mutableStateSourceNames.has(name)) {
      nextState.mutableStateSourceNames.add(name);
    } else {
      nextState.mutableStateSourceNames.delete(name);
    }
  }
  return nextState;
};

// Walks a destructure pattern, marking each binding as reachable
// from the reducer state when the surrounding initializer is itself
// reachable. The names added to `mutableStateSourceNames` lose their
// original-identity status: `const { items } = state` means
// `items === state.items`, which is reachable but NOT the same
// top-level reference React compares — only mutations through it
// matter.
//
// Conservative scope: only ObjectPattern + ArrayPattern with
// Identifier / AssignmentPattern leaves. Nested patterns (e.g.
// `const { a: { b } } = state`) are NOT modelled — those rebind
// `b` to `state.a.b`, also reachable, but the second-level recursion
// adds noise without a clear win. The single-level case is the
// canonical Redux reducer pattern.
const recordDestructuredAliasNames = (pattern: EsTreeNode, state: ReducerPathState): void => {
  if (isNodeOfType(pattern, "ObjectPattern")) {
    for (const property of pattern.properties ?? []) {
      if (!isNodeOfType(property, "Property")) continue;
      const valueNode = property.value;
      // `const { items } = state`         (shorthand)        → Identifier
      // `const { items: localItems } = state`               → Identifier
      // `const { items = [] } = state`                     → AssignmentPattern wrapping Identifier
      // `const { items: localItems = [] } = state`         → AssignmentPattern wrapping Identifier
      let leafIdentifier: EsTreeNodeOfType<"Identifier"> | null = null;
      if (isNodeOfType(valueNode, "Identifier")) {
        leafIdentifier = valueNode;
      } else if (
        isNodeOfType(valueNode, "AssignmentPattern") &&
        isNodeOfType(valueNode.left, "Identifier")
      ) {
        leafIdentifier = valueNode.left;
      }
      if (!leafIdentifier) continue;
      state.mutableStateSourceNames.add(leafIdentifier.name);
    }
    return;
  }
  if (isNodeOfType(pattern, "ArrayPattern")) {
    for (const element of pattern.elements ?? []) {
      if (!element) continue;
      if (isNodeOfType(element, "Identifier")) {
        state.mutableStateSourceNames.add(element.name);
        continue;
      }
      if (isNodeOfType(element, "AssignmentPattern") && isNodeOfType(element.left, "Identifier")) {
        state.mutableStateSourceNames.add(element.left.name);
        continue;
      }
      if (isNodeOfType(element, "RestElement") && isNodeOfType(element.argument, "Identifier")) {
        // `const [first, ...rest] = state.items` — `rest` is a fresh
        // array (slice copy at runtime), not reachable from state.
        // Intentionally NOT added.
      }
    }
  }
};

const updateReducerStateIdentityForVariableDeclaration = (
  declaration: EsTreeNodeOfType<"VariableDeclaration">,
  state: ReducerPathState,
): void => {
  for (const declarator of declaration.declarations ?? []) {
    if (isNodeOfType(declarator.id, "Identifier")) {
      const name = declarator.id.name;
      state.originalStateReferenceNames.delete(name);
      state.mutableStateSourceNames.delete(name);

      if (isExpressionOriginalReducerStateReference(declarator.init, state)) {
        state.originalStateReferenceNames.add(name);
        state.mutableStateSourceNames.add(name);
        continue;
      }

      if (isExpressionReachableFromOriginalReducerState(declarator.init, state)) {
        state.mutableStateSourceNames.add(name);
      }
      continue;
    }

    // Destructure off the original state object (or anything reachable from
    // it). Each top-level binding becomes a new alias reachable from state.
    if (
      (isNodeOfType(declarator.id, "ObjectPattern") ||
        isNodeOfType(declarator.id, "ArrayPattern")) &&
      isExpressionReachableFromOriginalReducerState(declarator.init, state)
    ) {
      recordDestructuredAliasNames(declarator.id, state);
    }
  }
};

// Handles rebinding like `alias = state` or `state = { ...state }`; the latter
// removes the identifier from the original-reference set for this path.
const updateReducerStateIdentityForIdentifierAssignment = (
  assignment: EsTreeNodeOfType<"AssignmentExpression">,
  state: ReducerPathState,
): void => {
  if (!isNodeOfType(assignment.left, "Identifier")) return;
  const name = assignment.left.name;
  state.originalStateReferenceNames.delete(name);
  state.mutableStateSourceNames.delete(name);

  if (isExpressionOriginalReducerStateReference(assignment.right, state)) {
    state.originalStateReferenceNames.add(name);
    state.mutableStateSourceNames.add(name);
    return;
  }

  if (isExpressionReachableFromOriginalReducerState(assignment.right, state)) {
    state.mutableStateSourceNames.add(name);
  }
};

interface AnalyzeOptions {
  // The consumer file's `useReducer(reducer, ...)` CallExpression.
  // Used as the diagnostic anchor when the reducer body lives in
  // ANOTHER file (cross-file resolution) — without this, the
  // diagnostic's line/column would point at locations inside the
  // imported reducer file, which IDEs / GitHub annotations would
  // attach to the consumer file by mistake.
  readonly crossFileConsumerCallSite: EsTreeNode | null;
  // Display string for the source file path (relative to the
  // consumer when possible, absolute otherwise) — woven into the
  // diagnostic message when cross-file.
  readonly crossFileSourceDisplay: string | null;
}

// Walks a reducer body one path at a time. If a path changes old state and then
// returns that same old state, we report the change.
const analyzeReactUseReducerFunctionForStateMutation = (
  context: RuleContext,
  functionNode: EsTreeNode,
  reportedNodes: WeakSet<EsTreeNode>,
  options: AnalyzeOptions,
): void => {
  if (!isFunctionLike(functionNode) || !isNodeOfType(functionNode.body, "BlockStatement")) return;

  const firstParam = functionNode.params?.[0];
  const stateName = isNodeOfType(firstParam, "Identifier")
    ? firstParam.name
    : isNodeOfType(firstParam, "AssignmentPattern") && isNodeOfType(firstParam.left, "Identifier")
      ? firstParam.left.name
      : null;
  if (!stateName) return;

  const reportReducerStateMutations = (mutations: ReducerStateMutation[]): void => {
    if (mutations.length === 0) return;

    if (options.crossFileConsumerCallSite && options.crossFileSourceDisplay) {
      // Every cross-file diagnostic anchors at the SAME consumer
      // `useReducer` call (so the editor / CI annotation lands in the
      // file being linted). Collapse them to one report keyed on that
      // call site — multiple mutations or returning paths in the
      // imported reducer must not stack identical annotations.
      if (reportedNodes.has(options.crossFileConsumerCallSite)) return;
      reportedNodes.add(options.crossFileConsumerCallSite);
      context.report({
        node: options.crossFileConsumerCallSite,
        message: `${MESSAGE} (mutation in imported reducer at \`${options.crossFileSourceDisplay}\`)`,
      });
      return;
    }

    for (const mutation of mutations) {
      if (reportedNodes.has(mutation.node)) continue;
      reportedNodes.add(mutation.node);
      context.report({ node: mutation.node, message: MESSAGE });
    }
  };

  // A reducer with N sequential non-returning `if`s forks 2^N path
  // states. Once the active-path count blows past the limit we stop
  // forking and bail — missing diagnostics in a pathological reducer
  // is acceptable; runaway time / memory is not. Shared across the
  // recursive calls below.
  let pathBudgetExceeded = false;

  const analyzeReducerStatementListByPath = (
    statements: EsTreeNode[],
    initialState: ReducerPathState,
  ): ReducerPathState[] => {
    if (pathBudgetExceeded) return [cloneReducerPathState(initialState)];
    let activeStates = [cloneReducerPathState(initialState)];

    for (const statement of statements) {
      if (activeStates.length > REDUCER_PATH_STATE_LIMIT) {
        pathBudgetExceeded = true;
        break;
      }
      const nextStates: ReducerPathState[] = [];

      for (const activeState of activeStates) {
        if (isNodeOfType(statement, "ReturnStatement")) {
          // Some returns mutate as they return, like `return state.sort(...)`.
          const returnMutations = collectReducerStateMutationsInExpressionOrStatement(
            statement,
            activeState,
          );
          const mutationsAtReturn = [...activeState.mutations, ...returnMutations];
          if (canExpressionReturnOriginalReducerStateReference(statement.argument, activeState)) {
            reportReducerStateMutations(mutationsAtReturn);
          }
          continue;
        }

        if (isNodeOfType(statement, "IfStatement")) {
          // An if statement cannot use the generic statement path: the
          // consequent and alternate are separate possible paths. Therefore,
          // each branch is evaluated from the state after the condition runs.
          const conditionState = cloneReducerPathState(activeState);
          conditionState.mutations.push(
            ...collectReducerStateMutationsInExpressionOrStatement(statement.test, conditionState),
          );
          const consequentStates = analyzeReducerStatementListByPath(
            isNodeOfType(statement.consequent, "BlockStatement")
              ? statement.consequent.body
              : [statement.consequent],
            conditionState,
          );

          const alternateStates = statement.alternate
            ? analyzeReducerStatementListByPath(
                isNodeOfType(statement.alternate, "BlockStatement")
                  ? statement.alternate.body
                  : [statement.alternate],
                conditionState,
              )
            : [cloneReducerPathState(conditionState)];

          nextStates.push(...consequentStates, ...alternateStates);
          continue;
        }

        if (isNodeOfType(statement, "SwitchStatement")) {
          // A switch cannot use the generic statement path: each case is a
          // separate possible path, and cases can fall through into later cases.
          // Therefore, each possible starting case is evaluated separately.
          const discriminantState = cloneReducerPathState(activeState);
          discriminantState.mutations.push(
            ...collectReducerStateMutationsInExpressionOrStatement(
              statement.discriminant,
              discriminantState,
            ),
          );
          const switchCases = statement.cases ?? [];
          if (!switchCases.some((switchCase) => switchCase.test === null)) {
            nextStates.push(cloneReducerPathState(discriminantState));
          }
          for (let startIndex = 0; startIndex < switchCases.length; startIndex += 1) {
            const fallthroughStatements: EsTreeNode[] = [];
            for (let caseIndex = startIndex; caseIndex < switchCases.length; caseIndex += 1) {
              let didHitBreak = false;
              for (const caseStatement of switchCases[caseIndex].consequent ?? []) {
                if (isNodeOfType(caseStatement, "BreakStatement")) {
                  didHitBreak = true;
                  break;
                }
                fallthroughStatements.push(caseStatement);
              }
              if (didHitBreak) break;
            }
            nextStates.push(
              ...analyzeReducerStatementListByPath(fallthroughStatements, discriminantState),
            );
          }
          continue;
        }

        if (isNodeOfType(statement, "BlockStatement")) {
          // Keep outer identity changes from the block, but don't leak aliases
          // created by block-scoped declarations.
          const blockScopedBindingNames = collectBlockScopedBindingNames(statement);
          const blockStates = analyzeReducerStatementListByPath(statement.body, activeState);
          for (const blockState of blockStates) {
            nextStates.push(
              restoreOuterIdentityForBlockScopedNames(
                blockState,
                activeState,
                blockScopedBindingNames,
              ),
            );
          }
          continue;
        }

        const nextState = cloneReducerPathState(activeState);
        nextState.mutations.push(
          ...collectReducerStateMutationsInExpressionOrStatement(statement, nextState),
        );

        if (isNodeOfType(statement, "VariableDeclaration")) {
          updateReducerStateIdentityForVariableDeclaration(statement, nextState);
        } else if (
          isNodeOfType(statement, "ExpressionStatement") &&
          isNodeOfType(statement.expression, "AssignmentExpression")
        ) {
          updateReducerStateIdentityForIdentifierAssignment(statement.expression, nextState);
        }

        nextStates.push(nextState);
      }

      activeStates = nextStates;
      if (activeStates.length === 0) break;
    }

    return activeStates;
  };

  analyzeReducerStatementListByPath(functionNode.body.body, {
    originalStateReferenceNames: new Set([stateName]),
    mutableStateSourceNames: new Set([stateName]),
    mutations: [],
  });
};

export const noMutatingReducerState = defineRule<Rule>({
  id: "no-mutating-reducer-state",
  title: "Reducer mutates its state",
  severity: "error",
  recommendation:
    "Return a new state object from the reducer instead of changing the old one and returning it. React only notices the change when the object is new.",
  create: (context: RuleContext) => {
    const analyzedReducers = new WeakSet<EsTreeNode>();
    const reportedNodes = new WeakSet<EsTreeNode>();
    const currentFilename = context.filename;

    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        // Pipeline:
        // 1. accept only calls proven to be React's imported useReducer;
        // 2. resolve the reducer body — local to this file OR imported
        //    from a sibling file via relative path / barrel re-export;
        // 3. analyze that reducer once, reporting mutations only when a path
        //    returns the original state reference. Cross-file diagnostics
        //    are anchored at the consumer's `useReducer` call so editor /
        //    CI annotations land in the correct file.
        if (!isCallToImportedReactUseReducer(node)) return;
        const resolved = resolveReducerFunction(node.arguments?.[0], currentFilename);
        if (!resolved) return;
        if (analyzedReducers.has(resolved.functionNode)) return;
        analyzedReducers.add(resolved.functionNode);
        analyzeReactUseReducerFunctionForStateMutation(
          context,
          resolved.functionNode,
          reportedNodes,
          {
            crossFileConsumerCallSite: resolved.crossFileSourceDisplay ? node : null,
            crossFileSourceDisplay: resolved.crossFileSourceDisplay,
          },
        );
      },
    };
  },
});
