import { defineRule } from "../../utils/define-rule.js";
import { hasDirective } from "../../utils/has-directive.js";
import { isInlineFunctionExpression } from "../../utils/is-inline-function-expression.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import {
  OBJECT_FREEZE_OR_SEAL_METHOD_NAMES,
  unwrapObjectIntegrityExpression,
} from "../../utils/unwrap-object-integrity-expression.js";

export const nextjsAsyncClientComponent = defineRule({
  id: "nextjs-async-client-component",
  title: "Async client component",
  tags: ["test-noise"],
  requires: ["nextjs"],
  severity: "error",
  recommendation:
    "Fetch data in a parent Server Component and pass it as props, or use useQuery/useSWR in the client component",
  create: (context: RuleContext) => {
    let fileHasUseClient = false;

    return {
      Program(programNode: EsTreeNodeOfType<"Program">) {
        fileHasUseClient = hasDirective(programNode, "use client");
      },
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        if (!fileHasUseClient || !node.async) return;
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        context.report({
          node,
          message: `Async client component "${node.id.name}" fails to render because client components can't be async.`,
        });
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!fileHasUseClient) return;
        if (!isNodeOfType(node.id, "Identifier")) return;
        if (!isUppercaseName(node.id.name) || !node.init) return;
        const componentFunction = unwrapObjectIntegrityExpression(
          node.init,
          context.scopes,
          OBJECT_FREEZE_OR_SEAL_METHOD_NAMES,
        );
        if (!isInlineFunctionExpression(componentFunction) || !componentFunction.async) return;
        context.report({
          node,
          message: `Async client component "${node.id.name}" fails to render because client components can't be async.`,
        });
      },
    };
  },
});
