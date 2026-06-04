import { APP_DIRECTORY_PATTERN, ERROR_BOUNDARY_FILE_PATTERN } from "../../constants/nextjs.js";
import { defineRule } from "../../utils/define-rule.js";
import { hasDirective } from "../../utils/has-directive.js";
import { normalizeFilename } from "../../utils/normalize-filename.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const nextjsErrorBoundaryMissingUseClient = defineRule<Rule>({
  id: "nextjs-error-boundary-missing-use-client",
  title: "Error boundary missing 'use client'",
  tags: ["test-noise"],
  requires: ["nextjs"],
  severity: "error",
  recommendation:
    "Add `'use client'` at the top of this file. Error boundaries must be Client Components to catch and render fallback UI",
  create: (context: RuleContext) => ({
    Program(programNode: EsTreeNodeOfType<"Program">) {
      const filename = normalizeFilename(context.filename ?? "");
      if (!APP_DIRECTORY_PATTERN.test(filename)) return;
      if (!ERROR_BOUNDARY_FILE_PATTERN.test(filename)) return;
      if (hasDirective(programNode, "use client")) return;

      context.report({
        node: programNode,
        message:
          "This error boundary silently does nothing without 'use client'. Next.js requires error.tsx to be a Client Component.",
      });
    },
  }),
});
