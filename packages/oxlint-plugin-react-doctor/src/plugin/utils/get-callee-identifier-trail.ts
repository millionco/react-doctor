import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

// Walks a `CallExpression`'s callee — including any intermediate
// member accesses, optional-chains, and parenthesised sub-calls — and
// yields every identifier name encountered (leaf-first). For
// `await screen.findByRole("button").focus()` the trail is
// `["focus", "findByRole", "screen"]`; for `await render(...)` it's
// just `["render"]`. Used by `async-parallel` to pattern-match the
// rightmost identifier against UI-flow / sequencing tables without
// having to enumerate every possible chain shape.
export const getCalleeIdentifierTrail = (call: EsTreeNode | null | undefined): string[] => {
  // Optional-chained awaits (`await page?.click()`) parse as a
  // `ChainExpression` wrapping the underlying `CallExpression`, so the
  // entry guard must peel any wrapping chain layers before checking
  // for the call/new — otherwise the trail would silently come back
  // empty and the UI-flow / sequencing signal would be missed.
  let entry: EsTreeNode | null | undefined = call;
  while (isNodeOfType(entry, "ChainExpression")) entry = entry.expression;
  if (!isNodeOfType(entry, "CallExpression") && !isNodeOfType(entry, "NewExpression")) return [];
  const trail: string[] = [];
  let cursor: EsTreeNode | null | undefined = entry.callee;
  while (cursor) {
    if (isNodeOfType(cursor, "ChainExpression")) {
      cursor = cursor.expression;
      continue;
    }
    if (isNodeOfType(cursor, "MemberExpression")) {
      if (isNodeOfType(cursor.property, "Identifier")) trail.push(cursor.property.name);
      cursor = cursor.object;
      continue;
    }
    if (isNodeOfType(cursor, "CallExpression")) {
      cursor = cursor.callee;
      continue;
    }
    if (isNodeOfType(cursor, "Identifier")) {
      trail.push(cursor.name);
    }
    break;
  }
  return trail;
};
