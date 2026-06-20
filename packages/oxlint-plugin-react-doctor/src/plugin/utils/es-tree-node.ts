// Single source of truth lives in `@react-doctor/cfg`; the plugin re-exports
// it so the cross-package AST contract can't drift between two copies.
export type { EsTreeNode } from "@react-doctor/cfg";
