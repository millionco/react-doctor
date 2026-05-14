import { defineRule } from "../../utils/define-rule.js";
import { hasDirective } from "../../utils/has-directive.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const nextjsAsyncClientComponent = defineRule<Rule>({
  requires: ["nextjs"],
  framework: "nextjs",
  severity: "error",
  category: "Next.js",
  recommendation:
    "Fetch data in a parent Server Component and pass it as props, or use useQuery/useSWR in the client component",
  examples: [
    {
      before:
        "'use client';\nexport default async function Page() {\n  const data = await fetch('/api/data').then((r) => r.json());\n  return <div>{data.title}</div>;\n}",
      after:
        "'use client';\nimport useSWR from 'swr';\nexport default function Page() {\n  const { data } = useSWR('/api/data', (u) => fetch(u).then((r) => r.json()));\n  return <div>{data?.title}</div>;\n}",
    },
  ],
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
          message: `Async client component "${node.id.name}" — client components cannot be async`,
        });
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!fileHasUseClient) return;
        if (!isComponentAssignment(node)) return;
        if (
          !isNodeOfType(node.init, "ArrowFunctionExpression") &&
          !isNodeOfType(node.init, "FunctionExpression")
        )
          return;
        if (!node.init.async) return;
        if (!isNodeOfType(node.id, "Identifier")) return;
        context.report({
          node,
          message: `Async client component "${node.id.name}" — client components cannot be async`,
        });
      },
    };
  },
});
