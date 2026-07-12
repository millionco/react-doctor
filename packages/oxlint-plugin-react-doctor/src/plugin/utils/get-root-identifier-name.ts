import type { EsTreeNode } from "./es-tree-node.js";
import { getRootIdentifier } from "./get-root-identifier.js";
import type { RootIdentifierOptions } from "./get-root-identifier.js";

// HACK: walk a MemberExpression chain (computed or not) down to the
// underlying root identifier. `state.nested.items` -> "state",
// `items[0]` -> "items". TS cast / non-null / parenthesized wrappers
// (`(items as T[])`, `items!`) are transparent to identity, so they are
// peeled via `stripParenExpression` (which also unwraps `ChainExpression`)
// before rooting. Returns null if the chain bottoms out at anything other
// than a plain Identifier (e.g. a CallExpression, `this`). Bare Identifiers
// resolve to themselves.
//
// When `followCallChains` is true, also walks past the receiver of
// any intermediate CallExpression - `items.toSorted().filter(fn)` ->
// "items". Off by default because most callers want the receiver of
// the call (e.g. for "did this assignment write to props?"), not the
// expression that produced the receiver.
export const getRootIdentifierName = (
  node: EsTreeNode | undefined | null,
  options?: RootIdentifierOptions,
): string | null => getRootIdentifier(node, options)?.name ?? null;
