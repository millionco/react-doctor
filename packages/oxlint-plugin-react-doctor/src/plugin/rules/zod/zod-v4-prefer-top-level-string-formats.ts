import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { hasImportFromModules } from "../../utils/find-import-source-for-name.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { skipNonProductionFiles } from "../../utils/skip-non-production-files.js";
import { ZOD_MODULE_SOURCES, isDirectMethodCallOnZodFactory } from "./utils/zod-ast.js";

const ZOD_STRING_FACTORY = new Set(["string"]);
const STRING_FORMAT_METHODS = new Set([
  "base64",
  "base64url",
  "cidr",
  "cidrv4",
  "cidrv6",
  "cuid",
  "cuid2",
  "date",
  "datetime",
  "duration",
  "email",
  "emoji",
  "ip",
  "ipv4",
  "ipv6",
  "jwt",
  "nanoid",
  "time",
  "ulid",
  "url",
  "uuid",
]);

export const zodV4PreferTopLevelStringFormats = defineRule({
  id: "zod-v4-prefer-top-level-string-formats",
  title: "Format method on z.string()",
  requires: ["zod:4"],
  tags: ["migration-hint"],
  severity: "warn",
  recommendation:
    "Use the Zod 4 top-level format checks like `z.email()`, `z.uuid()`, or `z.ipv4()` instead of `z.string().<format>()`.",
  // Skipped in testlike files despite the `migration-hint` tag: the rule only
  // runs once Zod 4 is already installed (`requires: ["zod:4"]`), where the
  // chained formats still function — a spec that deliberately exercises the
  // legacy `z.string().email()` shape (e.g. a form library asserting it
  // handles consumer schemas) loses coverage if "migrated".
  create: skipNonProductionFiles((context: RuleContext) => {
    let fileImportsZod = false;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        fileImportsZod = hasImportFromModules(node, ZOD_MODULE_SOURCES);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!fileImportsZod) return;
        if (!isDirectMethodCallOnZodFactory(node, ZOD_STRING_FACTORY, STRING_FORMAT_METHODS)) {
          return;
        }
        context.report({
          node,
          message:
            "This `z.string().<format>()` check is deprecated in Zod 4, so it can break during the upgrade.",
        });
      },
    };
  }),
});
