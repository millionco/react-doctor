// The handler parameter is intentionally `any` so each rule can declare its
// own narrowed `EsTreeNodeOfType<"<SelectorKey>">` annotation without
// fighting TypeScript's contravariant variance check (the narrow type
// isn't assignable to `EsTreeNode` in parameter position). The strict
// `EsTreeNode` (now an alias for the full `TSESTree.Node` union) stays
// the source of truth for everything else — `any` here is scoped to the
// visitor entry-point only.
export interface RuleVisitors {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [selector: string]: ((node: any) => void) | (() => void);
}
