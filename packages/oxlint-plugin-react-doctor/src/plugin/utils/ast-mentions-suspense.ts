import type { EsTreeNode } from "./es-tree-node.js";
import { getImportedName } from "./get-imported-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

// Matches a JSX element named `Suspense` (`<Suspense>`) or the member
// form `<React.Suspense>` (any `<*.Suspense>`). Aliased local names
// (`import { Suspense as X }`) are covered by the import check instead.
const isSuspenseJsxOpeningName = (name: EsTreeNode | null | undefined): boolean => {
  if (isNodeOfType(name, "JSXIdentifier")) return name.name === "Suspense";
  return (
    isNodeOfType(name, "JSXMemberExpression") &&
    isNodeOfType(name.property, "JSXIdentifier") &&
    name.property.name === "Suspense"
  );
};

// HACK: file-level proxy for "does this file establish a <Suspense>
// boundary?". A precise check would confirm the boundary wraps the
// useSearchParams() consumer, but that's not tractable per-file; the
// official `@next/next/no-use-search-params-without-suspense-bailout`
// rule uses the same heuristic. If <Suspense> (or <React.Suspense>)
// appears as a JSX element OR `Suspense` is imported from React, we
// trust the developer renders the consumer behind it.
//
// KNOWN LIMITATION (false negative): importing `Suspense` for an
// unrelated reason suppresses the report. Accepted — a false POSITIVE
// is much louder for end users than a false negative.
export const astMentionsSuspense = (programNode: EsTreeNode): boolean => {
  let didDetect = false;
  walkAst(programNode, (child: EsTreeNode) => {
    if (didDetect) return false;
    if (isNodeOfType(child, "JSXOpeningElement") && isSuspenseJsxOpeningName(child.name)) {
      didDetect = true;
      return false;
    }
    if (isNodeOfType(child, "ImportDeclaration") && child.source?.value === "react") {
      const importsSuspense = (child.specifiers ?? []).some(
        (specifier: EsTreeNode) =>
          isNodeOfType(specifier, "ImportSpecifier") && getImportedName(specifier) === "Suspense",
      );
      if (importsSuspense) {
        didDetect = true;
        return false;
      }
    }
  });
  return didDetect;
};
