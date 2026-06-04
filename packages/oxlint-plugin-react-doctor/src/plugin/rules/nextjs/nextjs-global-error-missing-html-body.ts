import { APP_DIRECTORY_PATTERN, GLOBAL_ERROR_FILE_PATTERN } from "../../constants/nextjs.js";
import { defineRule } from "../../utils/define-rule.js";
import { fileContainsJsxElements } from "../../utils/file-contains-jsx-elements.js";
import { normalizeFilename } from "../../utils/normalize-filename.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const REQUIRED_HTML_TAGS = ["html", "body"] as const;

export const nextjsGlobalErrorMissingHtmlBody = defineRule<Rule>({
  id: "nextjs-global-error-missing-html-body",
  title: "global-error.tsx missing <html>/<body>",
  tags: ["test-noise"],
  requires: ["nextjs"],
  severity: "error",
  recommendation:
    "Wrap your error UI in `<html><body>...</body></html>`. The root layout is unmounted when global-error renders",
  create: (context: RuleContext) => ({
    Program(programNode: EsTreeNodeOfType<"Program">) {
      const filename = normalizeFilename(context.filename ?? "");
      if (!APP_DIRECTORY_PATTERN.test(filename)) return;
      if (!GLOBAL_ERROR_FILE_PATTERN.test(filename)) return;

      const foundTags = fileContainsJsxElements(programNode, REQUIRED_HTML_TAGS);
      const missingTags = REQUIRED_HTML_TAGS.filter((tagName) => !foundTags.has(tagName)).map(
        (tagName) => `<${tagName}>`,
      );

      if (missingTags.length > 0) {
        context.report({
          node: programNode,
          message: `global-error.tsx is missing ${missingTags.join(" and ")}. The root layout unmounts on error, so this page renders broken HTML.`,
        });
      }
    },
  }),
});
