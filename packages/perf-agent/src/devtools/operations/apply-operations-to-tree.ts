import {
  ELEMENT_TYPE_ROOT,
  TREE_OPERATION_ADD,
  TREE_OPERATION_APPLIED_ACTIVITY_SLICE_CHANGE,
  TREE_OPERATION_REMOVE,
  TREE_OPERATION_REORDER_CHILDREN,
  TREE_OPERATION_SET_SUBTREE_MODE,
  TREE_OPERATION_UPDATE_ERRORS_OR_WARNINGS,
  TREE_OPERATION_UPDATE_TREE_BASE_DURATION,
} from "../../constants.js";
import type { DevtoolsElementTree } from "../../types/element-tree.js";
import { parseElementDisplayName } from "../../utils/parse-element-display-name.js";

export interface ApplyOperationsResult {
  rendererID: number;
  rootID: number;
  // True when an unknown / variable-width opcode (e.g. a Suspense op) was hit
  // and parsing stopped early to avoid desyncing the tree.
  bailed: boolean;
}

const decodeString = (operations: Array<number>, left: number, right: number): string => {
  let result = "";
  for (let index = left; index <= right; index++) {
    result += String.fromCodePoint(operations[index] ?? 0);
  }
  return result;
};

/**
 * Port of the tree-mutating half of React DevTools' `Store.onBridgeOperations`.
 * Applies one operations array to a mutable element tree so we can later take a
 * snapshot for the profiling export. Handles the fixed-width opcodes; bails
 * (without mutating further) on the variable-width Suspense opcodes, which we
 * cannot size without the full Store.
 */
export const applyOperationsToTree = (
  tree: DevtoolsElementTree,
  operations: Array<number>,
): ApplyOperationsResult => {
  const rendererID = operations[0] ?? 0;
  const rootID = operations[1] ?? 0;

  let cursor = 2;
  const stringTable: Array<string | null> = [null];
  const stringTableSize = operations[cursor] ?? 0;
  cursor++;
  const stringTableEnd = cursor + stringTableSize;
  while (cursor < stringTableEnd) {
    const nextLength = operations[cursor] ?? 0;
    cursor++;
    stringTable.push(decodeString(operations, cursor, cursor + nextLength - 1));
    cursor += nextLength;
  }

  while (cursor < operations.length) {
    const operation = operations[cursor];
    switch (operation) {
      case TREE_OPERATION_ADD: {
        const id = operations[cursor + 1] ?? 0;
        const type = operations[cursor + 2] ?? 0;
        cursor += 3;
        if (type === ELEMENT_TYPE_ROOT) {
          // isStrictModeCompliant, profilerFlags, supportsStrictMode, hasOwnerMetadata
          cursor += 4;
          tree.set(id, {
            id,
            parentID: 0,
            type,
            displayName: null,
            hocDisplayNames: null,
            key: null,
            compiledWithForget: false,
            children: [],
          });
        } else {
          const parentID = operations[cursor] ?? 0;
          cursor++;
          cursor++; // ownerID
          const rawDisplayName = stringTable[operations[cursor] ?? 0] ?? null;
          cursor++;
          const key = stringTable[operations[cursor] ?? 0] ?? null;
          cursor++;
          cursor++; // namePropStringID
          const parsed = parseElementDisplayName(rawDisplayName, type);
          tree.set(id, {
            id,
            parentID,
            type,
            displayName: parsed.formattedDisplayName,
            hocDisplayNames: parsed.hocDisplayNames,
            key,
            compiledWithForget: parsed.compiledWithForget,
            children: [],
          });
          const parent = tree.get(parentID);
          if (parent !== undefined) parent.children.push(id);
        }
        break;
      }
      case TREE_OPERATION_REMOVE: {
        const removeLength = operations[cursor + 1] ?? 0;
        cursor += 2;
        for (let removeIndex = 0; removeIndex < removeLength; removeIndex++) {
          const id = operations[cursor] ?? 0;
          cursor++;
          const node = tree.get(id);
          if (node !== undefined) {
            const parent = tree.get(node.parentID);
            if (parent !== undefined) {
              const childIndex = parent.children.indexOf(id);
              if (childIndex >= 0) parent.children.splice(childIndex, 1);
            }
            tree.delete(id);
          }
        }
        break;
      }
      case TREE_OPERATION_REORDER_CHILDREN: {
        const id = operations[cursor + 1] ?? 0;
        const numChildren = operations[cursor + 2] ?? 0;
        cursor += 3;
        const reordered: Array<number> = [];
        for (let childIndex = 0; childIndex < numChildren; childIndex++) {
          reordered.push(operations[cursor + childIndex] ?? 0);
        }
        cursor += numChildren;
        const node = tree.get(id);
        if (node !== undefined) node.children = reordered;
        break;
      }
      case TREE_OPERATION_UPDATE_TREE_BASE_DURATION:
        cursor += 3;
        break;
      case TREE_OPERATION_UPDATE_ERRORS_OR_WARNINGS:
        cursor += 4;
        break;
      case TREE_OPERATION_SET_SUBTREE_MODE:
        cursor += 3;
        break;
      case TREE_OPERATION_APPLIED_ACTIVITY_SLICE_CHANGE:
        cursor += 2;
        break;
      default:
        return { rendererID, rootID, bailed: true };
    }
  }

  return { rendererID, rootID, bailed: false };
};
