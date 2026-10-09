import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingClass } from "./find-enclosing-class.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";

export const isAngularComponentClass = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const enclosingClass = findEnclosingClass(node);
  return Boolean(
    enclosingClass?.decorators?.some((decorator) => {
      if (!isNodeOfType(decorator.expression, "CallExpression")) return false;
      const imported = resolveImportedApiReference(decorator.expression.callee, scopes);
      return imported?.source === "@angular/core" && imported.importedName === "Component";
    }),
  );
};
