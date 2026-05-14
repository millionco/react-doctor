import { defineRule } from "../../utils/define-rule.js";
import { hasDirective } from "../../utils/has-directive.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isUppercaseName } from "../../utils/is-uppercase-name.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

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
      Program(programNode: EsTreeNode) {
        fileHasUseClient = hasDirective(programNode, "use client");
      },
      FunctionDeclaration(node: EsTreeNode) {
        if (!fileHasUseClient || !node.async) return;
        if (!node.id?.name || !isUppercaseName(node.id.name)) return;
        context.report({
          node,
          message: `Async client component "${node.id.name}" — client components cannot be async`,
        });
      },
      VariableDeclarator(node: EsTreeNode) {
        if (!fileHasUseClient) return;
        if (!isComponentAssignment(node) || !node.init?.async) return;
        context.report({
          node,
          message: `Async client component "${node.id.name}" — client components cannot be async`,
        });
      },
    };
  },
});
