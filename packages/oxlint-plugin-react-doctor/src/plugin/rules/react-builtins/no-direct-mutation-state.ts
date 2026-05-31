import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getOuterMemberExpression } from "../../utils/get-outer-member-expression.js";
import { isEs5Component } from "../../utils/is-es5-component.js";
import { isEs6Component } from "../../utils/is-es6-component.js";
import { isStateMemberExpression } from "../../utils/is-state-member-expression.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE =
  "Your users see stale data because mutating `this.state` by hand never redraws & gets overwritten.";

// Ancestor walk replicates `oxc_linter::rules::react::no_direct_mutation_state`'s
// `should_ignore_component`: walk up from the assignment until we either
// hit a Class node (stop) or accumulate enough context to decide.
//   - mutation inside a Constructor (and not nested inside a CallExpression)
//     is OK — it's the canonical `this.state = {...}` initialization.
//   - mutation outside of any es5/es6 component is OK (not React state).
const shouldIgnoreMutation = (node: EsTreeNode): boolean => {
  let isConstructor = false;
  let isInsideCallExpression = false;
  let isInsideComponent = false;

  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "MethodDefinition") &&
      "kind" in ancestor &&
      ancestor.kind === "constructor"
    ) {
      isConstructor = true;
    }
    if (isNodeOfType(ancestor, "CallExpression")) isInsideCallExpression = true;
    if (isEs5Component(ancestor) || isEs6Component(ancestor)) isInsideComponent = true;
    if (isNodeOfType(ancestor, "ClassDeclaration") || isNodeOfType(ancestor, "ClassExpression")) {
      break;
    }
    ancestor = ancestor.parent ?? null;
  }

  return (isConstructor && !isInsideCallExpression) || !isInsideComponent;
};

const reportIfStateMutation = (
  context: Parameters<Rule["create"]>[0],
  reportNode: EsTreeNode,
  target: EsTreeNode,
): void => {
  const outerMember = getOuterMemberExpression(target);
  if (!outerMember) return;
  if (!isStateMemberExpression(outerMember)) return;
  if (shouldIgnoreMutation(reportNode)) return;
  context.report({ node: reportNode, message: MESSAGE });
};

// Port of `oxc_linter::rules::react::no_direct_mutation_state`. Flags
// direct assignment / update to `this.state.*` outside the constructor of
// a React component (class component or createReactClass factory).
export const noDirectMutationState = defineRule<Rule>({
  id: "no-direct-mutation-state",
  title: "Direct mutation of this.state",
  severity: "error",
  recommendation:
    "Don't change `this.state` by hand. `setState()` overwrites it anyway, so always go through `setState()`.",
  create: (context) => ({
    AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
      reportIfStateMutation(context, node, node.left);
    },
    UpdateExpression(node: EsTreeNodeOfType<"UpdateExpression">) {
      reportIfStateMutation(context, node, node.argument);
    },
  }),
});
