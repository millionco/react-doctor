import { defineRule } from "../../utils/define-rule.js";
import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { getStaticMemberPropertyName } from "./utils/static-member-property-name.js";

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
// TODO(v2 - destructured aliases): aliases created by destructuring, such as
// `const { items } = state`, are skipped for now. Add pattern-aware alias
// tracking before diagnosing mutations through those names.
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

// Resolves only reducer bodies already present in this file. Imported reducer
// identifiers resolve to import specifiers, not function bodies, and are skipped
// per the v1 module-resolution limitation documented above.
// TODO(v2 - reducer wrappers): wrapper calls are skipped entirely today. If we
// later unwrap reducer wrappers, suppress known draft-producing wrappers like
// Immer `produce` / `useImmerReducer`, and only analyze wrappers whose semantics
// preserve plain reducer state.
const resolveSameFileReducerFunction = (node: EsTreeNode | null | undefined): EsTreeNode | null => {
  if (!node) return null;
  const unwrappedNode = stripParenExpression(node);
  if (isFunctionLikeAstNode(unwrappedNode)) return unwrappedNode;
  if (!isNodeOfType(unwrappedNode, "Identifier")) return null;

  const binding = findVariableInitializer(unwrappedNode, unwrappedNode.name);
  const initializer = binding?.initializer;
  if (!initializer) return null;
  const unwrappedInitializer = stripParenExpression(initializer);
  return isFunctionLikeAstNode(unwrappedInitializer) ? unwrappedInitializer : null;
};

// Matches static calls like `Object.assign(...)` or `Reflect.set(...)` without
// resolving bindings. This is intentionally limited to built-in global names.
// TODO(v2 - global shadowing): check scope bindings before treating Object or
// Reflect as built-ins if false positives show up in real code.
const isStaticMethodCallOnNamedObject = (
  node: EsTreeNode,
  objectName: string,
  methodNames: ReadonlySet<string>,
): boolean => {
  const unwrappedNode = stripParenExpression(node);
  return Boolean(
    isNodeOfType(unwrappedNode, "CallExpression") &&
    isNodeOfType(unwrappedNode.callee, "MemberExpression") &&
    isNodeOfType(unwrappedNode.callee.object, "Identifier") &&
    unwrappedNode.callee.object.name === objectName &&
    methodNames.has(getStaticMemberPropertyName(unwrappedNode.callee) ?? ""),
  );
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
  if (isFunctionLikeAstNode(node)) return [];
  const mutations: ReducerStateMutation[] = [];
  walkAst(node, (child: EsTreeNode) => {
    const unwrappedChild = stripParenExpression(child);
    // Prune nested function bodies for the same reason: only collect mutations
    // that execute in the currently analyzed reducer path.
    if (child !== node && isFunctionLikeAstNode(unwrappedChild)) return false;

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
    if (!isNodeOfType(unwrappedChild.callee, "MemberExpression")) return;
    const methodName = getStaticMemberPropertyName(unwrappedChild.callee);
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
