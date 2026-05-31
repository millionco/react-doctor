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
  title: "Format method on z.string()",
  requires: ["zod:4"],
  tags: ["migration-hint"],
  severity: "warn",
  recommendation:
    "Use the Zod 4 top-level format checks like `z.email()`, `z.uuid()`, or `z.ipv4()` instead of `z.string().<format>()`.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isDirectMethodCallOnZodFactory(node, ZOD_STRING_FACTORY, STRING_FORMAT_METHODS)) return;
      context.report({
        node,
        message: "Zod 4 deprecated format methods on `z.string()`, so they break when you upgrade.",
      });
    },
  }),
});
