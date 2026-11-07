import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import { isClosedJsonSnapshotInactiveBranch } from "./is-closed-json-snapshot-inactive-branch.js";

export const hasClosedJsonSnapshotJsxReferences = (
  symbol: SymbolDescriptor,
  allowNamespace = false,
): boolean =>
  symbol.references.every((reference) => {
    if (isClosedJsonSnapshotInactiveBranch(reference.identifier)) return true;
    if (reference.flag !== "read") return false;
    const parent = reference.identifier.parent;
    const tag =
      allowNamespace &&
      parent?.type === "JSXMemberExpression" &&
      parent.object === reference.identifier
        ? parent
        : reference.identifier;
    const element = tag.parent;
    return (
      (element?.type === "JSXOpeningElement" || element?.type === "JSXClosingElement") &&
      element.name === tag
    );
  });
