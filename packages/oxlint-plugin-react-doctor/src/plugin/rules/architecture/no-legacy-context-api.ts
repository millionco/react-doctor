import { defineRule } from "../../utils/define-rule.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// HACK: legacy context (`childContextTypes` + `getChildContext` on
// providers, `contextTypes` on consumers) was deprecated in 16.3, warns
// in 18.3.1, and is REMOVED in 19. Migration is cross-file (provider +
// every consumer must be moved together) so flagging surface area early
// is high-leverage. We catch the static class-property forms AND the
// `Foo.contextTypes = {...}` shape — both styles appear in the wild,
// and missing one leaves silent gaps.
const LEGACY_CONTEXT_NAMES: ReadonlySet<string> = new Set([
  "childContextTypes",
  "contextTypes",
  "getChildContext",
]);

const buildLegacyContextMessage = (memberName: string): string => {
  if (memberName === "childContextTypes" || memberName === "getChildContext") {
    return `${memberName} uses the old context API that React 19 removes, so your provider stops passing data. Switch to \`createContext\` with \`<MyContext.Provider value={...}>\` & read it with \`useContext()\`, moving every consumer together.`;
  }
  return "contextTypes uses the old context API that React 19 removes, so your component stops receiving context. Use `static contextType = MyContext` or `useContext()` in a function component, & update the provider too.";
};

const isInsideClassBody = (node: EsTreeNode): boolean => {
  let current = node.parent;
  while (current) {
    if (isNodeOfType(current, "ClassBody")) return true;
    if (isFunctionLike(current)) {
      return false;
    }
    current = current.parent;
  }
  return false;
};

export const noLegacyContextApi = defineRule<Rule>({
  id: "no-legacy-context-api",
  title: "Legacy context API",
  severity: "error",
  category: "Correctness",
  tags: ["migration-hint"],
  recommendation:
    "Swap `childContextTypes` + `getChildContext` for `const MyContext = createContext(...)` and `<MyContext.Provider value={...}>`. Swap `contextTypes` for `static contextType = MyContext` or `useContext()` in a function component. Move the provider and every consumer together, or some consumers read the wrong context.",
  create: (context: RuleContext) => {
    const checkMember = (memberNode: EsTreeNode | undefined): void => {
      if (!memberNode) return;
      if (
        !isNodeOfType(memberNode, "MethodDefinition") &&
        !isNodeOfType(memberNode, "PropertyDefinition")
      )
        return;
      if (!isNodeOfType(memberNode.key, "Identifier")) return;
      if (!LEGACY_CONTEXT_NAMES.has(memberNode.key.name)) return;
      context.report({
        node: memberNode.key,
        message: buildLegacyContextMessage(memberNode.key.name),
      });
    };

    return {
      ClassBody(node: EsTreeNodeOfType<"ClassBody">) {
        for (const member of node.body ?? []) {
          checkMember(member);
        }
      },
      AssignmentExpression(node: EsTreeNodeOfType<"AssignmentExpression">) {
        if (node.operator !== "=") return;
        const left = node.left;
        if (!isNodeOfType(left, "MemberExpression")) return;
        if (left.computed) return;
        if (!isNodeOfType(left.property, "Identifier")) return;
        if (!LEGACY_CONTEXT_NAMES.has(left.property.name)) return;
        if (!isNodeOfType(left.object, "Identifier")) return;
        if (!isUppercaseName(left.object.name)) return;
        if (isInsideClassBody(node)) return;
        context.report({
          node: left,
          message: buildLegacyContextMessage(left.property.name),
        });
      },
    };
  },
});
