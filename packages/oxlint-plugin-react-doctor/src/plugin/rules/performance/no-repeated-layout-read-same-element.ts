import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";
import { walkOwnFunctionScope } from "../../utils/walk-own-function-scope.js";

// Method-call layout reads that each force a synchronous style/layout
// flush. Bare property forms (scrollTop/offsetWidth/…) are deliberately
// excluded: they are write-invalidated and commonly live on non-DOM
// objects, so they carry a high false-positive risk.
const LAYOUT_READ_METHOD_NAMES = new Set(["getBoundingClientRect", "getComputedStyle"]);

interface NodeWithRange {
  start?: number;
  end?: number;
}

const rangeStart = (node: EsTreeNode): number => (node as NodeWithRange).start ?? 0;
const rangeEnd = (node: EsTreeNode): number => (node as NodeWithRange).end ?? 0;

// Canonical source-ish key for a receiver expression, or null when the
// receiver isn't a simple identifier / member chain (computed access,
// call results, …) — we only group receivers we can compare exactly.
const serializeReceiver = (node: EsTreeNode | null | undefined): string | null => {
  if (!node) return null;
  if (isNodeOfType(node, "Identifier")) return node.name;
  if (isNodeOfType(node, "ThisExpression")) return "this";
  if (isNodeOfType(node, "MemberExpression")) {
    if (node.computed) return null;
    const objectKey = serializeReceiver(node.object);
    if (!objectKey) return null;
    if (!isNodeOfType(node.property, "Identifier")) return null;
    return `${objectKey}.${node.property.name}`;
  }
  return null;
};

interface LayoutRead {
  methodName: string;
  readSignature: string;
  receiverKey: string;
  regionNode: EsTreeNode;
  callNode: EsTreeNode;
}

interface ReceiverMutation {
  receiverKey: string;
  end: number;
}

interface LayoutReadCall {
  methodName: string;
  readSignature: string | null;
  receiver: EsTreeNode | null;
}

// Classifies a call as a forced-layout read, or null when it is not one
// (the caller then treats it as a potential mutation). For
// `el.getBoundingClientRect()` the receiver is `el`; for
// `getComputedStyle(el)` it is the first argument. The readSignature
// distinguishes `getComputedStyle(el)` from `getComputedStyle(el,
// "::before")`: only calls with the same pseudo-element selector return
// the same declaration, so only those can pair. A null readSignature
// (dynamic selector) or null receiver (computed callee) marks the read
// incomparable — skipped entirely, but still never a mutation.
const classifyLayoutReadCall = (
  call: EsTreeNodeOfType<"CallExpression">,
): LayoutReadCall | null => {
  const callee = call.callee;
  let methodName: string | null = null;
  let receiver: EsTreeNode | null = null;
  if (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.property, "Identifier") &&
    LAYOUT_READ_METHOD_NAMES.has(callee.property.name)
  ) {
    methodName = callee.property.name;
    if (!callee.computed) {
      receiver =
        methodName === "getBoundingClientRect" ? callee.object : (call.arguments?.[0] ?? null);
    }
  } else if (isNodeOfType(callee, "Identifier") && callee.name === "getComputedStyle") {
    methodName = "getComputedStyle";
    receiver = call.arguments?.[0] ?? null;
  }
  if (!methodName) return null;

  let readSignature: string | null = methodName;
  if (methodName === "getComputedStyle") {
    const pseudoElementArgument = call.arguments?.[1];
    if (pseudoElementArgument) {
      readSignature = isNodeOfType(pseudoElementArgument, "Literal")
        ? `${methodName}(${String(pseudoElementArgument.value)})`
        : null;
    }
  }
  return { methodName, readSignature, receiver };
};

// Nearest enclosing block, branch arm, or the scope root — two reads
// only "repeat" when they share the same execution path, so reads in
// separate branches (blocks, switch cases, ternary arms, unbraced
// if/else bodies, short-circuit right operands of &&/||/??) never group
// together. A read in a logical right operand is a deliberate lazy
// fallback (`el.clientWidth || el.getBoundingClientRect().width`) that
// only executes on the rare path — hoisting it would pessimize the
// common path.
const enclosingRegion = (node: EsTreeNode, scopeRoot: EsTreeNode): EsTreeNode => {
  let child: EsTreeNode = node;
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor && cursor !== scopeRoot) {
    if (isNodeOfType(cursor, "BlockStatement")) return cursor;
    if (isNodeOfType(cursor, "SwitchCase")) return cursor;
    if (isNodeOfType(cursor, "LogicalExpression") && cursor.right === child) return child;
    if (
      (isNodeOfType(cursor, "ConditionalExpression") || isNodeOfType(cursor, "IfStatement")) &&
      (cursor.consequent === child || cursor.alternate === child)
    ) {
      return child;
    }
    child = cursor;
    cursor = cursor.parent ?? null;
  }
  return scopeRoot;
};

// The receiver a statement mutates (invalidating any cached layout), or
// null. Covers `el.scrollTop = 0`, `el.scrollTop++`, and any other
// method call on the receiver (`el.focus()`, `el.scrollIntoView()`).
const mutatedReceiverKey = (node: EsTreeNode): string | null => {
  let target: EsTreeNode | null = null;
  if (isNodeOfType(node, "AssignmentExpression")) {
    target = isNodeOfType(node.left, "MemberExpression") ? node.left.object : node.left;
  } else if (isNodeOfType(node, "UpdateExpression")) {
    target = isNodeOfType(node.argument, "MemberExpression") ? node.argument.object : node.argument;
  }
  return serializeReceiver(target);
};

export const noRepeatedLayoutReadSameElement = defineRule({
  id: "no-repeated-layout-read-same-element",
  title: "Repeated layout read on the same element",
  tags: ["test-noise"],
  severity: "warn",
  category: "Performance",
  recommendation:
    "Cache the result in a const once (`const rect = el.getBoundingClientRect()`) so the browser only computes layout a single time.",
  create: (context: RuleContext) => {
    const inspectScope = (scopeRoot: EsTreeNode): void => {
      const reads: LayoutRead[] = [];
      const mutations: ReceiverMutation[] = [];
      const barrierEnds: number[] = [];

      const recordNode = (node: EsTreeNode): void => {
        if (isNodeOfType(node, "AwaitExpression")) {
          // Any layout can change across an await, so a re-read after it
          // is a legitimate re-measurement, not a duplicate.
          barrierEnds.push(rangeEnd(node));
        }
        if (isNodeOfType(node, "CallExpression")) {
          const layoutRead = classifyLayoutReadCall(node);
          if (layoutRead) {
            const receiverKey = serializeReceiver(layoutRead.receiver);
            if (layoutRead.readSignature && receiverKey) {
              reads.push({
                methodName: layoutRead.methodName,
                readSignature: layoutRead.readSignature,
                receiverKey,
                regionNode: enclosingRegion(node, scopeRoot),
                callNode: node,
              });
            }
          } else {
            if (isNodeOfType(node.callee, "MemberExpression")) {
              // A non-read method call on a receiver invalidates its layout.
              const mutatedKey = serializeReceiver(node.callee.object);
              if (mutatedKey) mutations.push({ receiverKey: mutatedKey, end: rangeEnd(node) });
            }
            // A call receiving the element (or a sub-object like
            // `el.style`) may mutate it — `Object.assign(el.style, …)`,
            // `applyCollapsedStyles(el)` — so it invalidates the cache.
            for (const argument of node.arguments ?? []) {
              const argumentKey = serializeReceiver(argument);
              if (argumentKey) mutations.push({ receiverKey: argumentKey, end: rangeEnd(node) });
            }
          }
        }
        const mutatedKey = mutatedReceiverKey(node);
        if (mutatedKey) mutations.push({ receiverKey: mutatedKey, end: rangeEnd(node) });
      };
      if (isFunctionLike(scopeRoot)) {
        walkOwnFunctionScope(scopeRoot, recordNode);
      } else {
        walkAst(scopeRoot, (node) => (isFunctionLike(node) ? false : recordNode(node)));
      }

      const reportedGroups = new Set<string>();
      for (let outer = 0; outer < reads.length; outer++) {
        for (let inner = outer + 1; inner < reads.length; inner++) {
          const first = reads[outer];
          const second = reads[inner];
          if (first.regionNode !== second.regionNode) continue;
          if (first.receiverKey !== second.receiverKey) continue;
          if (first.readSignature !== second.readSignature) continue;
          const groupSignature = `${
            first.regionNode === scopeRoot ? "root" : rangeStart(first.regionNode)
          }::${first.receiverKey}::${first.readSignature}`;
          if (reportedGroups.has(groupSignature)) continue;

          const earlierEnd = Math.min(rangeEnd(first.callNode), rangeEnd(second.callNode));
          const laterStart = Math.max(rangeStart(first.callNode), rangeStart(second.callNode));
          // A mutation invalidates the cache when it writes to the receiver
          // itself, a sub-property of it (`el.style.top = …`), or a parent
          // of it — any overlap of the access chains. The mutation's END
          // position orders it: an assignment whose right-hand side contains
          // the first read still writes after that read completes.
          const invalidates = (mutatedKey: string): boolean =>
            mutatedKey === first.receiverKey ||
            mutatedKey.startsWith(`${first.receiverKey}.`) ||
            first.receiverKey.startsWith(`${mutatedKey}.`);
          const hasInterveningMutation = mutations.some(
            (mutation) =>
              invalidates(mutation.receiverKey) &&
              mutation.end >= earlierEnd &&
              mutation.end <= laterStart,
          );
          if (hasInterveningMutation) continue;
          const hasInterveningBarrier = barrierEnds.some(
            (barrierEnd) => barrierEnd >= earlierEnd && barrierEnd <= laterStart,
          );
          if (hasInterveningBarrier) continue;

          reportedGroups.add(groupSignature);
          const cacheExample =
            second.methodName === "getComputedStyle"
              ? "const style = getComputedStyle(el)"
              : "const rect = el.getBoundingClientRect()";
          context.report({
            node: second.callNode,
            message: `You call ${second.methodName}() on the same element twice here, forcing a second layout reflow. Read it once into a const (${cacheExample}) and reuse it.`,
          });
        }
      }
    };

    return {
      Program: inspectScope,
      FunctionDeclaration: inspectScope,
      FunctionExpression: inspectScope,
      ArrowFunctionExpression: inspectScope,
    };
  },
});
