import { defineRule } from "../../utils/define-rule.js";
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
    return `${memberName} is part of the legacy context API (REMOVED in React 19). Replace the provider with \`createContext\` + \`<MyContext.Provider value={...}>\` and consume via \`useContext()\` (or \`use()\` on React 19+) — every consumer must migrate together`;
  }
  return "contextTypes is part of the legacy context API (REMOVED in React 19). Replace with `static contextType = MyContext` (single context) or read the modern context with `useContext()` / `use()` from a function component — coordinate with the provider's migration";
};

const isInsideClassBody = (node: EsTreeNode): boolean => {
  let current = node.parent;
  while (current) {
    if (isNodeOfType(current, "ClassBody")) return true;
    if (
      isNodeOfType(current, "FunctionDeclaration") ||
      isNodeOfType(current, "FunctionExpression") ||
      isNodeOfType(current, "ArrowFunctionExpression")
    ) {
      return false;
    }
    current = current.parent;
  }
  return false;
};

export const noLegacyContextApi = defineRule<Rule>({
  framework: "global",
  severity: "error",
  category: "Correctness",
  recommendation:
    "Replace `childContextTypes` + `getChildContext` with `const MyContext = createContext(...)` + `<MyContext.Provider value={...}>`; replace `contextTypes` with `static contextType = MyContext` (single context) or `useContext()` / `use()` from a function component. The provider and every consumer must migrate together — partial migrations leave consumers reading the wrong context.",
  examples: [
    {
      before:
        "class Provider extends Component {\n  static childContextTypes = { theme: PropTypes.string };\n  getChildContext() { return { theme: this.state.theme }; }\n}",
      after:
        "const ThemeContext = createContext('light');\nconst Provider = ({ children }) => (\n  <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>\n);",
    },
  ],
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
