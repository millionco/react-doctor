import { APP_DIRECTORY_PATTERN, GLOBAL_ERROR_FILE_PATTERN } from "../../constants/nextjs.js";
import { defineRule } from "../../utils/define-rule.js";
import { normalizeFilename } from "../../utils/normalize-filename.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const fileContainsJsxElement = (programNode: EsTreeNode, tagName: string): boolean => {
  let didFind = false;
  walkAst(programNode, (child: EsTreeNode) => {
    if (didFind) return false;
    if (
      isNodeOfType(child, "JSXOpeningElement") &&
      isNodeOfType(child.name, "JSXIdentifier") &&
      child.name.name === tagName
    ) {
      didFind = true;
      return false;
    }
  });
  return didFind;
};

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

      const hasHtmlTag = fileContainsJsxElement(programNode, "html");
      const hasBodyTag = fileContainsJsxElement(programNode, "body");

      if (!hasHtmlTag || !hasBodyTag) {
        const missingTags = [!hasHtmlTag && "<html>", !hasBodyTag && "<body>"]
          .filter(Boolean)
          .join(" and ");

        context.report({
          node: programNode,
          message: `global-error.tsx is missing ${missingTags}. The root layout unmounts on error, so this page renders broken HTML.`,
        });
      }
    },
  }),
});
