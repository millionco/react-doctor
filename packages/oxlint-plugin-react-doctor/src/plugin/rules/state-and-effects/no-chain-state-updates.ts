import { BUILTIN_GLOBAL_NAMESPACE_NAMES } from "../../constants/js.js";
import { defineRule } from "../../utils/define-rule.js";
import { getReactUseCallbackCall } from "../../utils/get-react-use-callback-call.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { Reference } from "eslint-scope";
import {
  getArgsUpstreamRefs,
  getCallExpr,
  getDownstreamRefs,
  getEventualCallRefsTo,
  getRef,
  getUpstreamRefs,
} from "./utils/effect/ast.js";
import { readsPostMountValueThroughLocals } from "./utils/reads-post-mount-through-locals.js";
import { createStateTriggerReachability } from "./utils/create-state-trigger-reachability.js";
import { collectEffectStateWriteFacts } from "./utils/collect-effect-state-write-facts.js";
import { isExternallyDrivenState } from "./utils/effect/external-state.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import type { ProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import {
  getEffectDepsRefs,
  getEffectFn,
  getEffectFnRefs,
  hasCleanup,
  isState,
  isSyncStateSetterCall,
  resolveStateSetterReference,
} from "./utils/effect/react.js";

// Port of upstream `src/rules/no-chain-state-updates.js`, plus the
// guarded-self-sync exemption below (prod telemetry review 2026-07).

const APPLICABLE_EFFECT_HOOK_NAMES: ReadonlySet<string> = new Set(["useEffect", "useLayoutEffect"]);

const getUseStateDeclarator = (ref: Reference): EsTreeNode | null =>
  (ref.resolved?.defs ?? [])
    .map((def) => def.node as unknown as EsTreeNode)
    .find(
      (node) => isNodeOfType(node, "VariableDeclarator") && isNodeOfType(node.id, "ArrayPattern"),
    ) ?? null;

const isDeclaredWithin = (node: EsTreeNode, container: EsTreeNode): boolean => {
  let walker: EsTreeNode | null | undefined = node;
  while (walker) {
    if (walker === container) return true;
    walker = (walker as unknown as { parent?: EsTreeNode | null }).parent;
  }
  return false;
};

const isBuiltinNamespaceCallee = (callee: EsTreeNode | null | undefined): boolean => {
  if (!callee) return false;
  if (isNodeOfType(callee, "Identifier")) return BUILTIN_GLOBAL_NAMESPACE_NAMES.has(callee.name);
  if (isNodeOfType(callee, "MemberExpression")) {
    const rootName = getRootIdentifierName(callee);
    return rootName !== null && BUILTIN_GLOBAL_NAMESPACE_NAMES.has(rootName);
  }
  return false;
};

const getDependencyStateRefs = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  dependencyReference: Reference,
): Reference[] => {
  const useCallbackCall = getReactUseCallbackCall(
    dependencyReference.identifier as unknown as EsTreeNode,
    context.scopes,
  );
  if (!useCallbackCall) {
    return getUpstreamRefs(analysis, dependencyReference).filter((reference) =>
      isState(analysis, reference),
    );
  }
  const dependencyList = useCallbackCall.arguments?.[1];
  if (!dependencyList || !isNodeOfType(dependencyList, "ArrayExpression")) {
    return getUpstreamRefs(analysis, dependencyReference).filter((reference) =>
      isState(analysis, reference),
    );
  }
  return getDownstreamRefs(analysis, dependencyList)
    .flatMap((reference) => getUpstreamRefs(analysis, reference))
    .filter((reference) => isState(analysis, reference));
};

// A "simple" setter argument only re-derives from values already in the
// render scope: no calls (built-in namespace calls like `Math.max` are
// allowed), no `new`, no `await`, no function expressions (functional
// updaters read current state). Identifiers declared inside the effect
// must themselves have call-free initializers — `setEditor(newEditor)`
// where `newEditor = createEditor(...)` creates an external system in
// the effect and stays a chain.
const isSimpleExpression = (
  analysis: ProgramAnalysis,
  expression: EsTreeNode,
  effectFn: EsTreeNode,
  visitedDeclarators: WeakSet<object>,
): boolean => {
  let isSimple = true;
  walkAst(expression, (child: EsTreeNode) => {
    if (!isSimple) return false;
    if (
      isFunctionLike(child) ||
      isNodeOfType(child, "AwaitExpression") ||
      isNodeOfType(child, "NewExpression")
    ) {
      isSimple = false;
      return false;
    }
    if (isNodeOfType(child, "CallExpression") && !isBuiltinNamespaceCallee(child.callee)) {
      isSimple = false;
      return false;
    }
    if (isNodeOfType(child, "Identifier")) {
      const ref = getRef(analysis, child);
      const declarator = (ref?.resolved?.defs ?? [])
        .map((def) => def.node as unknown as EsTreeNode)
        .find((node) => isNodeOfType(node, "VariableDeclarator"));
      if (
        declarator &&
        isDeclaredWithin(declarator, effectFn) &&
        !visitedDeclarators.has(declarator)
      ) {
        visitedDeclarators.add(declarator);
        const initializer = isNodeOfType(declarator, "VariableDeclarator")
          ? (declarator.init as EsTreeNode | null)
          : null;
        if (
          initializer &&
          !isSimpleExpression(analysis, initializer, effectFn, visitedDeclarators)
        ) {
          isSimple = false;
          return false;
        }
      }
    }
  });
  return isSimple;
};

export const noChainStateUpdates = defineRule({
  id: "no-chain-state-updates",
  title: "State updates chained through effects",
  severity: "warn",
  disabledWhen: ["react:18"],
  tags: ["test-noise"],
  recommendation:
    "Set all the related state together in the event handler that starts it, instead of having one useEffect react to a state change and set more state. See https://react.dev/learn/you-might-not-need-an-effect#chains-of-computations",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (
        !isReactApiCall(node, APPLICABLE_EFFECT_HOOK_NAMES, context.scopes, {
          allowGlobalReactNamespace: true,
          allowUnboundBareCalls: true,
          resolveConditionalAliases: true,
          resolveNamedAliases: true,
        })
      ) {
        return;
      }
      const analysis = getProgramAnalysis(node);
      if (!analysis) return;
      if (hasCleanup(analysis, node)) return;
      const effectFnRefs = getEffectFnRefs(analysis, node);
      const depsRefs = getEffectDepsRefs(analysis, node);
      if (!effectFnRefs || !depsRefs) return;
      const effectFn = getEffectFn(analysis, node);
      if (!effectFn) return;

      const stateDeps = depsRefs.flatMap((reference) =>
        getDependencyStateRefs(analysis, context, reference),
      );
      if (stateDeps.length === 0) return;
      // Every triggering state dep is driven by a timer / listener / observer
      // / subscription — there is no single event handler to set all the
      // related state together, so the chain is the correct shape here.
      if (stateDeps.every((ref) => isExternallyDrivenState(analysis, ref))) return;

      const stateDepDeclarators = new Set(
        stateDeps
          .map((ref) => getUseStateDeclarator(ref))
          .filter((declarator): declarator is EsTreeNode => declarator !== null),
      );
      const isReachableFromStateTrigger = createStateTriggerReachability({
        analysis,
        context,
        effectFunction: effectFn,
      });

      // A state synced from a live DOM read (`document.querySelectorAll`,
      // a layout measurement) cannot be computed in the upstream event
      // handler — the DOM is only consistent after commit, so the effect is
      // required and the doc's "set both in the handler" fix cannot apply.
      // The whole state is exempt, including its fallback resets in the same
      // effect (the `catch { setAnchors([]) }` arm of the DOM-sync flow).
      const domSyncedStateDeclarators = new Set<EsTreeNode>();
      for (const ref of effectFnRefs) {
        if (!isSyncStateSetterCall(analysis, ref, effectFn)) continue;
        const callExpr = getCallExpr(ref);
        if (!callExpr) continue;
        if (!isReachableFromStateTrigger(callExpr)) continue;
        if (
          !readsPostMountValueThroughLocals(callExpr, effectFn, {
            ignoreBareRefCurrent: true,
            scopes: context.scopes,
          })
        ) {
          continue;
        }
        const declarator = getUseStateDeclarator(resolveStateSetterReference(analysis, ref) ?? ref);
        if (declarator) domSyncedStateDeclarators.add(declarator);
      }

      for (const ref of effectFnRefs) {
        if (!isSyncStateSetterCall(analysis, ref, effectFn)) continue;
        const callExpr = getCallExpr(ref);
        if (!callExpr) continue;
        if (!isReachableFromStateTrigger(callExpr)) continue;
        // Avoid overlap with no-derived-state
        const isSomeArgsState = getArgsUpstreamRefs(analysis, ref).some((argRef) =>
          isState(analysis, argRef),
        );
        if (isSomeArgsState) continue;
        // Guarded self-sync: the setter writes the SAME state the effect
        // depends on (clamp/normalize/latch patterns — `setPage(max)` when
        // `page` is a dep). These converge in one pass and re-derive from
        // in-scope values, so there is no handler to hoist them into. Only
        // simple re-derivations are exempt; a self-targeting setter fed by
        // a call result (editor/instance creation) is still a chain.
        const setterDeclarator = getUseStateDeclarator(
          resolveStateSetterReference(analysis, ref) ?? ref,
        );
        if (setterDeclarator && domSyncedStateDeclarators.has(setterDeclarator)) continue;
        const isSelfTargeting =
          setterDeclarator !== null && stateDepDeclarators.has(setterDeclarator);
        const setterArguments = isNodeOfType(callExpr, "CallExpression")
          ? ((callExpr.arguments ?? []) as EsTreeNode[])
          : [];
        if (
          isSelfTargeting &&
          setterArguments.every((argument) =>
            isSimpleExpression(analysis, argument, effectFn, new WeakSet()),
          )
        ) {
          continue;
        }
        if (
          setterDeclarator === null &&
          isNodeOfType(callExpr, "CallExpression") &&
          isNodeOfType(callExpr.callee, "Identifier") &&
          callExpr.arguments.length === 0
        ) {
          const helper = resolveExactLocalFunction(callExpr.callee, context.scopes);
          const helperSymbol = context.scopes.symbolFor(callExpr.callee);
          if (
            isFunctionLike(helper) &&
            !helper.async &&
            !helper.generator &&
            helper.params.length === 0 &&
            helperSymbol?.kind === "const" &&
            helperSymbol.initializer === helper &&
            helperSymbol.references.every((reference) => reference.flag === "read")
          ) {
            let hasNestedFunction = false;
            walkAst(helper.body, (child) => {
              if (isFunctionLike(child)) {
                hasNestedFunction = true;
                return false;
              }
            });
            const writeFacts = collectEffectStateWriteFacts(
              analysis,
              context,
              node,
              context.filename,
            );
            const setterReferences = getEventualCallRefsTo(
              analysis,
              ref,
              (innerRef) => resolveStateSetterReference(analysis, innerRef) !== null,
            );
            const setterReferenceSet = new Set(setterReferences);
            // Bare or escaped setter references are outside this direct-helper proof.
            const allSetterReferences = getUpstreamRefs(analysis, ref).filter(
              (innerRef) => resolveStateSetterReference(analysis, innerRef) !== null,
            );
            if (
              !hasNestedFunction &&
              setterReferences.length > 0 &&
              allSetterReferences.every((innerRef) => setterReferenceSet.has(innerRef)) &&
              setterReferences.every((innerRef) => {
                const innerCall = getCallExpr(innerRef);
                const innerSetter = resolveStateSetterReference(analysis, innerRef);
                const innerDeclarator = innerSetter ? getUseStateDeclarator(innerSetter) : null;
                const matchingFacts = writeFacts.filter(
                  (fact) =>
                    fact.callExpression === innerCall &&
                    fact.setterReference === innerSetter &&
                    fact.stateDeclarator === innerDeclarator,
                );
                return (
                  innerCall !== null &&
                  isNodeOfType(innerCall, "CallExpression") &&
                  isNodeOfType(innerCall.callee, "Identifier") &&
                  innerCall.callee === innerRef.identifier &&
                  findEnclosingFunction(innerCall) === helper &&
                  innerDeclarator !== null &&
                  stateDepDeclarators.has(innerDeclarator) &&
                  matchingFacts.length > 0 &&
                  matchingFacts.every(
                    (fact) => !fact.isDeferred && fact.isSynchronousRenderValue,
                  ) &&
                  innerCall.arguments.length === 1 &&
                  innerCall.arguments.every((argument) => {
                    if (isNodeOfType(argument, "SpreadElement")) return false;
                    const sourceBindingsAreClosed = getDownstreamRefs(analysis, argument)
                      .flatMap((argumentRef) => getUpstreamRefs(analysis, argumentRef))
                      .every((sourceRef) => {
                        const symbol = context.scopes.symbolFor(
                          sourceRef.identifier as unknown as EsTreeNode,
                        );
                        return (
                          symbol?.kind === "const" &&
                          symbol.references.every((reference) => reference.flag === "read") &&
                          isNodeOfType(symbol.declarationNode, "VariableDeclarator") &&
                          symbol.declarationNode.id === symbol.bindingIdentifier
                        );
                      });
                    if (!sourceBindingsAreClosed) return false;
                    const expression = stripParenExpression(argument);
                    const sourceSymbol = isNodeOfType(expression, "Identifier")
                      ? resolveConstIdentifierAlias(expression, context.scopes)
                      : null;
                    if (
                      isNodeOfType(expression, "Identifier") &&
                      (sourceSymbol?.kind !== "const" ||
                        !sourceSymbol.initializer ||
                        sourceSymbol.references.some((reference) => reference.flag !== "read") ||
                        !isNodeOfType(sourceSymbol.declarationNode, "VariableDeclarator") ||
                        sourceSymbol.declarationNode.id !== sourceSymbol.bindingIdentifier)
                    )
                      return false;
                    const value = sourceSymbol?.initializer
                      ? stripParenExpression(sourceSymbol.initializer)
                      : expression;
                    const isPrimitiveLiteral =
                      isNodeOfType(value, "Literal") &&
                      !("regex" in value) &&
                      (value.value === null ||
                        ["string", "number", "boolean", "bigint"].includes(typeof value.value));
                    const unaryArgument = isNodeOfType(value, "UnaryExpression")
                      ? stripParenExpression(value.argument)
                      : null;
                    const isSignedNumberLiteral =
                      isNodeOfType(value, "UnaryExpression") &&
                      (value.operator === "+" || value.operator === "-") &&
                      isNodeOfType(unaryArgument, "Literal") &&
                      typeof unaryArgument.value === "number";
                    return (
                      (isPrimitiveLiteral || isSignedNumberLiteral) &&
                      isSimpleExpression(analysis, argument as EsTreeNode, helper, new WeakSet())
                    );
                  })
                );
              })
            ) {
              continue;
            }
          }
        }
        context.report({
          node: callExpr,
          message: "Chaining state updates triggers an extra render each step.",
        });
      }
    },
  }),
});
