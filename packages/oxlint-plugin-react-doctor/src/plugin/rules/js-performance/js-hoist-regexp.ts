import { createLoopAwareVisitors } from "../../utils/create-loop-aware-visitors.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

const isStaticPattern = (argument: EsTreeNode | null | undefined): boolean => {
  if (!argument) return false;
  const unwrappedArgument = stripParenExpression(argument);
  if (isNodeOfType(unwrappedArgument, "Literal")) return true;
  return (
    isNodeOfType(unwrappedArgument, "TemplateLiteral") &&
    (unwrappedArgument.expressions?.length ?? 0) === 0
  );
};

const STATEFUL_REGEXP_FLAGS_PATTERN = /[gy]/;
const VALID_REGEXP_FLAGS_PATTERN = /^[dgimsuvy]*$/;

const getStaticStringValue = (argument: EsTreeNode | null | undefined): string | null => {
  if (!argument) return null;
  const unwrappedArgument = stripParenExpression(argument);
  if (isNodeOfType(unwrappedArgument, "Literal") && typeof unwrappedArgument.value === "string") {
    return unwrappedArgument.value;
  }
  if (
    isNodeOfType(unwrappedArgument, "TemplateLiteral") &&
    (unwrappedArgument.expressions?.length ?? 0) === 0
  ) {
    const value = unwrappedArgument.quasis?.[0]?.value?.cooked;
    return typeof value === "string" ? value : null;
  }
  return null;
};

const getEffectiveRegExpFlags = (
  patternArgument: EsTreeNode | null | undefined,
  flagsArgument: EsTreeNode | null | undefined,
): string | null => {
  if (flagsArgument) return getStaticStringValue(flagsArgument);
  if (!patternArgument) return "";
  const unwrappedPattern = stripParenExpression(patternArgument);
  if (isNodeOfType(unwrappedPattern, "Literal") && unwrappedPattern.value instanceof RegExp) {
    return unwrappedPattern.value.flags;
  }
  return "";
};

const hasValidRegExpFlags = (flags: string): boolean =>
  VALID_REGEXP_FLAGS_PATTERN.test(flags) &&
  new Set(flags).size === flags.length &&
  !(flags.includes("u") && flags.includes("v"));

const hasGlobalRegExpReassignment = (context: RuleContext): boolean => {
  const pendingScopes = [context.scopes.rootScope];
  while (pendingScopes.length > 0) {
    const currentScope = pendingScopes.pop();
    if (!currentScope) continue;
    if (
      currentScope.references.some(
        (reference) =>
          reference.resolvedSymbol === null &&
          reference.flag !== "read" &&
          isNodeOfType(reference.identifier, "Identifier") &&
          reference.identifier.name === "RegExp",
      )
    ) {
      return true;
    }
    pendingScopes.push(...currentScope.children);
  }
  return false;
};

// `RegExp(...)` without `new` constructs a fresh regex exactly like
// `new RegExp(...)` does, so both call forms get the same treatment.
const isStaticRegExpConstruction = (
  node: EsTreeNodeOfType<"NewExpression"> | EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
  getHasReassignedGlobalRegExp: () => boolean,
): boolean => {
  const patternArgument = node.arguments?.[0] as EsTreeNode | undefined;
  const flagsArgument = node.arguments?.[1] as EsTreeNode | undefined;
  const callee = stripParenExpression(node.callee);
  const effectiveFlags = getEffectiveRegExpFlags(patternArgument, flagsArgument);
  return (
    isNodeOfType(callee, "Identifier") &&
    callee.name === "RegExp" &&
    context.scopes.isGlobalReference(callee) &&
    isStaticPattern(patternArgument) &&
    effectiveFlags !== null &&
    hasValidRegExpFlags(effectiveFlags) &&
    !STATEFUL_REGEXP_FLAGS_PATTERN.test(effectiveFlags) &&
    !getHasReassignedGlobalRegExp()
  );
};

const MESSAGE =
  "`new RegExp()` rebuilds the pattern on every loop pass. Move it to a constant outside the loop.";

export const jsHoistRegexp = defineRule({
  id: "js-hoist-regexp",
  title: "RegExp built inside a loop",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Move `new RegExp(...)` (or large regex literals) to a constant outside the loop so it isn't rebuilt on every pass",
  create: (context: RuleContext) => {
    let hasReassignedGlobalRegExp: boolean | null = null;
    const getHasReassignedGlobalRegExp = (): boolean => {
      hasReassignedGlobalRegExp ??= hasGlobalRegExpReassignment(context);
      return hasReassignedGlobalRegExp;
    };
    return createLoopAwareVisitors(
      {
        NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
          if (isStaticRegExpConstruction(node, context, getHasReassignedGlobalRegExp)) {
            context.report({ node, message: MESSAGE });
          }
        },
        CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
          if (isStaticRegExpConstruction(node, context, getHasReassignedGlobalRegExp)) {
            context.report({ node, message: MESSAGE });
          }
        },
      },
      { treatIteratorCallbacksAsLoops: true },
    );
  },
});
