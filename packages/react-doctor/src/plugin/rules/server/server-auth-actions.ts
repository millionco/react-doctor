import { AUTH_CHECK_LOOKAHEAD_STATEMENTS, AUTH_FUNCTION_NAMES } from "../../constants/security.js";
import { defineRule } from "../../utils/define-rule.js";
import { hasDirective } from "../../utils/has-directive.js";
import { hasUseServerDirective } from "../../utils/has-use-server-directive.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const containsAuthCheck = (statements: EsTreeNode[]): boolean => {
  let foundAuthCall = false;
  for (const statement of statements) {
    walkAst(statement, (child: EsTreeNode) => {
      if (foundAuthCall) return;
      let callNode: EsTreeNode | null = null;
      if (isNodeOfType(child, "CallExpression")) {
        callNode = child;
      } else if (
        isNodeOfType(child, "AwaitExpression") &&
        isNodeOfType(child.argument, "CallExpression")
      ) {
        callNode = child.argument;
      }

      if (
        isNodeOfType(callNode?.callee, "Identifier") &&
        AUTH_FUNCTION_NAMES.has(callNode.callee.name)
      ) {
        foundAuthCall = true;
      }
    });
  }
  return foundAuthCall;
};

export const serverAuthActions = defineRule<Rule>({
  id: "server-auth-actions",
  severity: "error",
  recommendation:
    "Add `const session = await auth()` at the top and throw/redirect if unauthorized before any data access",
  create: (context: RuleContext) => {
    let fileHasUseServerDirective = false;

    return {
      Program(programNode: EsTreeNodeOfType<"Program">) {
        fileHasUseServerDirective = hasDirective(programNode, "use server");
      },
      ExportNamedDeclaration(node: EsTreeNodeOfType<"ExportNamedDeclaration">) {
        const declaration = node.declaration;
        if (!isNodeOfType(declaration, "FunctionDeclaration") || !declaration?.async) return;

        const isServerAction = fileHasUseServerDirective || hasUseServerDirective(declaration);
        if (!isServerAction) return;

        const firstStatements = (declaration.body?.body ?? []).slice(
          0,
          AUTH_CHECK_LOOKAHEAD_STATEMENTS,
        );
        if (!containsAuthCheck(firstStatements)) {
          const functionName = declaration.id?.name ?? "anonymous";
          context.report({
            node: declaration.id ?? node,
            message: `Server action "${functionName}" — add auth check (auth(), getSession(), etc.) at the top`,
          });
        }
      },
    };
  },
});
