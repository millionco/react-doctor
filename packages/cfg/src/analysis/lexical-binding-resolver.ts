import type { EsTreeNode } from "../ast/es-tree-node.js";
import { forEachChildNode } from "../ast/for-each-child-node.js";
import { isFunctionLike } from "../ast/is-function-like.js";
import { isNodeOfType } from "../ast/is-node-of-type.js";
import type { BindingId, ResolveBinding } from "../ir/place.js";

interface LexicalScope {
  readonly parent: LexicalScope | null;
  // A function or the program — the target `var`/`function` declarations
  // hoist to, regardless of the block they appear in. Block scopes are not.
  readonly isHoistBoundary: boolean;
  readonly bindings: Map<string, BindingId>;
}

// The nearest enclosing hoist boundary (function or program).
const hoistScopeOf = (scope: LexicalScope): LexicalScope => {
  let current = scope;
  while (!current.isHoistBoundary && current.parent !== null) current = current.parent;
  return current;
};

// A block-like node opens a fresh lexical scope for its `let`/`const`/class
// declarations. Function bodies open a scope through the function itself
// (which also holds the parameters), so the body BlockStatement nesting is
// harmless.
const opensBlockScope = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "BlockStatement") ||
  isNodeOfType(node, "ForStatement") ||
  isNodeOfType(node, "ForInStatement") ||
  isNodeOfType(node, "ForOfStatement") ||
  isNodeOfType(node, "SwitchStatement") ||
  isNodeOfType(node, "CatchClause");

// A lightweight lexical scope/shadowing/hoisting resolver, self-contained
// so SSA is testable without a host. Declarations are registered while
// walking; resolution is deferred until the whole tree is seen, so forward
// references and hoisting (`x; var x;`) resolve by scope-chain lookup. The
// oxlint plugin can inject its richer `scope-analysis` resolver instead.
export const createLexicalBindingResolver = (program: EsTreeNode): ResolveBinding => {
  let nextBindingId = 0;
  const scopeOfIdentifier = new Map<EsTreeNode, LexicalScope>();

  const declare = (scope: LexicalScope, name: string): void => {
    if (!scope.bindings.has(name)) scope.bindings.set(name, nextBindingId++);
  };

  // Register the binding names a destructuring/parameter pattern introduces
  // (default-value and computed-key expressions are handled by the generic
  // child walk, so they are skipped here).
  const declarePattern = (pattern: EsTreeNode, scope: LexicalScope): void => {
    if (isNodeOfType(pattern, "Identifier")) {
      declare(scope, pattern.name);
      return;
    }
    if (isNodeOfType(pattern, "ObjectPattern")) {
      for (const property of pattern.properties) {
        if (isNodeOfType(property, "RestElement")) {
          declarePattern(property.argument as EsTreeNode, scope);
        } else {
          declarePattern(property.value as EsTreeNode, scope);
        }
      }
      return;
    }
    if (isNodeOfType(pattern, "ArrayPattern")) {
      for (const element of pattern.elements) {
        if (element) declarePattern(element as EsTreeNode, scope);
      }
      return;
    }
    if (isNodeOfType(pattern, "AssignmentPattern")) {
      declarePattern(pattern.left as EsTreeNode, scope);
      return;
    }
    if (isNodeOfType(pattern, "RestElement")) {
      declarePattern(pattern.argument as EsTreeNode, scope);
    }
  };

  const registerDeclarations = (node: EsTreeNode, scope: LexicalScope): void => {
    if (isNodeOfType(node, "VariableDeclaration")) {
      const target = node.kind === "var" ? hoistScopeOf(scope) : scope;
      for (const declarator of node.declarations) {
        declarePattern(declarator.id as EsTreeNode, target);
      }
      return;
    }
    if (isNodeOfType(node, "FunctionDeclaration") && node.id) {
      declare(hoistScopeOf(scope), node.id.name);
      return;
    }
    if (isNodeOfType(node, "ClassDeclaration") && node.id) {
      declare(scope, node.id.name);
      return;
    }
    if (isNodeOfType(node, "ImportDeclaration")) {
      for (const specifier of node.specifiers) {
        declare(hoistScopeOf(scope), specifier.local.name);
      }
    }
  };

  const walk = (node: EsTreeNode, scope: LexicalScope): void => {
    if (isNodeOfType(node, "Identifier")) {
      scopeOfIdentifier.set(node, scope);
      return;
    }

    // A function declaration's own name belongs to the enclosing scope, not
    // the function's; register it before descending into the new scope.
    registerDeclarations(node, scope);

    if (isFunctionLike(node)) {
      const functionScope: LexicalScope = {
        parent: scope,
        isHoistBoundary: true,
        bindings: new Map(),
      };
      // A named function expression's name is visible only inside itself.
      if (isNodeOfType(node, "FunctionExpression") && node.id) {
        declare(functionScope, node.id.name);
      }
      for (const parameter of node.params) declarePattern(parameter as EsTreeNode, functionScope);
      forEachChildNode(node, (child) => walk(child, functionScope));
      return;
    }

    if (opensBlockScope(node)) {
      const blockScope: LexicalScope = {
        parent: scope,
        isHoistBoundary: false,
        bindings: new Map(),
      };
      if (isNodeOfType(node, "CatchClause") && node.param) {
        declarePattern(node.param as EsTreeNode, blockScope);
      }
      forEachChildNode(node, (child) => walk(child, blockScope));
      return;
    }

    forEachChildNode(node, (child) => walk(child, scope));
  };

  const rootScope: LexicalScope = {
    parent: null,
    isHoistBoundary: true,
    bindings: new Map(),
  };
  // Resolution is deferred, so a single declaration-registering walk
  // suffices — top-level forward references and hoisting resolve by chain.
  forEachChildNode(program, (child) => walk(child, rootScope));

  return (identifier: EsTreeNode): BindingId | null => {
    if (!isNodeOfType(identifier, "Identifier")) return null;
    let scope: LexicalScope | null = scopeOfIdentifier.get(identifier) ?? rootScope;
    while (scope !== null) {
      const binding = scope.bindings.get(identifier.name);
      if (binding !== undefined) return binding;
      scope = scope.parent;
    }
    return null;
  };
};
