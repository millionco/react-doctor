import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";

const RUNTIME_TYPESCRIPT_NODE_TYPES: ReadonlySet<string> = new Set([
  "TSParameterProperty",
  "TSImportEqualsDeclaration",
  "TSExportAssignment",
  "TSEnumDeclaration",
  "TSEnumMember",
  "TSModuleDeclaration",
  "TSModuleBlock",
  "TSDeclareFunction",
  "TSExternalModuleReference",
]);
const erasedByNode = new WeakMap<EsTreeNode, boolean>();

export const isKeyedDraftTypeReference = (node: EsTreeNode): boolean => {
  const pending: EsTreeNode[] = [];
  let current: EsTreeNode | null | undefined = node;
  let erased = false;
  while (current) {
    const cached = erasedByNode.get(current);
    if (cached !== undefined) {
      erased = cached;
      break;
    }
    pending.push(current);
    if (RUNTIME_TYPESCRIPT_NODE_TYPES.has(current.type)) break;
    if (
      isNodeOfType(current, "TSInterfaceDeclaration") ||
      isNodeOfType(current, "TSTypeAliasDeclaration") ||
      isNodeOfType(current, "TSTypeAnnotation") ||
      ((isNodeOfType(current, "ExportNamedDeclaration") ||
        isNodeOfType(current, "ExportAllDeclaration") ||
        isNodeOfType(current, "ExportSpecifier")) &&
        current.exportKind === "type") ||
      ((isNodeOfType(current, "ImportDeclaration") || isNodeOfType(current, "ImportSpecifier")) &&
        current.importKind === "type")
    ) {
      erased = true;
      break;
    }
    if (isTypeScriptTypePosition(current) && !isNodeOfType(current.parent, "TSQualifiedName")) {
      erased = !current.parent || !RUNTIME_TYPESCRIPT_NODE_TYPES.has(current.parent.type);
      break;
    }
    current = current.parent;
  }
  for (const pendingNode of pending) erasedByNode.set(pendingNode, erased);
  return erased;
};
