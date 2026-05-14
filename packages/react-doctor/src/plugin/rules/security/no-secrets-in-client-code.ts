import {
  SECRET_FALSE_POSITIVE_SUFFIXES,
  SECRET_MIN_LENGTH_CHARS,
  SECRET_PATTERNS,
  SECRET_VARIABLE_PATTERN,
} from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noSecretsInClientCode = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "Security",
  recommendation:
    "Move to server-side `process.env.SECRET_NAME`. Only `NEXT_PUBLIC_*` vars are safe for the client (and should not contain secrets)",
  examples: [
    {
      before:
        "'use client';\nconst apiKey = 'sk_live_abc123def456ghi789';\nfetch(`/api?key=${apiKey}`);",
      after: "'use client';\nfetch('/api/proxy');",
    },
  ],
  create: (context: RuleContext) => ({
    VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
      if (!isNodeOfType(node.id, "Identifier")) return;
      if (!isNodeOfType(node.init, "Literal") || typeof node.init.value !== "string") return;

      const variableName = node.id.name;
      const literalValue = node.init.value;

      const trailingSuffix = variableName.split("_").pop()?.toLowerCase() ?? "";
      const isUiConstant = SECRET_FALSE_POSITIVE_SUFFIXES.has(trailingSuffix);

      if (
        SECRET_VARIABLE_PATTERN.test(variableName) &&
        !isUiConstant &&
        literalValue.length > SECRET_MIN_LENGTH_CHARS
      ) {
        context.report({
          node,
          message: `Possible hardcoded secret in "${variableName}" — use environment variables instead`,
        });
        return;
      }

      if (SECRET_PATTERNS.some((pattern) => pattern.test(literalValue))) {
        context.report({
          node,
          message: "Hardcoded secret detected — use environment variables instead",
        });
      }
    },
  }),
});
