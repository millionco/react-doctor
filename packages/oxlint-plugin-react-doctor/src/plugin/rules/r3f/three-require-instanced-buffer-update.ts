import { defineRule } from "../../utils/define-rule.js";
import { doNodesCoverEveryPathAfterNode } from "../../utils/do-nodes-cover-every-path-after-node.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getRangeStart } from "../../utils/get-range-start.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isNodeConditionallyExecuted } from "../../utils/is-node-conditionally-executed.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isImportedOrStableParameterCall } from "../../utils/is-imported-or-stable-parameter-call.js";
import { resolveExpressionKey } from "../../utils/resolve-expression-key.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { getThreeConstructorName } from "./utils/get-three-constructor-name.js";

interface DirectInstancedBufferMutation {
  readonly bufferPropertyName: "instanceColor" | "instanceMatrix";
  readonly methodName: "setColorAt" | "setMatrixAt";
  readonly node: EsTreeNodeOfType<"CallExpression">;
  readonly receiverKey: string;
}

interface DirectInstancedBufferCompletion {
  readonly bufferPropertyName: "instanceColor" | "instanceMatrix";
  readonly node: EsTreeNode;
  readonly receiverKey: string;
}

const getInstancedBufferMutation = (
  node: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): DirectInstancedBufferMutation | null => {
  const callee = stripParenExpression(node.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return null;
  const methodName = getStaticPropertyName(callee);
  if (methodName !== "setMatrixAt" && methodName !== "setColorAt") return null;
  if (getThreeConstructorName(callee.object, context.scopes) !== "InstancedMesh") return null;
  const receiverKey = resolveExpressionKey(callee.object, context);
  if (!receiverKey) return null;
  return {
    bufferPropertyName: methodName === "setMatrixAt" ? "instanceMatrix" : "instanceColor",
    methodName,
    node,
    receiverKey,
  };
};

const getInstancedBufferCompletion = (
  node: EsTreeNodeOfType<"AssignmentExpression">,
  context: RuleContext,
): DirectInstancedBufferCompletion | null => {
  const assignedValue = stripParenExpression(node.right);
  const needsUpdateMember = stripParenExpression(node.left);
  if (
    node.operator !== "=" ||
    !isNodeOfType(assignedValue, "Literal") ||
    assignedValue.value !== true ||
    !isNodeOfType(needsUpdateMember, "MemberExpression") ||
    getStaticPropertyName(needsUpdateMember) !== "needsUpdate"
  ) {
    return null;
  }
  const bufferMember = stripParenExpression(needsUpdateMember.object);
  if (!isNodeOfType(bufferMember, "MemberExpression")) return null;
  const bufferPropertyName = getStaticPropertyName(bufferMember);
  if (bufferPropertyName !== "instanceMatrix" && bufferPropertyName !== "instanceColor") {
    return null;
  }
  if (getThreeConstructorName(bufferMember.object, context.scopes) !== "InstancedMesh") return null;
  const receiverKey = resolveExpressionKey(bufferMember.object, context);
  return receiverKey ? { bufferPropertyName, node, receiverKey } : null;
};

const getOpaqueInstancedBufferCompletions = (
  node: EsTreeNodeOfType<"CallExpression">,
  context: RuleContext,
): ReadonlyArray<DirectInstancedBufferCompletion> => {
  if (!isImportedOrStableParameterCall(node, context.scopes)) return [];
  const completions: DirectInstancedBufferCompletion[] = [];
  for (const argument of node.arguments) {
    if (isNodeOfType(argument, "SpreadElement")) continue;
    const candidate = stripParenExpression(argument);
    if (isNodeOfType(candidate, "MemberExpression")) {
      const bufferPropertyName = getStaticPropertyName(candidate);
      if (
        (bufferPropertyName === "instanceMatrix" || bufferPropertyName === "instanceColor") &&
        getThreeConstructorName(candidate.object, context.scopes) === "InstancedMesh"
      ) {
        const receiverKey = resolveExpressionKey(candidate.object, context);
        if (receiverKey) completions.push({ bufferPropertyName, node, receiverKey });
        continue;
      }
    }
    if (getThreeConstructorName(candidate, context.scopes) !== "InstancedMesh") continue;
    const receiverKey = resolveExpressionKey(candidate, context);
    if (!receiverKey) continue;
    completions.push({ bufferPropertyName: "instanceMatrix", node, receiverKey });
    completions.push({ bufferPropertyName: "instanceColor", node, receiverKey });
  }
  return completions;
};

const completionCoversMutation = (
  mutation: DirectInstancedBufferMutation,
  completions: ReadonlyArray<DirectInstancedBufferCompletion>,
  program: EsTreeNode,
  context: RuleContext,
): boolean => {
  const owner = context.cfg.enclosingFunction(mutation.node);
  const matchingCompletions = completions.filter(
    (completion) =>
      completion.receiverKey === mutation.receiverKey &&
      completion.bufferPropertyName === mutation.bufferPropertyName &&
      context.cfg.enclosingFunction(completion.node) === owner,
  );
  if (owner) {
    return doNodesCoverEveryPathAfterNode(
      mutation.node,
      matchingCompletions.map((completion) => completion.node),
      context,
    );
  }
  const mutationStart = getRangeStart(mutation.node);
  return matchingCompletions.some((completion) => {
    const completionStart = getRangeStart(completion.node);
    return (
      mutationStart !== null &&
      completionStart !== null &&
      completionStart > mutationStart &&
      !isNodeConditionallyExecuted(completion.node, program)
    );
  });
};

export const threeRequireInstancedBufferUpdate = defineRule({
  id: "three-require-instanced-buffer-update",
  title: "Three.js instanced mesh buffer is not marked for upload",
  category: "Correctness",
  severity: "error",
  recommendation:
    "After setMatrixAt or setColorAt, set the matching instance buffer's needsUpdate flag to true",
  create: (context: RuleContext) => {
    const mutations: DirectInstancedBufferMutation[] = [];
    const completions: DirectInstancedBufferCompletion[] = [];
    let program: EsTreeNode | null = null;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        program = node;
      },
      AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
        const completion = getInstancedBufferCompletion(node, context);
        if (completion) completions.push(completion);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const mutation = getInstancedBufferMutation(node, context);
        if (mutation) {
          mutations.push(mutation);
          return;
        }
        completions.push(...getOpaqueInstancedBufferCompletions(node, context));
      },
      "Program:exit"() {
        if (!program) return;
        for (const mutation of mutations) {
          if (completionCoversMutation(mutation, completions, program, context)) continue;
          context.report({
            node: mutation.node,
            message: `After ${mutation.methodName}, set ${mutation.bufferPropertyName}.needsUpdate to true so Three.js uploads the changed instance data`,
          });
        }
      },
    };
  },
});
