import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenGlobalNamespaceReference } from "./is-proven-global-namespace-reference.js";

export const isProcessStdoutMember = (
  node: EsTreeNode | null | undefined,
  scopes: ScopeAnalysis,
): boolean =>
  Boolean(
    node &&
    isNodeOfType(node, "MemberExpression") &&
    getStaticPropertyName(node) === "stdout" &&
    isProvenGlobalNamespaceReference(node.object, "process", scopes),
  );
