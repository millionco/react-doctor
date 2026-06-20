import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isDeclarationFile } from "../../utils/is-declaration-file.js";
import { nodeStart } from "../../utils/node-start.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";
import type { ScopeDescriptor, SymbolKind } from "../../semantic/scope-analysis.js";

// Block-scoped bindings (`let` / `const` / `class` / `using`) sit in a
// Temporal Dead Zone from the top of their scope until their declaration
// executes. An access that is lexically BEFORE the declaration and runs in
// the SAME synchronous execution always throws a `ReferenceError`. We flag
// only that provable case, so the rule has no false positives:
//   - the binding is block-scoped (TDZ applies; `var` / `function` are
//     hoisted-and-initialized and params / imports are always bound);
//   - the access's byte offset precedes the declaration's;
//   - no function / class boundary sits between the access and the binding's
//     scope — a nested closure may run AFTER the declaration, so it is not a
//     guaranteed crash.
// Reading a declared-but-unassigned `let` (e.g. `let x; if (c) x = 1; use(x)`)
// is NOT a TDZ error — the binding is initialized to `undefined` — so it is
// deliberately not reported.
const TDZ_BINDING_KINDS: ReadonlySet<SymbolKind> = new Set<SymbolKind>([
  "let",
  "const",
  "class",
  "using",
]);

// Scopes whose bodies run later than the statement that introduces them: a
// function/arrow/method when it is called, and a class body's field
// initializers and methods when the class is instantiated. An access nested
// inside one may execute AFTER a later declaration, so it is not a guaranteed
// TDZ crash.
const isDeferredScope = (scope: ScopeDescriptor): boolean =>
  scope.kind === "function" ||
  scope.kind === "arrow-function" ||
  scope.kind === "method" ||
  scope.kind === "class";

// True when reaching `bindingScope` from `accessScope` crosses a deferred
// boundary, so the access is not a guaranteed TDZ crash.
const crossesDeferredBoundary = (
  accessScope: ScopeDescriptor,
  bindingScope: ScopeDescriptor,
): boolean => {
  let current: ScopeDescriptor | null = accessScope;
  while (current && current !== bindingScope) {
    if (isDeferredScope(current)) return true;
    current = current.parent;
  }
  return false;
};

export const noUseBeforeDefine = defineRule({
  id: "no-use-before-define",
  title: "Variable used before its declaration (Temporal Dead Zone)",
  severity: "warn",
  recommendation:
    "Move the access below the `let` / `const` / `class` declaration. A block-scoped binding accessed before its declaration runs throws a ReferenceError from the Temporal Dead Zone.",
  create: (context: RuleContext): RuleVisitors => {
    // Ambient declaration files are pure type space — nothing executes, so a
    // TDZ ReferenceError is impossible. Skip them entirely.
    if (isDeclarationFile(context.filename)) return {};
    return {
      Identifier(node: EsTreeNodeOfType<"Identifier">) {
        const reference = context.scopes.referenceFor(node);
        if (!reference) return;

        const symbol = reference.resolvedSymbol;
        if (!symbol) return;
        if (!TDZ_BINDING_KINDS.has(symbol.kind)) return;

        const accessStart = nodeStart(node);
        const declarationStart = nodeStart(symbol.declarationNode);
        if (accessStart < 0 || declarationStart < 0) return;
        if (accessStart >= declarationStart) return;

        if (crossesDeferredBoundary(reference.scope, symbol.scope)) return;

        context.report({
          node,
          message: `"${symbol.name}" is used here before its declaration runs, which throws a ReferenceError from the Temporal Dead Zone. Move this access below the declaration.`,
        });
      },
    };
  },
});
