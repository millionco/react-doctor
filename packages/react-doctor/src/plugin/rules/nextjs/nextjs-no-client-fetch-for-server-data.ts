import { PAGES_DIRECTORY_PATTERN, PAGE_OR_LAYOUT_FILE_PATTERN } from "../../constants/nextjs.js";
import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { containsFetchCall } from "../../utils/contains-fetch-call.js";
import { defineRule } from "../../utils/define-rule.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { hasDirective } from "../../utils/has-directive.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const nextjsNoClientFetchForServerData = defineRule<Rule>({
  id: "nextjs-no-client-fetch-for-server-data",
  requires: ["nextjs"],
  severity: "warn",
  recommendation:
    "Remove 'use client' and fetch directly in the Server Component — no API round-trip, secrets stay on server",
  create: (context: RuleContext) => {
    let fileHasUseClient = false;

    return {
      Program(programNode: EsTreeNodeOfType<"Program">) {
        fileHasUseClient = hasDirective(programNode, "use client");
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!fileHasUseClient || !isHookCall(node, EFFECT_HOOK_NAMES)) return;

        const callback = getEffectCallback(node);
        if (!callback || !containsFetchCall(callback)) return;

        const filename = context.getFilename?.() ?? "";
        const isPageOrLayoutFile =
          PAGE_OR_LAYOUT_FILE_PATTERN.test(filename) || PAGES_DIRECTORY_PATTERN.test(filename);

        if (isPageOrLayoutFile) {
          context.report({
            node,
            message:
              "useEffect + fetch in a page/layout — fetch data server-side with a server component instead",
          });
        }
      },
    };
  },
});
