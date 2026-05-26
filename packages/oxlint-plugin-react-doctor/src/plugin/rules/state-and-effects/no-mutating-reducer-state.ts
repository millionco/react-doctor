import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";

const MESSAGE =
  "Reducer mutates its current state and returns the same reference. Return a copied object or array so React can observe the update.";

const MUTATING_ARRAY_METHODS = new Set([
  "copyWithin",
  "fill",
  "pop",
  "push",
  "reverse",
  "shift",
  "sort",
  "splice",
  "unshift",
]);

const MUTATING_COLLECTION_METHODS = new Set(["add", "clear", "delete", "set"]);

const SAME_REFERENCE_ARRAY_RETURN_METHODS = new Set(["copyWithin", "fill", "reverse", "sort"]);

const SAME_REFERENCE_COLLECTION_RETURN_METHODS = new Set(["add", "set"]);

const OBJECT_MUTATION_METHODS = new Set(["assign", "defineProperties", "defineProperty"]);

const REFLECT_MUTATION_METHODS = new Set(["deleteProperty", "set"]);

const OBJECT_ASSIGN_METHOD = new Set(["assign"]);

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
// TODO(v2 - module resolution): reducer bodies must currently be present in the
// same file. Imported reducer identifiers are intentionally skipped instead of
// followed through the module graph. Cross-file resolution would need to handle
// barrels, TS path aliases, package exports, generated files, duplicate reports
// for one reducer used in many components, and performance caps. Treat imported
// reducers as coverage gaps until this rule has a dedicated module-resolution
// pass.
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

// Narrows the generic AST node to the function shapes that can be passed to
// React.useReducer as reducer functions.
const isFunctionLikeAstNode = (
  node: EsTreeNode | null | undefined,
): node is
  | EsTreeNodeOfType<"FunctionDeclaration">
  | EsTreeNodeOfType<"FunctionExpression">
  | EsTreeNodeOfType<"ArrowFunctionExpression"> =>
  Boolean(
    node &&
      (isNodeOfType(node, "FunctionDeclaration") ||
        isNodeOfType(node, "FunctionExpression") ||
        isNodeOfType(node, "ArrowFunctionExpression")),
  );

const isSpecifierImportedFromReact = (node: EsTreeNode): boolean => {
  const parent = node.parent;
  return (
    parent !== null &&
    parent !== undefined &&
    isNodeOfType(parent, "ImportDeclaration") &&
    parent.source.value === "react"
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
    return Boolean(binding?.initializer && isNamedReactUseReducerImportSpecifier(binding.initializer));
  }

  if (!isNodeOfType(callee, "MemberExpression")) return false;
  if (!isNodeOfType(callee.object, "Identifier")) return false;
  if (!isNodeOfType(callee.property, "Identifier")) return false;
  if (callee.property.name !== "useReducer") return false;

  const binding = findVariableInitializer(callee.object, callee.object.name);
  return Boolean(binding?.initializer && isReactNamespaceOrDefaultImportSpecifier(binding.initializer));
};

// Resolves only reducer bodies already present in this file. Imported reducer
// identifiers resolve to import specifiers, not function bodies, and are skipped
// per the v1 module-resolution limitation documented above.
// TODO(v2 - reducer wrappers): wrapper calls are skipped entirely today. If we
// later unwrap reducer wrappers, suppress known draft-producing wrappers like
// Immer `produce` / `useImmerReducer`, and only analyze wrappers whose semantics
// preserve plain reducer state.
const resolveSameFileReducerFunction = (node: EsTreeNode | null | undefined): EsTreeNode | null => {
  if (!node) return null;
  if (isFunctionLikeAstNode(node)) return node;
  if (!isNodeOfType(node, "Identifier")) return null;

  const binding = findVariableInitializer(node, node.name);
  const initializer = binding?.initializer;
  return isFunctionLikeAstNode(initializer) ? initializer : null;
};

// Reads member names from static member access (`state.items.push` -> `push`,
// `state["items"]` -> `items`) while ignoring dynamic computed properties.
const getStaticMemberPropertyName = (node: EsTreeNode | null | undefined): string | null => {
  if (!node || !isNodeOfType(node, "MemberExpression")) return null;
  if (isNodeOfType(node.property, "Identifier")) return node.property.name;
  if (isNodeOfType(node.property, "Literal") && typeof node.property.value === "string") {
    return node.property.value;
  }
  return null;
};

// Matches static calls like `Object.assign(...)` or `Reflect.set(...)` without
// resolving bindings. This is intentionally limited to built-in global names.
// TODO(v2 - global shadowing): check scope bindings before treating Object or
// Reflect as built-ins if false positives show up in real code.
const isStaticMethodCallOnNamedObject = (
  node: EsTreeNode,
  objectName: string,
  methodNames: ReadonlySet<string>,
): boolean =>
  Boolean(
    isNodeOfType(node, "CallExpression") &&
      isNodeOfType(node.callee, "MemberExpression") &&
      isNodeOfType(node.callee.object, "Identifier") &&
      node.callee.object.name === objectName &&
      isNodeOfType(node.callee.property, "Identifier") &&
      methodNames.has(node.callee.property.name),
  );

// Determines whether an expression's root identifier is known to be the
// original reducer state, an alias to it, or a value reachable from it.
const isExpressionRootedInMutableReducerStateSource = (
  node: EsTreeNode,
  state: ReducerPathState,
): boolean => {
  let current: EsTreeNode | null | undefined = node;
  while (current && isNodeOfType(current, "MemberExpression")) {
    current = current.object;
  }
  return (
    isNodeOfType(current, "Identifier") && state.mutableStateSourceNames.has(current.name)
  );
};

const isExpressionOriginalReducerStateReference = (
  node: EsTreeNode | null | undefined,
  state: ReducerPathState,
): boolean => isNodeOfType(node, "Identifier") && state.originalStateReferenceNames.has(node.name);

// Captures assignments like `const items = state.items`, where mutating `items`
// still mutates data reachable from the original reducer state.
const isExpressionReachableFromOriginalReducerState = (
  node: EsTreeNode | null | undefined,
  state: ReducerPathState,
): boolean => {
  if (!node) return false;
  if (isExpressionOriginalReducerStateReference(node, state)) return true;
  return (
    isNodeOfType(node, "MemberExpression") &&
    isExpressionRootedInMutableReducerStateSource(node, state)
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

  // Direct same-reference return:
  //
  //   return state;
  //   return alias;
  //
  // where `alias` was established by `const alias = state`.
  if (isExpressionOriginalReducerStateReference(node, state)) return true;

  if (isNodeOfType(node, "CallExpression")) {
    // Object.assign returns its first argument, so this is still a same-reference
    // return when the first argument is the original reducer state:
    //
    //   return Object.assign(state, patch);
    if (isStaticMethodCallOnNamedObject(node, "Object", OBJECT_ASSIGN_METHOD)) {
      return isExpressionOriginalReducerStateReference(node.arguments?.[0], state);
    }

    if (isNodeOfType(node.callee, "MemberExpression")) {
      const methodName = getStaticMemberPropertyName(node.callee);
      // In-place array methods like sort/reverse/fill return the same array
      // receiver. If that receiver is the reducer state or a state-derived
      // array alias, React still receives the old reference.
      if (
        methodName &&
        SAME_REFERENCE_ARRAY_RETURN_METHODS.has(methodName) &&
        isExpressionRootedInMutableReducerStateSource(node.callee.object, state)
      ) {
        return true;
      }
      // Map#set and Set#add return the collection receiver. Only count this as
      // a top-level same-reference return when the receiver itself is the
      // reducer state reference, not merely a nested collection in a new wrapper.
      if (
        methodName &&
        SAME_REFERENCE_COLLECTION_RETURN_METHODS.has(methodName) &&
        isExpressionOriginalReducerStateReference(node.callee.object, state)
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
  if (isNodeOfType(node, "ConditionalExpression")) {
    return (
      canExpressionReturnOriginalReducerStateReference(node.consequent, state) ||
      canExpressionReturnOriginalReducerStateReference(node.alternate, state)
    );
  }

  if (isNodeOfType(node, "LogicalExpression")) {
    return (
      canExpressionReturnOriginalReducerStateReference(node.left, state) ||
      canExpressionReturnOriginalReducerStateReference(node.right, state)
    );
  }

  // Sequence expressions return their last expression, so earlier expressions
  // don't affect whether React receives the original state reference.
  if (isNodeOfType(node, "SequenceExpression")) {
    return canExpressionReturnOriginalReducerStateReference(
      node.expressions[node.expressions.length - 1],
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
  if (isFunctionLikeAstNode(node)) return [];
  const mutations: ReducerStateMutation[] = [];
  walkAst(node, (child: EsTreeNode) => {
    // Prune nested function bodies for the same reason: only collect mutations
    // that execute in the currently analyzed reducer path.
    if (child !== node && isFunctionLikeAstNode(child)) return false;

    if (isNodeOfType(child, "AssignmentExpression")) {
      // Direct property writes mutate the previous state when their left-hand
      // side is rooted in the original state or a state-derived alias:
      //
      //   state.count = 1;
      //   alias.items[index] = item;
      if (
        isNodeOfType(child.left, "MemberExpression") &&
        isExpressionRootedInMutableReducerStateSource(child.left, state)
      ) {
        mutations.push({ node: child });
      }
      return;
    }

    if (isNodeOfType(child, "UpdateExpression")) {
      // Updates are writes too:
      //
      //   state.count++;
      //   --alias.count;
      if (
        isNodeOfType(child.argument, "MemberExpression") &&
        isExpressionRootedInMutableReducerStateSource(child.argument, state)
      ) {
        mutations.push({ node: child });
      }
      return;
    }

    if (isNodeOfType(child, "UnaryExpression") && child.operator === "delete") {
      // Deleting a property mutates the containing object:
      //
      //   delete state.items[id];
      if (
        isNodeOfType(child.argument, "MemberExpression") &&
        isExpressionRootedInMutableReducerStateSource(child.argument, state)
      ) {
        mutations.push({ node: child });
      }
      return;
    }

    if (!isNodeOfType(child, "CallExpression")) return;
    const firstArgument = child.arguments?.[0];
    // Built-in object APIs mutate their first argument:
    //
    //   Object.assign(state, patch);
    //   Reflect.set(state, key, value);
    //
    // Only count them when that first argument is rooted in reducer state.
    if (
      firstArgument &&
      isExpressionRootedInMutableReducerStateSource(firstArgument, state) &&
      (isStaticMethodCallOnNamedObject(child, "Object", OBJECT_MUTATION_METHODS) ||
        isStaticMethodCallOnNamedObject(child, "Reflect", REFLECT_MUTATION_METHODS))
    ) {
      mutations.push({ node: child });
      return;
    }
    if (!isNodeOfType(child.callee, "MemberExpression")) return;
    const methodName = getStaticMemberPropertyName(child.callee);
    // Receiver-mutating methods mutate the object/array/collection they are
    // called on. We only record them when the receiver is state-derived:
    //
    //   state.items.push(item);
    //   items.splice(index, 1);
    //   stateMap.set(key, value);
    //
    // TODO(v2 - type-aware receivers): collection method names like `set` and
    // `add` are assumed mutating when called on state-derived values. Type
    // information could distinguish real Map/Set receivers from custom
    // immutable APIs that happen to use the same names.
    if (
      !methodName ||
      (!MUTATING_ARRAY_METHODS.has(methodName) && !MUTATING_COLLECTION_METHODS.has(methodName))
    )
      return;
    if (isExpressionRootedInMutableReducerStateSource(child.callee.object, state)) {
      mutations.push({ node: child });
    }
  });
  return mutations;
};

const updateReducerStateIdentityForVariableDeclaration = (
  declaration: EsTreeNodeOfType<"VariableDeclaration">,
  state: ReducerPathState,
): void => {
  for (const declarator of declaration.declarations ?? []) {
    if (!isNodeOfType(declarator.id, "Identifier")) continue;
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

// Walks a reducer body one path at a time. If a path changes old state and then
// returns that same old state, we report the change.
const analyzeReactUseReducerFunctionForStateMutation = (
  context: RuleContext,
  functionNode: EsTreeNode,
  reportedNodes: WeakSet<EsTreeNode>,
): void => {
  if (!isFunctionLikeAstNode(functionNode) || !isNodeOfType(functionNode.body, "BlockStatement"))
    return;

  const firstParam = functionNode.params?.[0];
  const stateName = isNodeOfType(firstParam, "Identifier")
    ? firstParam.name
    : isNodeOfType(firstParam, "AssignmentPattern") && isNodeOfType(firstParam.left, "Identifier")
      ? firstParam.left.name
      : null;
  if (!stateName) return;

  const reportReducerStateMutations = (mutations: ReducerStateMutation[]): void => {
    for (const mutation of mutations) {
      if (reportedNodes.has(mutation.node)) continue;
      reportedNodes.add(mutation.node);
      context.report({ node: mutation.node, message: MESSAGE });
    }
  };

  const analyzeReducerStatementListByPath = (
    statements: EsTreeNode[],
    initialState: ReducerPathState,
  ): ReducerPathState[] => {
    let activeStates = [cloneReducerPathState(initialState)];

    for (const statement of statements) {
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
          // The condition runs before either branch.
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
          // The switch value runs before any case.
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
            nextStates.push(...analyzeReducerStatementListByPath(fallthroughStatements, discriminantState));
          }
          continue;
        }

        if (isNodeOfType(statement, "BlockStatement")) {
          // Keep mutations from the block, but don't leak block-local aliases.
          const blockStates = analyzeReducerStatementListByPath(statement.body, activeState);
          for (const blockState of blockStates) {
            const nextState = cloneReducerPathState(activeState);
            nextState.mutations.push(
              ...blockState.mutations.filter((mutation) => !activeState.mutations.includes(mutation)),
            );
            nextStates.push(nextState);
          }
          continue;
        }

        // Ordinary statements may mutate state and may also introduce aliases.
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
  severity: "error",
  recommendation:
    "Return a new reducer state object instead of mutating the current state and returning the same reference. React uses object identity to decide whether reducer state changed.",
  create: (context: RuleContext) => {
    const analyzedReducers = new WeakSet<EsTreeNode>();
    const reportedNodes = new WeakSet<EsTreeNode>();

    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        // Pipeline:
        // 1. accept only calls proven to be React's imported useReducer;
        // 2. resolve the reducer body when it is local to this file;
        // 3. analyze that reducer once, reporting mutations only when a path
        //    returns the original state reference.
        if (!isCallToImportedReactUseReducer(node)) return;
        const reducerFunction = resolveSameFileReducerFunction(node.arguments?.[0]);
        if (!reducerFunction || analyzedReducers.has(reducerFunction)) return;
        analyzedReducers.add(reducerFunction);
        analyzeReactUseReducerFunctionForStateMutation(context, reducerFunction, reportedNodes);
      },
    };
  },
});
