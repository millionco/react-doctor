import type { EsTreeNode } from "./es-tree-node.js";
import { findProgramRoot } from "./find-program-root.js";
import { isAstNode } from "./is-ast-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

interface BindingInfo {
  // The Identifier node where the binding is declared (or destructured).
  bindingIdentifier: EsTreeNode;
  // The expression assigned to the binding at declaration time, when
  // the declarator carries an `init` (or, for destructured patterns,
  // the field of `init` that corresponds to this name). null when the
  // binding is declared without an initializer (`let x;`).
  //
  // NOTE: for a parameter or destructuring DEFAULT
  // (`function C({ items = [] })`, `const { x = [] } = props`) this is
  // the default expression. It is only allocated when the source is
  // undefined, so consumers that treat the initializer as an
  // unconditional render-local allocation must confirm the binding is a
  // direct `VariableDeclarator` init (see no-effect-with-fresh-deps).
  initializer: EsTreeNode | null;
  // The function/class/program node the binding lives in (its lexical
  // scope owner). Useful for distinguishing render-local vs hoisted.
  scopeOwner: EsTreeNode;
}

const FUNCTION_LIKE_TYPES = new Set<string>([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "MethodDefinition",
  "Program",
]);

const findScopeOwner = (node: EsTreeNode): EsTreeNode | null => {
  let ancestor: EsTreeNode | null | undefined = node;
  while (ancestor) {
    if (FUNCTION_LIKE_TYPES.has(ancestor.type)) return ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return null;
};

// Block-scope-aware scope owner for `let` / `const` declarations. If the
// declaration sits inside a BlockStatement that isn't itself the body
// of a function/method, the BlockStatement is the scope owner — a
// block-scoped binding isn't visible outside that block. `var` always
// hoists to the function (uses findScopeOwner instead).
const findBlockScopeOwner = (
  declaratorNode: EsTreeNode,
  declarationKind: string | undefined,
): EsTreeNode | null => {
  if (declarationKind !== "let" && declarationKind !== "const") {
    return findScopeOwner(declaratorNode);
  }
  let ancestor: EsTreeNode | null | undefined = declaratorNode.parent;
  while (ancestor) {
    if (ancestor.type === "BlockStatement") {
      const blockParent = ancestor.parent;
      if (
        blockParent &&
        (blockParent.type === "FunctionDeclaration" ||
          blockParent.type === "FunctionExpression" ||
          blockParent.type === "ArrowFunctionExpression" ||
          blockParent.type === "MethodDefinition")
      ) {
        // Function body — the function is the scope owner.
        return findScopeOwner(declaratorNode);
      }
      // Free-standing block (top-level `{…}` or block inside a
      // for-loop, if-statement, etc.) — the block itself is the
      // scope owner.
      return ancestor;
    }
    if (FUNCTION_LIKE_TYPES.has(ancestor.type)) return ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return null;
};

const collectFromBindingPattern = (
  pattern: EsTreeNode,
  initializer: EsTreeNode | null,
  scopeOwner: EsTreeNode,
  out: Map<string, BindingInfo[]>,
): void => {
  if (isNodeOfType(pattern, "Identifier")) {
    const list = out.get(pattern.name) ?? [];
    list.push({ bindingIdentifier: pattern, initializer, scopeOwner });
    out.set(pattern.name, list);
    return;
  }
  if (isNodeOfType(pattern, "ObjectPattern")) {
    for (const property of pattern.properties) {
      if (isNodeOfType(property, "Property")) {
        const valueNode = property.value as EsTreeNode;
        // The value may be an AssignmentPattern (`{ x = 1 }`) — its
        // .right is the per-key default initializer; pass it through so
        // jsx-no-new-*-as-prop's `({ x = [] }) => …` cases get caught.
        const propInit = isNodeOfType(valueNode, "AssignmentPattern")
          ? (valueNode.right as EsTreeNode)
          : null;
        collectFromBindingPattern(valueNode, propInit, scopeOwner, out);
      } else if (isNodeOfType(property, "RestElement")) {
        collectFromBindingPattern(property.argument as EsTreeNode, null, scopeOwner, out);
      }
    }
    return;
  }
  if (isNodeOfType(pattern, "ArrayPattern")) {
    for (const element of pattern.elements) {
      if (!element) continue;
      const innerInit = isNodeOfType(element as EsTreeNode, "AssignmentPattern")
        ? ((element as { right?: EsTreeNode }).right ?? null)
        : null;
      collectFromBindingPattern(element as EsTreeNode, innerInit, scopeOwner, out);
    }
    return;
  }
  if (isNodeOfType(pattern, "AssignmentPattern")) {
    collectFromBindingPattern(
      pattern.left as EsTreeNode,
      (pattern.right as EsTreeNode) ?? null,
      scopeOwner,
      out,
    );
    return;
  }
  if (isNodeOfType(pattern, "RestElement")) {
    collectFromBindingPattern(pattern.argument as EsTreeNode, null, scopeOwner, out);
  }
};

const buildBindingIndex = (root: EsTreeNode): Map<string, BindingInfo[]> => {
  const out = new Map<string, BindingInfo[]>();
  const visit = (node: EsTreeNode): void => {
    if (isNodeOfType(node, "VariableDeclarator")) {
      // Honor block scoping for let / const — `{ const App = ... }` at
      // module level binds App in the block, not the program.
      const declaration = node.parent;
      const declarationKind =
        declaration && isNodeOfType(declaration, "VariableDeclaration")
          ? declaration.kind
          : undefined;
      const scopeOwner = findBlockScopeOwner(node, declarationKind);
      if (scopeOwner) {
        collectFromBindingPattern(
          node.id as EsTreeNode,
          (node.init as EsTreeNode | null) ?? null,
          scopeOwner,
          out,
        );
      }
    }
    if (
      (isNodeOfType(node, "FunctionDeclaration") || isNodeOfType(node, "FunctionExpression")) &&
      node.id
    ) {
      // The function is bound in its enclosing scope, NOT in itself —
      // walk to the parent of the function and find that scope owner.
      const enclosing = node.parent ? findScopeOwner(node.parent) : null;
      if (enclosing) {
        const list = out.get(node.id.name) ?? [];
        list.push({
          bindingIdentifier: node.id as EsTreeNode,
          initializer: node,
          scopeOwner: enclosing,
        });
        out.set(node.id.name, list);
      }
    }
    // Class declarations / expressions create a binding in the
    // enclosing scope (same shape as FunctionDeclaration). Without
    // this branch, `class Foo {}` is invisible to lookups — e.g.
    // `jsx-no-undef` reports `<Foo/>` as undefined even when
    // `class Foo extends Component {}` sits in the same file.
    if (
      (isNodeOfType(node, "ClassDeclaration") || isNodeOfType(node, "ClassExpression")) &&
      node.id
    ) {
      const enclosing = node.parent ? findScopeOwner(node.parent) : null;
      if (enclosing) {
        const list = out.get(node.id.name) ?? [];
        list.push({
          bindingIdentifier: node.id as EsTreeNode,
          initializer: node,
          scopeOwner: enclosing,
        });
        out.set(node.id.name, list);
      }
    }
    if (
      isNodeOfType(node, "FunctionDeclaration") ||
      isNodeOfType(node, "FunctionExpression") ||
      isNodeOfType(node, "ArrowFunctionExpression")
    ) {
      // Function parameters are bindings local to this function.
      if (Array.isArray(node.params)) {
        for (const param of node.params) {
          if (!param) continue;
          collectFromBindingPattern(param as EsTreeNode, null, node, out);
          // `({ x = [] }) =>` — capture the per-binding default.
          if (isNodeOfType(param as EsTreeNode, "AssignmentPattern")) {
            collectFromBindingPattern(
              ((param as { left: EsTreeNode }).left ?? null) as EsTreeNode,
              ((param as { right: EsTreeNode }).right ?? null) as EsTreeNode,
              node,
              out,
            );
          }
        }
      }
    }
    if (isNodeOfType(node, "ImportDeclaration")) {
      const scopeOwner = findScopeOwner(node);
      if (scopeOwner && Array.isArray(node.specifiers)) {
        for (const specifier of node.specifiers) {
          const local = (specifier as { local?: EsTreeNode }).local;
          if (local && isNodeOfType(local, "Identifier")) {
            const list = out.get(local.name) ?? [];
            list.push({
              bindingIdentifier: local,
              initializer: specifier as EsTreeNode,
              scopeOwner,
            });
            out.set(local.name, list);
          }
        }
      }
    }
    if (
      node.type === "TSImportEqualsDeclaration" ||
      node.type === "TSEnumDeclaration" ||
      node.type === "TSModuleDeclaration"
    ) {
      const idNode = (node as { id?: EsTreeNode }).id;
      if (idNode && idNode.type === "Identifier") {
        const idObject = idNode as { name?: string };
        const scopeOwner = findScopeOwner(node);
        if (scopeOwner && typeof idObject.name === "string") {
          const list = out.get(idObject.name) ?? [];
          list.push({ bindingIdentifier: idNode, initializer: null, scopeOwner });
          out.set(idObject.name, list);
        }
      }
    }
    const nodeRecord = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(nodeRecord)) {
      if (key === "parent") continue;
      const child = nodeRecord[key];
      if (Array.isArray(child)) {
        for (const item of child) if (isAstNode(item)) visit(item);
      } else if (isAstNode(child)) {
        visit(child);
      }
    }
  };
  visit(root);
  return out;
};

const programRootCache = new WeakMap<EsTreeNode, Map<string, BindingInfo[]>>();

const getBindingIndex = (referenceNode: EsTreeNode): Map<string, BindingInfo[]> | null => {
  const programRoot = findProgramRoot(referenceNode);
  if (!programRoot) return null;
  let index = programRootCache.get(programRoot);
  if (!index) {
    index = buildBindingIndex(programRoot);
    programRootCache.set(programRoot, index);
  }
  return index;
};

// Best-effort lookup of the binding for an identifier reference. Picks
// the binding whose scope owner is the *closest enclosing* function /
// program ancestor of `referenceNode` — a passable approximation of
// lexical-scope resolution without an actual scope tracker. Returns
// `null` when the name has no declaration anywhere in the file.
//
// LIMITATIONS (vs. full semantic analysis):
//   - Block-scoped bindings (`{ const x = ... }`) are not visible.
//   - Shadowing is approximated, not exact.
//   - Imports of the same name from multiple modules are
//     non-deterministic.
// Sufficient for the rules that previously had "scope analysis"
// divergences in `oxc-divergences.ts`.
export const findVariableInitializer = (
  referenceNode: EsTreeNode,
  bindingName: string,
): BindingInfo | null => {
  const index = getBindingIndex(referenceNode);
  if (!index) return null;
  const candidates = index.get(bindingName);
  if (!candidates || candidates.length === 0) return null;

  const referenceAncestors = new Set<EsTreeNode>();
  let walker: EsTreeNode | null | undefined = referenceNode;
  while (walker) {
    referenceAncestors.add(walker);
    walker = walker.parent ?? null;
  }
  // Pick the candidate whose scopeOwner is in the reference's ancestor
  // chain AND is the closest one (deepest ancestor). If no candidate's
  // scope is visible, return null — the binding is not in scope.
  let best: BindingInfo | null = null;
  for (const candidate of candidates) {
    if (!referenceAncestors.has(candidate.scopeOwner)) continue;
    if (best === null) {
      best = candidate;
      continue;
    }
    // `candidate.scopeOwner` deeper than `best.scopeOwner` means
    // candidate is closer to the reference — prefer it.
    let cursor: EsTreeNode | null | undefined = candidate.scopeOwner;
    while (cursor) {
      if (cursor === best.scopeOwner) {
        best = candidate;
        break;
      }
      cursor = cursor.parent ?? null;
    }
  }
  return best;
};

export type { BindingInfo };
