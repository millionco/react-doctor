import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MESSAGE =
  "This resets a loading/busy flag only on the success path: if the awaited call rejects the reset never runs and the flag stays stuck truthy (a spinner that never stops, a button disabled forever). Move the reset into a `finally` block, or mirror it on every catch, so it clears on rejection too.";

// Setters whose truthy/falsy value models a loading/busy/pending UI flag.
// The reset-on-success defect only matters for a flag the UI reads to show a
// spinner or disable a control, so we gate on the setter name to stay quiet
// on ordinary boolean toggles.
const LOADING_FLAG_SETTER_PATTERN =
  /(loading|busy|submitting|saving|pending|fetching|processing|uploading|spinner|disabl|refreshing|updating|inflight|working|posting|sending|deleting)/i;

const getNodeStart = (node: EsTreeNode): number | null => {
  const start = (node as { start?: unknown }).start;
  return typeof start === "number" ? start : null;
};

// The boolean argument of a `setX(true)` / `setX(false)` call, or null when
// the call is not a bare-identifier setter with a boolean-literal first arg.
const getSetterBooleanValue = (
  node: EsTreeNodeOfType<"CallExpression">,
): { setterName: string; value: boolean } | null => {
  if (!isNodeOfType(node.callee, "Identifier")) return null;
  const firstArgument = node.arguments[0];
  if (!firstArgument || !isNodeOfType(firstArgument, "Literal")) return null;
  if (typeof firstArgument.value !== "boolean") return null;
  return { setterName: node.callee.name, value: firstArgument.value };
};

// Where a call sits relative to the enclosing async function's try/catch:
// inside a `finally` finalizer, inside a `catch` handler, or neither
// ("plain" — a trailing success-path statement or a bare try body).
const classifyResetContext = (
  callNode: EsTreeNode,
  functionNode: EsTreeNode,
): "finally" | "catch" | "plain" => {
  let child: EsTreeNode = callNode;
  let cursor: EsTreeNode | null | undefined = callNode.parent;
  while (cursor && cursor !== functionNode) {
    if (isNodeOfType(cursor, "CatchClause")) return "catch";
    if (isNodeOfType(cursor, "TryStatement") && cursor.finalizer === child) return "finally";
    child = cursor;
    cursor = cursor.parent ?? null;
  }
  return "plain";
};

// Walks the function's own body, never descending into a nested function, so
// awaits/setters belong to THIS async scope, not a deeper closure.
const walkOwnScope = (functionNode: EsTreeNode, visit: (node: EsTreeNode) => void): void => {
  if (!isFunctionLike(functionNode)) return;
  const body = functionNode.body;
  if (!body) return;
  walkAst(body, (child: EsTreeNode) => {
    if (child !== body && isFunctionLike(child)) return false;
    visit(child);
  });
};

interface SetterCall {
  value: boolean;
  start: number;
  context: "finally" | "catch" | "plain";
  node: EsTreeNode;
}

const analyzeFunction = (functionNode: EsTreeNode, context: RuleContext): void => {
  let firstAwaitStart: number | null = null;
  const settersByName = new Map<string, SetterCall[]>();

  walkOwnScope(functionNode, (node) => {
    if (isNodeOfType(node, "AwaitExpression")) {
      const start = getNodeStart(node);
      if (start !== null && (firstAwaitStart === null || start < firstAwaitStart)) {
        firstAwaitStart = start;
      }
      return;
    }
    if (!isNodeOfType(node, "CallExpression")) return;
    const setter = getSetterBooleanValue(node);
    if (!setter) return;
    if (!LOADING_FLAG_SETTER_PATTERN.test(setter.setterName)) return;
    const start = getNodeStart(node);
    if (start === null) return;
    const list = settersByName.get(setter.setterName) ?? [];
    list.push({
      value: setter.value,
      start,
      context: classifyResetContext(node, functionNode),
      node,
    });
    settersByName.set(setter.setterName, list);
  });

  if (firstAwaitStart === null) return;
  const awaitStart = firstAwaitStart;

  for (const calls of settersByName.values()) {
    const setsTruthyBeforeAwait = calls.some((call) => call.value && call.start < awaitStart);
    if (!setsTruthyBeforeAwait) continue;

    const resets = calls.filter((call) => !call.value);
    if (resets.length === 0) continue;

    // A reset in `finally` always runs; a reset in `catch` mirrors the reset
    // on the rejection path. Either discharges the clear-obligation, so the
    // flag is not stuck.
    if (resets.some((reset) => reset.context === "finally" || reset.context === "catch")) continue;

    const successPathReset = resets.find(
      (reset) => reset.context === "plain" && reset.start > awaitStart,
    );
    if (successPathReset) {
      context.report({ node: successPathReset.node, message: MESSAGE });
      return;
    }
  }
};

export const noLoadingFlagResetOutsideFinally = defineRule({
  id: "no-loading-flag-reset-outside-finally",
  title: "Loading flag reset outside finally",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "A trailing `setLoading(false)` after an `await` never runs if the awaited call rejects, so the flag stays stuck truthy; reset it in a `finally` block (or mirror the reset on every catch) so it clears on both paths.",
  create: (context: RuleContext) => ({
    ArrowFunctionExpression(node: EsTreeNodeOfType<"ArrowFunctionExpression">) {
      analyzeFunction(node as EsTreeNode, context);
    },
    FunctionExpression(node: EsTreeNodeOfType<"FunctionExpression">) {
      analyzeFunction(node as EsTreeNode, context);
    },
    FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
      analyzeFunction(node as EsTreeNode, context);
    },
  }),
});
