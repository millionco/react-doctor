import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isDirectMethodCallOnZodFactory } from "./utils/zod-ast.js";

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

export const zodV4PreferTopLevelStringFormats = defineRule<Rule>({
  id: "zod-v4-prefer-top-level-string-formats",
  requires: ["zod:4"],
  tags: ["migration-hint"],
  severity: "warn",
  recommendation:
    "Replace deprecated `z.string().<format>()` calls with Zod 4 top-level string format APIs like `z.email()`, `z.uuid()`, `z.ipv4()`, or `z.cidrv4()`.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isDirectMethodCallOnZodFactory(node, ZOD_STRING_FACTORY, STRING_FORMAT_METHODS)) return;
      context.report({
        node,
        message:
          "Zod 4 deprecates string format methods on `z.string()`; use the matching top-level Zod format API instead.",
      });
    },
  }),
});
