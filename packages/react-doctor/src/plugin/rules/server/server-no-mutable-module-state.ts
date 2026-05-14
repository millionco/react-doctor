import { defineRule } from "../../utils/define-rule.js";
import { hasDirective } from "../../utils/has-directive.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const MUTABLE_CONTAINER_CONSTRUCTORS = new Set(["Map", "Set", "WeakMap", "WeakSet"]);

const isMutableConstInitializer = (init: EsTreeNode | null | undefined): string | null => {
  if (!init) return null;
  if (isNodeOfType(init, "ArrayExpression")) return "[]";
  if (isNodeOfType(init, "ObjectExpression")) return "{}";
  if (
    isNodeOfType(init, "NewExpression") &&
    isNodeOfType(init.callee, "Identifier") &&
    MUTABLE_CONTAINER_CONSTRUCTORS.has(init.callee.name)
  ) {
    return `new ${init.callee.name}()`;
  }
  return null;
};

// HACK: in `"use server"` files, mutable module-level state (let/var, OR
// const-bound mutable containers like Map/Set/WeakMap/Array) is shared
// across concurrent requests. Different users can read each other's data,
// and serverless cold-starts produce inconsistent state. Per-request data
// must live inside the action, in headers/cookies, or in a request scope
// (React.cache, AsyncLocalStorage, etc.).
export const serverNoMutableModuleState = defineRule<Rule>({
  framework: "global",
  severity: "error",
  category: "Server",
  recommendation:
    "Move per-request data into the action body, headers/cookies, or a request-scope (React.cache, AsyncLocalStorage). Module-scope `let`/`var` is shared across requests.",
  examples: [
    {
      before:
        "'use server';\nlet currentUser: User | null = null;\nexport async function action() { currentUser = await getUser(); }",
      after:
        "'use server';\nimport { cookies } from 'next/headers';\nexport async function action() {\n  const user = await getUser();\n  cookies().set('uid', user.id);\n}",
    },
  ],
  create: (context: RuleContext) => {
    let fileHasUseServerDirective = false;

    return {
      Program(programNode: EsTreeNodeOfType<"Program">) {
        fileHasUseServerDirective = hasDirective(programNode, "use server");
      },
      VariableDeclaration(node: EsTreeNodeOfType<"VariableDeclaration">) {
        if (!fileHasUseServerDirective) return;
        if (!isNodeOfType(node.parent, "Program")) return;

        for (const declarator of node.declarations ?? []) {
          const variableName = isNodeOfType(declarator.id, "Identifier")
            ? declarator.id.name
            : "<unnamed>";

          if (node.kind === "let" || node.kind === "var") {
            context.report({
              node: declarator,
              message: `Module-scoped ${node.kind} "${variableName}" in a "use server" file — this is shared across requests; move per-request data into the action body`,
            });
            continue;
          }

          // const + mutable container — same hazard, the binding is fixed
          // but the contents leak across requests.
          const containerKind = isMutableConstInitializer(declarator.init);
          if (containerKind) {
            context.report({
              node: declarator,
              message: `Module-scoped const "${variableName} = ${containerKind}" in a "use server" file — the container itself is shared across requests; move per-request data into the action body`,
            });
          }
        }
      },
    };
  },
});
