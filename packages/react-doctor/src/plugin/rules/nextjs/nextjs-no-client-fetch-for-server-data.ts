import {
  EFFECT_HOOK_NAMES,
  PAGES_DIRECTORY_PATTERN,
  PAGE_OR_LAYOUT_FILE_PATTERN,
} from "../../constants.js";
import { containsFetchCall } from "../../utils/contains-fetch-call.js";
import { defineRule } from "../../utils/define-rule.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { hasDirective } from "../../utils/has-directive.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const nextjsNoClientFetchForServerData = defineRule<Rule>({
  requires: ["nextjs"],
  framework: "nextjs",
  severity: "warn",
  category: "Next.js",
  recommendation:
    "Remove 'use client' and fetch directly in the Server Component — no API round-trip, secrets stay on server",
  examples: [
    {
      before:
        "'use client';\nexport default function Page() {\n  const [data, setData] = useState();\n  useEffect(() => { fetch('/api/posts').then((r) => r.json()).then(setData); }, []);\n  return <List data={data} />;\n}",
      after:
        "export default async function Page() {\n  const data = await fetch('https://api.example.com/posts').then((r) => r.json());\n  return <List data={data} />;\n}",
    },
  ],
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
