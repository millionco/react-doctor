import { defineRule } from "../../utils/define-rule.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { normalizeFilename } from "../../utils/normalize-filename.js";
import { PAGE_FILE_PATTERN } from "../../constants/nextjs.js";

// HACK: file-level proxy for "is the developer aware of the Suspense
// requirement?". Cross-file ancestor analysis would catch every case
// correctly but isn't tractable in a per-file lint pass. If <Suspense>
// appears anywhere in the file (as a JSX element OR a named import from
// React) we trust the developer is rendering the useSearchParams()
// consumer behind it.
//
// Additionally, we only fire on Next.js page files (`page.tsx`). Non-page
// component files are expected to be composed with Suspense by their
// consumers — flagging them produces false positives when the parent
// file provides the boundary (see #695).
const fileMentionsSuspense = (programNode: EsTreeNode): boolean => {
  let didSee = false;
  walkAst(programNode, (child: EsTreeNode) => {
    if (didSee) return false;
    if (
      isNodeOfType(child, "JSXOpeningElement") &&
      isNodeOfType(child.name, "JSXIdentifier") &&
      child.name.name === "Suspense"
    ) {
      didSee = true;
      return false;
    }
    if (isNodeOfType(child, "ImportDeclaration") && child.source?.value === "react") {
      const importsSuspense = (child.specifiers ?? []).some(
        (specifier: EsTreeNode) =>
          isNodeOfType(specifier, "ImportSpecifier") && getImportedName(specifier) === "Suspense",
      );
      if (importsSuspense) {
        didSee = true;
        return false;
      }
    }
  });
  return didSee;
};

export const nextjsNoUseSearchParamsWithoutSuspense = defineRule<Rule>({
  id: "nextjs-no-use-search-params-without-suspense",
  title: "useSearchParams without Suspense",
  tags: ["test-noise"],
  requires: ["nextjs"],
  severity: "warn",
  recommendation:
    "Wrap the component using useSearchParams: `<Suspense fallback={<Skeleton />}><SearchComponent /></Suspense>`",
  create: (context: RuleContext) => {
    let hasSuspenseInFile = false;
    let isPageFile = false;

    return {
      Program(programNode: EsTreeNodeOfType<"Program">) {
        const filename = normalizeFilename(context.filename ?? "");
        isPageFile = PAGE_FILE_PATTERN.test(filename);
        hasSuspenseInFile = fileMentionsSuspense(programNode);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isPageFile) return;
        if (hasSuspenseInFile) return;
        if (!isHookCall(node, "useSearchParams")) return;
        context.report({
          node,
          message:
            "useSearchParams() without a <Suspense> boundary forces the whole page into client-side rendering.",
        });
      },
    };
  },
});
