import type { EsTreeNode } from "./es-tree-node.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { findVariableInitializer } from "./find-variable-initializer.js";
import { flattenCalleeName } from "./flatten-callee-name.js";
import {
  getImportedNameFromModule,
  isNamespaceImportFromModule,
} from "./find-import-source-for-name.js";
import { isNodeOfType } from "./is-node-of-type.js";

// `React.memo(Component, arePropsEqual)` compares props with the author's
// own function, which routinely ignores reference identity (element-wise or
// field-wise comparison — antd's MemoInput, json-edit-react's
// CollectionNode). A fresh array/object per render cannot break that
// bailout, so the jsx-no-new-*-as-prop premise does not hold there.
const MEMO_CALLEE_NAMES: ReadonlySet<string> = new Set(["memo", "React.memo"]);

// `shallowEqual` still compares each prop with Object.is, so a fresh
// reference per render defeats it exactly like the default comparator;
// `memo(Component, undefined)` falls back to the default comparator.
export const isIdentitySensitiveMemoComparator = (
  comparatorNode: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (isNodeOfType(comparatorNode, "Identifier")) {
    if (comparatorNode.name === "undefined") return scopes.isGlobalReference(comparatorNode);
    return (
      getImportedNameFromModule(comparatorNode, comparatorNode.name, "react-redux") ===
      "shallowEqual"
    );
  }
  if (
    !isNodeOfType(comparatorNode, "MemberExpression") ||
    comparatorNode.computed ||
    !isNodeOfType(comparatorNode.object, "Identifier") ||
    !isNodeOfType(comparatorNode.property, "Identifier") ||
    comparatorNode.property.name !== "shallowEqual"
  ) {
    return false;
  }
  return isNamespaceImportFromModule(comparatorNode, comparatorNode.object.name, "react-redux");
};

export const hasCustomMemoComparator = (
  openingName: EsTreeNode | null,
  scopes: ScopeAnalysis,
): boolean => {
  if (!openingName || !isNodeOfType(openingName, "JSXIdentifier")) return false;
  const binding = findVariableInitializer(openingName, openingName.name);
  if (!binding || !binding.initializer) return false;
  const initializer = binding.initializer;
  if (!isNodeOfType(initializer, "CallExpression")) return false;
  const calleeName = flattenCalleeName(initializer.callee as EsTreeNode);
  if (calleeName === null || !MEMO_CALLEE_NAMES.has(calleeName)) return false;
  const comparatorNode = (initializer.arguments ?? [])[1];
  if (!comparatorNode) return false;
  return !isIdentitySensitiveMemoComparator(comparatorNode as EsTreeNode, scopes);
};
