import { defineRule } from "../../utils/define-rule.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// HACK: file-level proxy for "is the developer aware of the Suspense
// requirement?". Cross-file ancestor analysis would catch every case
// correctly but isn't tractable in a per-file lint pass; the official
// `@next/next/no-use-search-params-without-suspense-bailout` rule uses
// the same heuristic. If <Suspense> appears anywhere in the file (as a
// JSX element OR a named import from React) we trust the developer is
// rendering the useSearchParams() consumer behind it.
//
// KNOWN LIMITATION (false negative): a file that imports `Suspense`
// from React for an unrelated reason (re-export, type reference, etc.)
// silences ALL `useSearchParams()` reports in that file. We accept the
// trade-off because a false POSITIVE here is much louder for end users
// than a false negative.
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
  requires: ["nextjs"],
  severity: "warn",
  recommendation:
    "Wrap the component using useSearchParams: `<Suspense fallback={<Skeleton />}><SearchComponent /></Suspense>`",
  create: (context: RuleContext) => {
    let hasSuspenseInFile = false;

    return {
      Program(programNode: EsTreeNodeOfType<"Program">) {
        hasSuspenseInFile = fileMentionsSuspense(programNode);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (hasSuspenseInFile) return;
        if (!isHookCall(node, "useSearchParams")) return;
        context.report({
          node,
          message:
            "useSearchParams() requires a <Suspense> boundary — without one, the entire page bails out to client-side rendering",
        });
      },
    };
  },
});
