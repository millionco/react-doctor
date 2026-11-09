import type { EsTreeNode } from "./es-tree-node.js";
import type {
  ClosedJsonSnapshotModule,
  ClosedJsonSnapshotProject,
} from "./get-closed-json-snapshot-project.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { SNAPSHOT_BOOTSTRAP_PREFIX_SOURCES } from "./closed-json-snapshot-config/constants.js";
import { CLOSED_JSON_SNAPSHOT_RESOURCE_IMPORT_PATTERN } from "./closed-json-snapshot/constants.js";

export interface ClosedJsonSnapshotSideEffectRequireInput {
  readonly node: EsTreeNode;
  readonly module: ClosedJsonSnapshotModule;
  readonly project: ClosedJsonSnapshotProject;
}

export const isClosedJsonSnapshotSideEffectRequire = ({
  node,
  module,
  project,
}: ClosedJsonSnapshotSideEffectRequireInput): boolean => {
  if (
    !isNodeOfType(node, "CallExpression") ||
    node.optional ||
    !isNodeOfType(node.callee, "Identifier") ||
    node.callee.name !== "require" ||
    !module.scopes.isGlobalReference(node.callee) ||
    node.arguments.length !== 1 ||
    !isNodeOfType(node.arguments[0], "Literal") ||
    typeof node.arguments[0].value !== "string" ||
    !isNodeOfType(node.parent, "ExpressionStatement") ||
    node.parent.expression !== node
  )
    return false;
  const source = node.arguments[0].value;
  return (
    project.resolveImport(module.filePath, source) !== null ||
    SNAPSHOT_BOOTSTRAP_PREFIX_SOURCES.includes(source) ||
    CLOSED_JSON_SNAPSHOT_RESOURCE_IMPORT_PATTERN.test(source)
  );
};
