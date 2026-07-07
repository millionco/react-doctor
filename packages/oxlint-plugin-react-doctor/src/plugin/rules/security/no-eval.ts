import { defineRule } from "../../utils/define-rule.js";
import { normalizeFilename } from "../../utils/normalize-filename.js";
import { skipNonProductionFiles } from "../../utils/skip-non-production-files.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// A hyphen-delimited `sandbox` path segment (`lib/plugin-sandbox/runtime.tsx`,
// `sandbox-runtime.ts`) marks the sandboxed-evaluation surface the fix
// guidance itself prescribes — a null-origin iframe or worker whose whole job
// is running plugin code. Dynamic evaluation there IS the mitigation.
// Hyphen boundaries keep `CodeSandboxEmbed.tsx` / `codesandbox.ts` firing.
const SANDBOX_SURFACE_PATH_PATTERN =
  /(?:^|[/-])sandbox(?:$|[/-])|(?:^|\/)[\w.]+-sandbox(?:\/|\.[cm]?[jt]sx?$)/i;

export const noEval = defineRule({
  id: "no-eval",
  title: "eval() runs untrusted code strings",
  severity: "error",
  recommendation:
    "Use `JSON.parse` for data, or rewrite the code so it doesn't build and run code from strings.",
  create: skipNonProductionFiles((context: RuleContext): RuleVisitors => {
    if (SANDBOX_SURFACE_PATH_PATTERN.test(normalizeFilename(context.filename ?? ""))) return {};
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (isNodeOfType(node.callee, "Identifier") && node.callee.name === "eval") {
          context.report({
            node,
            message: "eval() is a code-injection vulnerability: it runs any string as code.",
          });
          return;
        }

        if (
          isNodeOfType(node.callee, "Identifier") &&
          (node.callee.name === "setTimeout" || node.callee.name === "setInterval") &&
          isNodeOfType(node.arguments?.[0], "Literal") &&
          typeof node.arguments[0].value === "string"
        ) {
          context.report({
            node,
            message: `Passing a string to ${node.callee.name}() is a code-injection vulnerability, since it runs that string as code.`,
          });
        }
      },
      NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
        if (isNodeOfType(node.callee, "Identifier") && node.callee.name === "Function") {
          // `new Function("return this")` is the ubiquitous globalThis polyfill
          // (webpack runtime, core-js): a constant body with no injectable input.
          const onlyArgument = node.arguments.length === 1 ? node.arguments[0] : undefined;
          if (
            isNodeOfType(onlyArgument, "Literal") &&
            typeof onlyArgument.value === "string" &&
            onlyArgument.value.trim() === "return this"
          ) {
            return;
          }
          context.report({
            node,
            message:
              "new Function() is a code-injection vulnerability: it builds & runs code from a string.",
          });
        }
      },
    };
  }),
});
