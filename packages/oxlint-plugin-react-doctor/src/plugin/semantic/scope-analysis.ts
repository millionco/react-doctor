import type { EsTreeNode } from "../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../utils/es-tree-node-of-type.js";
import { TYPE_POSITION_CHILD_KEYS } from "../constants/ts-type-position-keys.js";
import { isAstNode } from "../utils/is-ast-node.js";
import { isFunctionLike } from "../utils/is-function-like.js";
import { isNodeOfType } from "../utils/is-node-of-type.js";

// Scope analyzer — per-file walker building a scope tree, symbol
// table, and identifier reference resolution. Mirrors the subset of
// `oxc_semantic` (binder + scoping) we need for our rules. Two
// passes:
//
//   1. Walk the AST collecting declarations (binding to the right
//      scope per JS hoisting rules) and references (parked on the
//      enclosing scope at the time of visit).
//   2. Resolve each reference: walk up from the ref's location scope
//      until the name is found.

export type SymbolKind =
  | "var"
  | "let"
  | "const"
  | "using"
  | "function"
  | "class"
  | "parameter"
  | "import"
  | "ts-import-equals"
  | "ts-enum"
  | "ts-type-alias"
  | "ts-interface"
  | "ts-module"
  | "catch-clause-parameter";

export type ScopeKind =
  | "module"
  | "function"
  | "arrow-function"
  | "method"
  | "block"
  | "class"
  | "catch"
  | "for"
  | "switch"
  | "with"
  | "ts-module"
  | "ts-enum";

export interface SymbolDescriptor {
  readonly id: number;
  readonly name: string;
  readonly kind: SymbolKind;
  // The Identifier (or other binding-position node) that introduces
  // the binding.
  readonly bindingIdentifier: EsTreeNode;
  // The full declaration node (VariableDeclarator / FunctionDeclaration
  // / ImportSpecifier / ...) that introduces this binding.
  readonly declarationNode: EsTreeNode;
  readonly scope: ScopeDescriptor;
  // VariableDeclarator init, function/class node itself, import
  // specifier, etc. — null when there's no expression-shape value.
  readonly initializer: EsTreeNode | null;
  // Mutable list filled in during reference resolution.
  readonly references: ReferenceDescriptor[];
}

export type ReferenceFlag = "read" | "write" | "read-write";

export interface ReferenceDescriptor {
  readonly id: number;
  readonly identifier: EsTreeNode;
  // Set during resolution. null means unresolved → global / external.
  resolvedSymbol: SymbolDescriptor | null;
  readonly flag: ReferenceFlag;
  readonly scope: ScopeDescriptor;
}

export interface ScopeDescriptor {
  readonly id: number;
  readonly kind: ScopeKind;
  readonly node: EsTreeNode;
  readonly parent: ScopeDescriptor | null;
  readonly children: ScopeDescriptor[];
  readonly symbols: SymbolDescriptor[];
  readonly references: ReferenceDescriptor[];
  // Direct lookup index for the `name → symbol` resolution step.
  readonly symbolsByName: Map<string, SymbolDescriptor>;
}

export interface ScopeAnalysis {
  readonly rootScope: ScopeDescriptor;
  readonly scopeFor: (node: EsTreeNode) => ScopeDescriptor;
  // For function-like / class / block / etc. nodes that OPEN a scope,
  // returns the scope they open. Returns null for nodes that don't
  // open a scope. Note `scopeFor` returns the ENCLOSING scope (where
  // the node lives), which for a FunctionDeclaration is the parent
  // scope, NOT the function's body scope.
  readonly ownScopeFor: (node: EsTreeNode) => ScopeDescriptor | null;
  readonly symbolFor: (identifier: EsTreeNode) => SymbolDescriptor | null;
  readonly referenceFor: (identifier: EsTreeNode) => ReferenceDescriptor | null;
  readonly isGlobalReference: (identifier: EsTreeNode) => boolean;
}

const isHoistedBindingKind = (kind: SymbolKind): boolean => kind === "var" || kind === "function";

// Returns the nearest enclosing function-or-program scope for hoisting
// `var` / function declarations.
const findHoistTargetScope = (scope: ScopeDescriptor): ScopeDescriptor => {
  let current: ScopeDescriptor | null = scope;
  while (current) {
    if (
      current.kind === "module" ||
      current.kind === "function" ||
      current.kind === "arrow-function" ||
      current.kind === "method"
    ) {
      return current;
    }
    current = current.parent;
  }
  // Should be unreachable — every reachable scope chains up to the
  // module scope.
  return scope;
};

interface BuilderState {
  nextScopeId: number;
  nextSymbolId: number;
  nextReferenceId: number;
  currentScope: ScopeDescriptor;
  scopeStack: ScopeDescriptor[];
  rootScope: ScopeDescriptor;
  // Map every visited AST node → the innermost scope it lives in, for
  // post-walk lookups via scopeFor().
  nodeScope: WeakMap<EsTreeNode, ScopeDescriptor>;
  // Map each scope-opening node → the scope it opens (function body,
  // block, class, etc.). For nodes that don't open a scope, no entry.
  ownScopeForNode: WeakMap<EsTreeNode, ScopeDescriptor>;
  // Map each binding identifier (or full declaration node) → its symbol.
  symbolByBindingIdentifier: WeakMap<EsTreeNode, SymbolDescriptor>;
  // Map each reference identifier → the reference record.
  referenceByIdentifier: WeakMap<EsTreeNode, ReferenceDescriptor>;
}

const createScope = (
  kind: ScopeKind,
  node: EsTreeNode,
  parent: ScopeDescriptor | null,
  state: BuilderState,
): ScopeDescriptor => {
  const scope: ScopeDescriptor = {
    id: state.nextScopeId++,
    kind,
    node,
    parent,
    children: [],
    symbols: [],
    references: [],
    symbolsByName: new Map(),
  };
  if (parent) parent.children.push(scope);
  return scope;
};

const pushScope = (kind: ScopeKind, node: EsTreeNode, state: BuilderState): ScopeDescriptor => {
  const scope = createScope(kind, node, state.currentScope, state);
  state.scopeStack.push(scope);
  state.currentScope = scope;
  state.ownScopeForNode.set(node, scope);
  return scope;
};

const popScope = (state: BuilderState): void => {
  state.scopeStack.pop();
  const previous = state.scopeStack[state.scopeStack.length - 1];
  if (!previous) {
    throw new Error("scope stack underflow");
  }
  state.currentScope = previous;
};

const recordSymbol = (
  scope: ScopeDescriptor,
  state: BuilderState,
  options: {
    name: string;
    kind: SymbolKind;
    bindingIdentifier: EsTreeNode;
    declarationNode: EsTreeNode;
    initializer: EsTreeNode | null;
  },
): SymbolDescriptor => {
  const symbol: SymbolDescriptor = {
    id: state.nextSymbolId++,
    name: options.name,
    kind: options.kind,
    bindingIdentifier: options.bindingIdentifier,
    declarationNode: options.declarationNode,
    scope,
    initializer: options.initializer,
    references: [],
  };
  scope.symbols.push(symbol);
  // The most recent declaration with this name wins for `symbolsByName`
  // (overwriting earlier ones is fine since JS doesn't allow re-bind in
  // strict mode for let/const; for var, the redeclaration is harmless).
  scope.symbolsByName.set(options.name, symbol);
  state.symbolByBindingIdentifier.set(options.bindingIdentifier, symbol);
  return symbol;
};

const collectBindingNamesFromPattern = (pattern: EsTreeNode): EsTreeNode[] => {
  const out: EsTreeNode[] = [];
  const visit = (node: EsTreeNode): void => {
    if (isNodeOfType(node, "Identifier")) {
      out.push(node);
      return;
    }
    if (isNodeOfType(node, "ObjectPattern")) {
      for (const property of node.properties) {
        if (isNodeOfType(property as EsTreeNode, "Property")) {
          const propValue = (property as { value: EsTreeNode }).value;
          visit(propValue);
        } else if (isNodeOfType(property as EsTreeNode, "RestElement")) {
          visit((property as { argument: EsTreeNode }).argument);
        }
      }
      return;
    }
    if (isNodeOfType(node, "ArrayPattern")) {
      for (const element of node.elements) {
        if (element) visit(element as EsTreeNode);
      }
      return;
    }
    if (isNodeOfType(node, "RestElement")) {
      visit(node.argument as EsTreeNode);
      return;
    }
    if (isNodeOfType(node, "AssignmentPattern")) {
      visit(node.left as EsTreeNode);
    }
  };
  visit(pattern);
  return out;
};

// Gathers every Identifier introduced by a destructuring pattern, with
// their per-element default expression (the right side of an
// AssignmentPattern in destructure position) — used for jsx-no-new-*-as-prop
// to flag `({ x = [] }) => …` as an object-producing render-local
// binding.
const visitDestructuringDeclarations = (
  pattern: EsTreeNode,
  baseInitializer: EsTreeNode | null,
  scope: ScopeDescriptor,
  state: BuilderState,
  symbolKind: SymbolKind,
  declarationNode: EsTreeNode,
): void => {
  if (isNodeOfType(pattern, "Identifier")) {
    recordSymbol(scope, state, {
      name: pattern.name,
      kind: symbolKind,
      bindingIdentifier: pattern,
      declarationNode,
      initializer: baseInitializer,
    });
    return;
  }
  if (isNodeOfType(pattern, "ObjectPattern")) {
    for (const property of pattern.properties) {
      if (isNodeOfType(property as EsTreeNode, "Property")) {
        const propertyValue = (property as { value: EsTreeNode }).value;
        // `{ x = 1 }` → AssignmentPattern: .right is the per-element
        // default; propagate it as initializer.
        // For shorthand / non-default destructure, the binding's
        // semantic initializer is the destructure SOURCE (the
        // Right side of `=`). We pass `baseInitializer` through so
        // rules can chase the source of a destructured name. (Not
        // semantically equivalent — `{ x } = obj` doesn't make `x`
        // === obj — but accurate enough for "did this name come
        // from React?" lookups.)
        const elementInit = isNodeOfType(propertyValue, "AssignmentPattern")
          ? (propertyValue.right as EsTreeNode)
          : baseInitializer;
        visitDestructuringDeclarations(
          propertyValue,
          elementInit,
          scope,
          state,
          symbolKind,
          declarationNode,
        );
      } else if (isNodeOfType(property as EsTreeNode, "RestElement")) {
        visitDestructuringDeclarations(
          (property as { argument: EsTreeNode }).argument,
          baseInitializer,
          scope,
          state,
          symbolKind,
          declarationNode,
        );
      }
    }
    return;
  }
  if (isNodeOfType(pattern, "ArrayPattern")) {
    for (const element of pattern.elements) {
      if (!element) continue;
      const elementInit = isNodeOfType(element as EsTreeNode, "AssignmentPattern")
        ? ((element as { right: EsTreeNode }).right ?? null)
        : baseInitializer;
      visitDestructuringDeclarations(
        element as EsTreeNode,
        elementInit,
        scope,
        state,
        symbolKind,
        declarationNode,
      );
    }
    return;
  }
  if (isNodeOfType(pattern, "AssignmentPattern")) {
    visitDestructuringDeclarations(
      pattern.left as EsTreeNode,
      (pattern.right as EsTreeNode) ?? null,
      scope,
      state,
      symbolKind,
      declarationNode,
    );
    return;
  }
  if (isNodeOfType(pattern, "RestElement")) {
    visitDestructuringDeclarations(
      pattern.argument as EsTreeNode,
      null,
      scope,
      state,
      symbolKind,
      declarationNode,
    );
  }
};

// Sets to consult during the walk to know whether an Identifier is in a
// BINDING position (declares a name) vs a REFERENCE position (uses a
// name). The walker tracks binding sites explicitly; everything else is
// treated as a reference.
const tagAsBinding = (state: BuilderState, identifier: EsTreeNode): void => {
  // Currently a marker only — we already recorded the symbol, so we
  // tag the identifier so the generic walk doesn't add it again as a
  // reference. We use a dedicated WeakSet for this (built lazily).
  bindingPositionMarker.add(identifier);
};

// Module-level WeakSet: identifies AST nodes the walker should NOT
// treat as a reference (because they're a binding position). Reset
// per-analyze call would mean per-program; using a single set across
// programs is fine because AST nodes are unique.
const bindingPositionMarker: WeakSet<EsTreeNode> = new WeakSet();

const recordReference = (
  state: BuilderState,
  identifier: EsTreeNode,
  flag: ReferenceFlag,
): void => {
  const reference: ReferenceDescriptor = {
    id: state.nextReferenceId++,
    identifier,
    resolvedSymbol: null,
    flag,
    scope: state.currentScope,
  };
  state.currentScope.references.push(reference);
  state.referenceByIdentifier.set(identifier, reference);
};

// True for AST node types where the .body is a function-body block. We
// DON'T want to push a separate block scope for the function body — its
// scope is the function scope itself.
const isFunctionBodyBlock = (block: EsTreeNode): boolean => {
  if (!block.parent) return false;
  return isFunctionLike(block.parent);
};

// True for AST node types where the .body is a catch-clause body
// block. Same reasoning — the catch clause already pushed its own
// scope.
const isCatchClauseBlock = (block: EsTreeNode): boolean =>
  block.parent !== null && block.parent !== undefined && block.parent.type === "CatchClause";

const handleVariableDeclaration = (declaration: EsTreeNode, state: BuilderState): void => {
  if (!isNodeOfType(declaration, "VariableDeclaration")) return;
  const symbolKind: SymbolKind =
    declaration.kind === "var"
      ? "var"
      : declaration.kind === "let"
        ? "let"
        : declaration.kind === "const"
          ? "const"
          : "using";
  const targetScope = isHoistedBindingKind(symbolKind)
    ? findHoistTargetScope(state.currentScope)
    : state.currentScope;
  for (const declarator of declaration.declarations) {
    const declaratorNode = declarator as EsTreeNode;
    const init = (declarator as { init: EsTreeNode | null }).init ?? null;
    visitDestructuringDeclarations(
      (declarator as { id: EsTreeNode }).id,
      init,
      targetScope,
      state,
      symbolKind,
      declaratorNode,
    );
    // Mark every binding identifier so the generic walk doesn't
    // double-count it as a reference.
    for (const identifier of collectBindingNamesFromPattern(
      (declarator as { id: EsTreeNode }).id,
    )) {
      tagAsBinding(state, identifier);
    }
  }
};

const handleFunctionDeclaration = (fn: EsTreeNode, state: BuilderState): void => {
  if (!isNodeOfType(fn, "FunctionDeclaration")) return;
  if (fn.id) {
    const target = findHoistTargetScope(state.currentScope);
    recordSymbol(target, state, {
      name: fn.id.name,
      kind: "function",
      bindingIdentifier: fn.id as EsTreeNode,
      declarationNode: fn,
      initializer: fn,
    });
    tagAsBinding(state, fn.id as EsTreeNode);
  }
};

const handleClassDeclaration = (cls: EsTreeNode, state: BuilderState): void => {
  if (!isNodeOfType(cls, "ClassDeclaration")) return;
  if (cls.id) {
    recordSymbol(state.currentScope, state, {
      name: cls.id.name,
      kind: "class",
      bindingIdentifier: cls.id as EsTreeNode,
      declarationNode: cls,
      initializer: cls,
    });
    tagAsBinding(state, cls.id as EsTreeNode);
  }
};

const handleImportDeclaration = (importDeclaration: EsTreeNode, state: BuilderState): void => {
  if (!isNodeOfType(importDeclaration, "ImportDeclaration")) return;
  const target = findHoistTargetScope(state.currentScope);
  for (const specifier of importDeclaration.specifiers) {
    const local = (specifier as { local: EsTreeNode }).local;
    if (!isNodeOfType(local, "Identifier")) continue;
    recordSymbol(target, state, {
      name: local.name,
      kind: "import",
      bindingIdentifier: local,
      declarationNode: specifier as EsTreeNode,
      initializer: specifier as EsTreeNode,
    });
    tagAsBinding(state, local);
  }
};

const handleTsDeclarations = (node: EsTreeNode, state: BuilderState): void => {
  if (
    node.type !== "TSImportEqualsDeclaration" &&
    node.type !== "TSEnumDeclaration" &&
    node.type !== "TSTypeAliasDeclaration" &&
    node.type !== "TSInterfaceDeclaration" &&
    node.type !== "TSModuleDeclaration"
  ) {
    return;
  }
  const idNode = (node as { id?: EsTreeNode }).id;
  if (!idNode || !isNodeOfType(idNode, "Identifier")) return;
  const kind: SymbolKind =
    node.type === "TSImportEqualsDeclaration"
      ? "ts-import-equals"
      : node.type === "TSEnumDeclaration"
        ? "ts-enum"
        : node.type === "TSTypeAliasDeclaration"
          ? "ts-type-alias"
          : node.type === "TSInterfaceDeclaration"
            ? "ts-interface"
            : "ts-module";
  const target = findHoistTargetScope(state.currentScope);
  recordSymbol(target, state, {
    name: idNode.name,
    kind,
    bindingIdentifier: idNode,
    declarationNode: node,
    initializer: null,
  });
  tagAsBinding(state, idNode);
};

const handleFunctionParameters = (
  params: ReadonlyArray<EsTreeNode>,
  scope: ScopeDescriptor,
  state: BuilderState,
): void => {
  for (const param of params) {
    visitDestructuringDeclarations(param, null, scope, state, "parameter", param);
    for (const identifier of collectBindingNamesFromPattern(param)) {
      tagAsBinding(state, identifier);
    }
  }
};

// Determines whether a BlockStatement should open its own scope. The
// rule: a block opens a new scope EXCEPT when it's the body of a
// function (function scope already pushed), the body of a CatchClause
// (catch scope already pushed), or the body of a TS module (ts-module
// scope already pushed).
const shouldPushBlockScope = (block: EsTreeNode): boolean => {
  if (!isNodeOfType(block, "BlockStatement")) return false;
  if (isFunctionBodyBlock(block)) return false;
  if (isCatchClauseBlock(block)) return false;
  if (block.parent && block.parent.type === "TSModuleDeclaration") return false;
  return true;
};

// True if an Identifier sits in a position where it's the property
// name of a non-computed MemberExpression / Property / etc. — not a
// reference to a variable. e.g. in `obj.foo`, `foo` is property
// access, not a reference. Same for the `key` of a non-computed
// Property in an ObjectExpression.
// True when the JSXIdentifier `node` actually resolves through the
// binding scope chain — i.e. it's a real reference, not just a syntax
// fragment. Carves out:
//   - `<div />` — lowercase tag name is the HTML string "div", not
//     a binding lookup.
//   - `<obj.Foo />` — `Foo` is the JSXMemberExpression.property, an
//     attribute-like name. Only `obj` (the .object end of the chain)
//     resolves through scope.
//   - `<svg:rect />` — JSXNamespacedName parts are syntax fragments.
const isJsxIdentifierBindingReference = (
  identifier: EsTreeNodeOfType<"JSXIdentifier">,
): boolean => {
  const parent = identifier.parent;
  if (!parent) return false;
  if (parent.type === "JSXMemberExpression") {
    // Only the leftmost (.object) of the chain is a reference.
    return parent.object === identifier;
  }
  if (parent.type === "JSXNamespacedName") return false;
  // JSXOpeningElement / JSXClosingElement: lowercase first char is
  // an HTML tag string, not a binding.
  const ASCII_LOWERCASE_A = 97;
  const ASCII_LOWERCASE_Z = 122;
  const firstCharCode = identifier.name.charCodeAt(0);
  if (firstCharCode >= ASCII_LOWERCASE_A && firstCharCode <= ASCII_LOWERCASE_Z) {
    return false;
  }
  return true;
};

const isNonReferencePosition = (identifier: EsTreeNode): boolean => {
  const parent = identifier.parent;
  if (!parent) return false;
  switch (parent.type) {
    case "MemberExpression":
      // `obj.foo` — property is non-reference unless computed.
      return parent.property === identifier && !parent.computed;
    case "Property":
      // `{ foo: 1 }` — key is non-reference unless computed AND value
      // shorthand. Shorthand `{ foo }` IS a reference (foo is both key
      // and value); for non-shorthand non-computed key it's not.
      return parent.key === identifier && !parent.computed && !parent.shorthand;
    case "MethodDefinition":
    case "PropertyDefinition":
      return parent.key === identifier && !parent.computed;
    case "JSXAttribute":
      return parent.name === identifier;
    case "ImportSpecifier":
      // `import { foo as bar }` — `foo` (imported) is non-reference.
      return parent.imported === identifier;
    case "ExportSpecifier":
      // `export { foo as bar }` — both are non-reference at the
      // ID-resolution level (they're module symbols), but `foo` may
      // resolve to a local binding. For our purposes, treat `foo`
      // (local) as a reference and `bar` (exported) as non-reference.
      return parent.exported === identifier && parent.local !== parent.exported;
    case "LabeledStatement":
    case "BreakStatement":
    case "ContinueStatement":
      return parent.label === identifier;
    default:
      return false;
  }
};

// True if the identifier's parent indicates a write context. Best-effort:
// AssignmentExpression.left, UpdateExpression.argument, ForInStatement.left.
const inferReferenceFlag = (identifier: EsTreeNode): ReferenceFlag => {
  const parent = identifier.parent;
  if (!parent) return "read";
  switch (parent.type) {
    case "AssignmentExpression":
      if (parent.left === identifier) {
        return parent.operator === "=" ? "write" : "read-write";
      }
      return "read";
    case "UpdateExpression":
      return "read-write";
    case "ForInStatement":
    case "ForOfStatement":
      return parent.left === identifier ? "write" : "read";
    default:
      return "read";
  }
};

const setNodeScope = (node: EsTreeNode, state: BuilderState): void => {
  state.nodeScope.set(node, state.currentScope);
};

// Records references that live in the reference-bearing sub-parts of a
// function parameter pattern: default-value expressions (`(a = expr) =>`)
// and computed destructuring keys (`({ [k]: v }) =>`). The function-like
// handler binds the parameter NAMES but walks only the body, so without
// this the identifiers in defaults / computed keys would never be
// recorded as references — leaving closure-capture and exhaustive-deps
// analysis blind to them (e.g. misclassifying a module constant used as
// a default). References are parked on the current (function) scope.
const walkParameterReferences = (pattern: EsTreeNode, state: BuilderState): void => {
  if (isNodeOfType(pattern, "AssignmentPattern")) {
    walkParameterReferences(pattern.left as EsTreeNode, state);
    const defaultValue = (pattern.right as EsTreeNode | null) ?? null;
    if (defaultValue) walk(defaultValue, state);
    return;
  }
  if (isNodeOfType(pattern, "ObjectPattern")) {
    for (const property of pattern.properties) {
      const propertyNode = property as EsTreeNode;
      if (isNodeOfType(propertyNode, "RestElement")) {
        walkParameterReferences((propertyNode as { argument: EsTreeNode }).argument, state);
        continue;
      }
      if (!isNodeOfType(propertyNode, "Property")) continue;
      const propertyDetail = propertyNode as {
        computed?: boolean;
        key: EsTreeNode;
        value: EsTreeNode;
      };
      if (propertyDetail.computed) walk(propertyDetail.key, state);
      walkParameterReferences(propertyDetail.value, state);
    }
    return;
  }
  if (isNodeOfType(pattern, "ArrayPattern")) {
    for (const element of pattern.elements) {
      if (element) walkParameterReferences(element as EsTreeNode, state);
    }
    return;
  }
  if (isNodeOfType(pattern, "RestElement")) {
    walkParameterReferences(pattern.argument as EsTreeNode, state);
  }
};

// Single-pass walker. For each node we:
//   1) Open a scope if appropriate.
//   2) Bind any declarations to the active scope (with hoisting).
//   3) Recurse into children, each tagged with `state.currentScope`
//      via the WeakMap.
//   4) Record references for non-binding-position Identifiers.
//   5) Close the scope.
const walk = (node: EsTreeNode, state: BuilderState): void => {
  // Special-case structural nodes that open scopes BEFORE they bind
  // their own children. Keep these in source order to match JS scope
  // semantics.

  // Function-like: scope opens; parameters bind into the function scope;
  // body's BlockStatement is suppressed (already in function scope).
  if (isFunctionLike(node)) {
    // FunctionDeclaration's name is bound in the PARENT (hoisted)
    // scope BEFORE we push the function's own scope.
    if (isNodeOfType(node, "FunctionDeclaration") && node.id) {
      handleFunctionDeclaration(node, state);
    }
    // The function NODE belongs to the parent scope; its body belongs
    // to the function's own scope. Map the node before pushing.
    setNodeScope(node, state);
    const kind: ScopeKind = node.type === "ArrowFunctionExpression" ? "arrow-function" : "function";
    const fnScope = pushScope(kind, node, state);
    // FunctionExpression name is visible only inside the body (not in
    // the parent). FunctionDeclaration name is ALSO visible inside the
    // body for recursive calls — bind it in the inner scope too.
    if (
      (isNodeOfType(node, "FunctionExpression") || isNodeOfType(node, "FunctionDeclaration")) &&
      node.id
    ) {
      recordSymbol(fnScope, state, {
        name: node.id.name,
        kind: "function",
        bindingIdentifier: node.id as EsTreeNode,
        declarationNode: node,
        initializer: node,
      });
      tagAsBinding(state, node.id as EsTreeNode);
    }
    const functionParams = (node as { params: ReadonlyArray<EsTreeNode> }).params ?? [];
    handleFunctionParameters(functionParams, fnScope, state);
    // Record references inside parameter default values and computed
    // destructuring keys (the handler above binds names but doesn't walk
    // these reference-bearing sub-expressions).
    for (const param of functionParams) walkParameterReferences(param, state);
    // Walk the body inline; if it's a BlockStatement, we mark it so the
    // BlockStatement handler doesn't push a duplicate scope.
    const body = (node as { body: EsTreeNode }).body;
    if (body) walk(body, state);
    popScope(state);
    return;
  }

  if (isNodeOfType(node, "ClassDeclaration") || isNodeOfType(node, "ClassExpression")) {
    // Bind the ClassDeclaration name in the parent scope BEFORE
    // pushing the class's own scope.
    if (isNodeOfType(node, "ClassDeclaration") && node.id) {
      handleClassDeclaration(node, state);
    }
    // Class scope is its own — class methods see the class name
    // (FunctionExpression-like for ClassExpression).
    const classScope = pushScope("class", node, state);
    setNodeScope(node, state);
    if (isNodeOfType(node, "ClassExpression") && node.id) {
      // ClassExpression name visible only inside the class body.
      recordSymbol(classScope, state, {
        name: node.id.name,
        kind: "class",
        bindingIdentifier: node.id as EsTreeNode,
        declarationNode: node,
        initializer: node,
      });
      tagAsBinding(state, node.id as EsTreeNode);
    }
    if (node.superClass) walk(node.superClass as EsTreeNode, state);
    if (node.body) walk(node.body as EsTreeNode, state);
    popScope(state);
    return;
  }

  if (isNodeOfType(node, "CatchClause")) {
    const catchScope = pushScope("catch", node, state);
    setNodeScope(node, state);
    if (node.param) {
      visitDestructuringDeclarations(
        node.param as EsTreeNode,
        null,
        catchScope,
        state,
        "catch-clause-parameter",
        node as EsTreeNode,
      );
      for (const identifier of collectBindingNamesFromPattern(node.param as EsTreeNode)) {
        tagAsBinding(state, identifier);
      }
    }
    if (node.body) walk(node.body as EsTreeNode, state);
    popScope(state);
    return;
  }

  if (
    isNodeOfType(node, "ForStatement") ||
    isNodeOfType(node, "ForInStatement") ||
    isNodeOfType(node, "ForOfStatement")
  ) {
    // For-statement gets its own scope; `for(let i …)` puts i in this
    // scope, NOT in the body block.
    pushScope("for", node, state);
    setNodeScope(node, state);
    const nodeRecord = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(nodeRecord)) {
      if (key === "parent") continue;
      if (TYPE_POSITION_CHILD_KEYS.has(key)) continue;
      const child = nodeRecord[key];
      if (Array.isArray(child)) {
        for (const item of child) if (isAstNode(item)) walk(item, state);
      } else if (isAstNode(child)) {
        walk(child, state);
      }
    }
    popScope(state);
    return;
  }

  if (isNodeOfType(node, "SwitchStatement")) {
    pushScope("switch", node, state);
    setNodeScope(node, state);
    if (node.discriminant) walk(node.discriminant as EsTreeNode, state);
    for (const switchCase of node.cases) walk(switchCase as EsTreeNode, state);
    popScope(state);
    return;
  }

  if (isNodeOfType(node, "TSModuleDeclaration")) {
    const moduleScope = pushScope("ts-module", node, state);
    setNodeScope(node, state);
    if (node.id && isNodeOfType(node.id as EsTreeNode, "Identifier")) {
      const identifier = node.id as { name: string } & EsTreeNode;
      // Bind the module name in BOTH the parent (so external uses
      // resolve) and the module's own scope.
      const target = findHoistTargetScope(moduleScope.parent ?? state.currentScope);
      recordSymbol(target, state, {
        name: identifier.name,
        kind: "ts-module",
        bindingIdentifier: identifier,
        declarationNode: node,
        initializer: null,
      });
      tagAsBinding(state, identifier);
    }
    if (node.body) walk(node.body as EsTreeNode, state);
    popScope(state);
    return;
  }

  if (isNodeOfType(node, "TSEnumDeclaration")) {
    handleTsDeclarations(node, state);
    pushScope("ts-enum", node, state);
    setNodeScope(node, state);
    // Enum body members can reference siblings; record them in the enum
    // scope, but don't process member references — TS enums are largely
    // opaque to our rules.
    const members = (node as { members?: ReadonlyArray<EsTreeNode> }).members ?? [];
    for (const member of members) walk(member, state);
    popScope(state);
    return;
  }

  if (isNodeOfType(node, "BlockStatement") && shouldPushBlockScope(node)) {
    pushScope("block", node, state);
    setNodeScope(node, state);
    for (const statement of node.body) walk(statement as EsTreeNode, state);
    popScope(state);
    return;
  }

  // Below this point, `node` doesn't open a scope of its own; just
  // process its declarations and recurse.

  setNodeScope(node, state);

  if (isNodeOfType(node, "VariableDeclaration")) {
    handleVariableDeclaration(node, state);
  } else if (isNodeOfType(node, "FunctionDeclaration")) {
    handleFunctionDeclaration(node, state);
  } else if (isNodeOfType(node, "ClassDeclaration")) {
    handleClassDeclaration(node, state);
  } else if (isNodeOfType(node, "ImportDeclaration")) {
    handleImportDeclaration(node, state);
  } else if (
    node.type === "TSImportEqualsDeclaration" ||
    node.type === "TSTypeAliasDeclaration" ||
    node.type === "TSInterfaceDeclaration"
  ) {
    handleTsDeclarations(node, state);
  }

  // Reference recording. Identifier in a non-binding position, AND
  // not already tagged as a binding by an earlier handler, IS a
  // reference.
  if (
    (isNodeOfType(node, "Identifier") || isNodeOfType(node, "JSXIdentifier")) &&
    !bindingPositionMarker.has(node) &&
    !isNonReferencePosition(node)
  ) {
    // JSXIdentifier needs an extra filter: tag-position lowercase
    // names like `div` / `span` are HTML strings, not bindings, and
    // a JSXMemberExpression's `.property` (the `Foo` in `<obj.Foo />`)
    // is an attribute-like name, not a reference. Only the FIRST
    // segment of a JSXMemberExpression chain (the `obj`) and a
    // standalone uppercase tag name (`<Component />`) actually
    // resolve through the scope chain.
    if (isNodeOfType(node, "JSXIdentifier")) {
      if (isJsxIdentifierBindingReference(node)) {
        recordReference(state, node, inferReferenceFlag(node));
      }
    } else {
      recordReference(state, node, inferReferenceFlag(node));
    }
  }

  // Recurse into children.
  const nodeRecord = node as unknown as Record<string, unknown>;
  for (const key of Object.keys(nodeRecord)) {
    if (key === "parent") continue;
    if (TYPE_POSITION_CHILD_KEYS.has(key)) continue;
    const child = nodeRecord[key];
    if (Array.isArray(child)) {
      for (const item of child) if (isAstNode(item)) walk(item, state);
    } else if (isAstNode(child)) {
      walk(child, state);
    }
  }
};

// Resolution pass: for each scope's references, walk up the scope
// chain to find the first scope that binds the same name. Set
// `resolvedSymbol` and append to the symbol's `references` list.
const resolveReferences = (rootScope: ScopeDescriptor): void => {
  const visitScope = (scope: ScopeDescriptor): void => {
    for (const reference of scope.references) {
      const name = (reference.identifier as { name?: string }).name;
      if (typeof name !== "string") continue;
      let lookup: ScopeDescriptor | null = scope;
      while (lookup) {
        const found = lookup.symbolsByName.get(name);
        if (found) {
          reference.resolvedSymbol = found;
          found.references.push(reference);
          break;
        }
        lookup = lookup.parent;
      }
    }
    for (const child of scope.children) visitScope(child);
  };
  visitScope(rootScope);
};

// Public entry point. Builds the scope tree, pushes the module scope
// on entry, walks the program, then resolves references.
export const analyzeScopes = (program: EsTreeNode): ScopeAnalysis => {
  const rootScope: ScopeDescriptor = {
    id: 0,
    kind: "module",
    node: program,
    parent: null,
    children: [],
    symbols: [],
    references: [],
    symbolsByName: new Map(),
  };
  const state: BuilderState = {
    nextScopeId: 1,
    nextSymbolId: 0,
    nextReferenceId: 0,
    currentScope: rootScope,
    scopeStack: [rootScope],
    rootScope,
    nodeScope: new WeakMap(),
    ownScopeForNode: new WeakMap(),
    symbolByBindingIdentifier: new WeakMap(),
    referenceByIdentifier: new WeakMap(),
  };
  state.nodeScope.set(program, rootScope);
  state.ownScopeForNode.set(program, rootScope);
  // Walk the program's statements directly (skip the `walk(program)`
  // entry which would treat program as a generic node).
  if (isNodeOfType(program, "Program")) {
    for (const statement of program.body) walk(statement as EsTreeNode, state);
  } else {
    walk(program, state);
  }
  resolveReferences(rootScope);

  const scopeFor = (node: EsTreeNode): ScopeDescriptor => {
    let current: EsTreeNode | null | undefined = node;
    while (current) {
      const scope = state.nodeScope.get(current);
      if (scope) return scope;
      current = current.parent ?? null;
    }
    return rootScope;
  };
  const symbolFor = (identifier: EsTreeNode): SymbolDescriptor | null => {
    const reference = state.referenceByIdentifier.get(identifier);
    if (reference) return reference.resolvedSymbol;
    // Maybe it's a binding identifier itself.
    const symbolForBinding = state.symbolByBindingIdentifier.get(identifier);
    if (symbolForBinding) return symbolForBinding;
    return null;
  };
  const referenceFor = (identifier: EsTreeNode): ReferenceDescriptor | null => {
    return state.referenceByIdentifier.get(identifier) ?? null;
  };
  const isGlobalReference = (identifier: EsTreeNode): boolean => {
    const reference = state.referenceByIdentifier.get(identifier);
    if (!reference) return false;
    return reference.resolvedSymbol === null;
  };

  const ownScopeFor = (node: EsTreeNode): ScopeDescriptor | null => {
    return state.ownScopeForNode.get(node) ?? null;
  };

  return {
    rootScope,
    scopeFor,
    ownScopeFor,
    symbolFor,
    referenceFor,
    isGlobalReference,
  };
};

// Helper to know if `inner` is a descendant of `outer` in the scope
// tree (or equal). Used by closure-captures; exported because rules
// also benefit.
export const isDescendantScope = (inner: ScopeDescriptor, outer: ScopeDescriptor): boolean => {
  let current: ScopeDescriptor | null = inner;
  while (current) {
    if (current === outer) return true;
    current = current.parent;
  }
  return false;
};
