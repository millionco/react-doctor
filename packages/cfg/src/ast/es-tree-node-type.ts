import type { TSESTree } from "@typescript-eslint/types";

// TSESTree models `type` as `AST_NODE_TYPES` enum members. Wrapping the union
// in a template literal widens it to the underlying string-literal values, so
// callers can pass plain strings like `"FunctionDeclaration"` to `isNodeOfType`
// without importing the enum.
export type EsTreeNodeType = `${TSESTree.Node["type"]}`;
