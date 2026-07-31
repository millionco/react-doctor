import type { EsTreeNode } from "./es-tree-node.js";
import { findProgramRoot } from "./find-program-root.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

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

export interface FindVariableInitializerOptions {
  preferInitializerBeforeReference?: boolean;
}

interface CachedBindingLookup {
  defaultResult?: BindingInfo | null;
  preferredResult?: BindingInfo | null;
}

interface CachedBindingLookups {
  readonly primaryBindingName: string;
  readonly primaryLookup: CachedBindingLookup;
  additionalLookups?: Map<string, CachedBindingLookup>;
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
    switch (node.type) {
      case "VariableDeclarator": {
        const declaration = node.parent;
        const declarationKind =
          declaration?.type === "VariableDeclaration" ? declaration.kind : undefined;
        const scopeOwner = findBlockScopeOwner(node, declarationKind);
        if (scopeOwner) {
          collectFromBindingPattern(
            node.id as EsTreeNode,
            (node.init as EsTreeNode | null) ?? null,
            scopeOwner,
            out,
          );
        }
        break;
      }
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression": {
        if (node.type !== "ArrowFunctionExpression" && node.id) {
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
        for (const param of node.params) {
          collectFromBindingPattern(param as EsTreeNode, null, node, out);
        }
        break;
      }
      case "ClassDeclaration":
      case "ClassExpression": {
        if (!node.id) break;
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
        break;
      }
      case "ImportDeclaration": {
        const scopeOwner = findScopeOwner(node);
        if (!scopeOwner) break;
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
        break;
      }
      case "TSImportEqualsDeclaration":
      case "TSEnumDeclaration":
      case "TSModuleDeclaration": {
        const identifier = (node as { id?: EsTreeNode }).id;
        if (identifier?.type === "Identifier") {
          const scopeOwner = findScopeOwner(node);
          if (scopeOwner) {
            const list = out.get(identifier.name) ?? [];
            list.push({ bindingIdentifier: identifier, initializer: null, scopeOwner });
            out.set(identifier.name, list);
          }
        }
        break;
      }
    }
  };
  walkAst(root, visit);
  return out;
};

const programRootCache = new WeakMap<EsTreeNode, Map<string, BindingInfo[]>>();
const bindingLookupCache = new WeakMap<EsTreeNode, CachedBindingLookups>();

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
//   - Catch, switch, class, and static-block scope boundaries are
//     approximated.
//   - Same-scope redeclarations use initializer heuristics instead of
//     full temporal semantics.
// Sufficient for the rules that previously had "scope analysis"
// divergences in `oxc-divergences.ts`.
const computeVariableInitializer = (
  referenceNode: EsTreeNode,
  bindingName: string,
  options?: FindVariableInitializerOptions,
): BindingInfo | null => {
  const index = getBindingIndex(referenceNode);
  if (!index) return null;
  const candidates = index.get(bindingName);
  if (!candidates || candidates.length === 0) return null;

  const onlyCandidate = candidates[0];
  if (candidates.length === 1 && onlyCandidate) {
    let currentAncestor: EsTreeNode | null | undefined = referenceNode;
    while (currentAncestor) {
      if (currentAncestor === onlyCandidate.scopeOwner) return onlyCandidate;
      currentAncestor = currentAncestor.parent ?? null;
    }
    return null;
  }

  let currentAncestor: EsTreeNode | null | undefined = referenceNode;
  while (currentAncestor) {
    let bestInScope: BindingInfo | null = null;
    for (const candidate of candidates) {
      if (candidate.scopeOwner !== currentAncestor) continue;
      if (bestInScope === null) {
        bestInScope = candidate;
        continue;
      }
      if (options?.preferInitializerBeforeReference) {
        const isCandidateAvailable = Boolean(
          candidate.initializer &&
          (isNodeOfType(candidate.initializer, "FunctionDeclaration") ||
            candidate.bindingIdentifier.range[0] < referenceNode.range[0]),
        );
        const isBestAvailable = Boolean(
          bestInScope.initializer &&
          (isNodeOfType(bestInScope.initializer, "FunctionDeclaration") ||
            bestInScope.bindingIdentifier.range[0] < referenceNode.range[0]),
        );
        if (isCandidateAvailable !== isBestAvailable) {
          if (isCandidateAvailable) bestInScope = candidate;
          continue;
        }
      }
      if (candidate.initializer !== null || bestInScope.initializer === null) {
        bestInScope = candidate;
      }
    }
    if (bestInScope) return bestInScope;
    currentAncestor = currentAncestor.parent ?? null;
  }
  return null;
};

export const findVariableInitializer = (
  referenceNode: EsTreeNode,
  bindingName: string,
  options?: FindVariableInitializerOptions,
): BindingInfo | null => {
  let cachedLookups = bindingLookupCache.get(referenceNode);
  let cachedLookup: CachedBindingLookup;
  if (!cachedLookups) {
    cachedLookup = {};
    bindingLookupCache.set(referenceNode, {
      primaryBindingName: bindingName,
      primaryLookup: cachedLookup,
    });
  } else if (cachedLookups.primaryBindingName === bindingName) {
    cachedLookup = cachedLookups.primaryLookup;
  } else {
    let additionalLookups = cachedLookups.additionalLookups;
    if (!additionalLookups) {
      additionalLookups = new Map();
      cachedLookups.additionalLookups = additionalLookups;
    }
    const additionalLookup = additionalLookups.get(bindingName);
    if (additionalLookup) {
      cachedLookup = additionalLookup;
    } else {
      cachedLookup = {};
      additionalLookups.set(bindingName, cachedLookup);
    }
  }

  const resultKey = options?.preferInitializerBeforeReference ? "preferredResult" : "defaultResult";
  if (resultKey in cachedLookup) return cachedLookup[resultKey] ?? null;

  const result = computeVariableInitializer(referenceNode, bindingName, options);
  cachedLookup[resultKey] = result;
  return result;
};

export type { BindingInfo };
