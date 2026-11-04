import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { hasGlobalNamespaceMutation } from "./has-global-namespace-mutation.js";
import {
  isProvenGlobalObjectReference,
  isProvenGlobalNamespaceReference,
} from "./is-proven-global-namespace-reference.js";

export const isProvenUnmodifiedGlobalNamespaceReference = (
  expression: EsTreeNode,
  namespaceName: string | null,
  scopes: ScopeAnalysis,
  memberName?: string,
  considerEscapes = false,
): boolean =>
  (namespaceName === null
    ? isProvenGlobalObjectReference(expression, scopes)
    : isProvenGlobalNamespaceReference(expression, namespaceName, scopes)) &&
  !hasGlobalNamespaceMutation(namespaceName, scopes, memberName, considerEscapes);
