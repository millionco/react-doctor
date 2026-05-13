import { defineRule } from "../../utils/define-rule.js";
import { hasDirective } from "../../utils/has-directive.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MUTABLE_CONTAINER_CONSTRUCTORS = new Set(["Map", "Set", "WeakMap", "WeakSet"]);

const isMutableConstInitializer = (init: EsTreeNode | null | undefined): string | null => {
  if (!init) return null;
  if (init.type === "ArrayExpression") return "[]";
  if (init.type === "ObjectExpression") return "{}";
  if (
    init.type === "NewExpression" &&
    init.callee?.type === "Identifier" &&
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
  recommendation:
    "Move per-request data into the action body, headers/cookies, or a request-scope (React.cache, AsyncLocalStorage). Module-scope `let`/`var` is shared across requests.",
  create: (context: RuleContext) => {
    let fileHasUseServerDirective = false;

    return {
      Program(programNode: EsTreeNode) {
        fileHasUseServerDirective = hasDirective(programNode, "use server");
      },
      VariableDeclaration(node: EsTreeNode) {
        if (!fileHasUseServerDirective) return;
        if (node.parent?.type !== "Program") return;

        for (const declarator of node.declarations ?? []) {
          const variableName =
            declarator.id?.type === "Identifier" ? declarator.id.name : "<unnamed>";

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
