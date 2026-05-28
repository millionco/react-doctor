import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import { isEs5Component } from "../../utils/is-es5-component.js";
import { isEs6Component } from "../../utils/is-es6-component.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactComponentName } from "../../utils/is-react-component-name.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import type { Rule } from "../../utils/rule.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { flattenCalleeName } from "../../utils/flatten-callee-name.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { REACT_HOC_NAMES } from "../../constants/react.js";

const buildMessage = (componentName: string): string =>
  `Declare only one React component per file. Found extra component: ${componentName}.`;

interface NoMultiCompSettings {
  ignoreStateless?: boolean;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<NoMultiCompSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { noMultiComp?: NoMultiCompSettings }).noMultiComp ?? {})
      : {};
  return { ignoreStateless: ruleSettings.ignoreStateless ?? false };
};

// Returns true when the callee name resolves (directly or through a
// scope-tracked alias) to one of memo / forwardRef / React.memo /
// React.forwardRef. Examples that should match:
//   memo(Foo)                          // directly
//   React.memo(Foo)                    // member access
//   const memo = React.memo; memo(Foo) // alias to member access
//   import { memo } from "react"; memo(Foo)
const isHocCall = (call: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(call, "CallExpression")) return false;
  const calleeName = flattenCalleeName(call.callee);
  if (calleeName && REACT_HOC_NAMES.has(calleeName)) return true;
  // Try scope-resolved alias: if callee is an Identifier, look up its
  // binding's initializer.
  if (!isNodeOfType(call.callee, "Identifier")) return false;
  const symbol = scopes.symbolFor(call.callee);
  if (!symbol) return false;
  return symbolMapsToHoc(symbol);
};

// Recursively unwraps a symbol's initializer to see if it ultimately
// points to memo / forwardRef / React.memo / React.forwardRef. Handles:
//   const memo = React.memo;             (init = MemberExpression)
//   const { memo } = React;              (init = ObjectPattern element)
//   const memo = require('react').memo;
//   import { memo } from 'react';        (kind = "import")
const symbolMapsToHoc = (symbol: SymbolDescriptor): boolean => {
  if (REACT_HOC_NAMES.has(symbol.name)) {
    // Direct shadowing or unchanged name. Verify it's an import or
    // points to the React namespace via initializer.
    if (symbol.kind === "import") return true;
  }
  const init = symbol.initializer;
  if (!init) return false;
  if (isNodeOfType(init, "MemberExpression")) {
    const flat = flattenCalleeName(init);
    if (flat && REACT_HOC_NAMES.has(flat)) return true;
  }
  if (isNodeOfType(init, "Identifier") && REACT_HOC_NAMES.has(init.name)) {
    return true;
  }
  // Destructuring: `const { memo } = React` makes the symbol's
  // initializer the `React` Identifier (per find-variable-initializer
  // semantics) — accept that as long as the symbol's NAME is a HoC.
  if (
    REACT_HOC_NAMES.has(symbol.name) &&
    isNodeOfType(init, "Identifier") &&
    init.name === "React"
  ) {
    return true;
  }
  return false;
};

// A child is "trivial" — doesn't compose another React component into the
// passthrough wrapper. Intrinsic HTML (`<path>`, `<svg>`), JSX text, and
// expression containers (`{children}`, conditionals, etc.) all count.
// PascalCase JSX children would mean the wrapper is actually composing
// structure, not just forwarding — those disqualify the passthrough.
const isTrivialPassthroughChild = (child: EsTreeNode): boolean => {
  if (child.type === "JSXText") return true;
  if (child.type === "JSXExpressionContainer") return true;
  if (child.type === "JSXFragment") return true;
  if (isNodeOfType(child, "JSXElement")) {
    const open = child.openingElement;
    if (isNodeOfType(open.name, "JSXIdentifier")) {
      const first = open.name.name.charCodeAt(0);
      // Lowercase first char = intrinsic HTML — OK.
      return first < 65 || first > 90;
    }
    return false;
  }
  return false;
};

// A simple JSX passthrough: `<PascalCaseComponent {...spread} default1
// default2 …/>` with no composed React-component children. Used by
// `is_passthrough_*` to recognize `(props, ref) => <Foo {...props} ref={ref} />`
// style trampolines AND shadcn / icon-barrel re-exports that wrap a single
// element with a few default props + a spread. The attrs cap (6) is tuned
// for the typical shadcn shape: data-slot + className with `cn()` + 1-3
// default values + spread. OXC's no-multi-comp doesn't count these as
// separate components because they only forward.
const MAX_PASSTHROUGH_ATTRS = 6;

const isSimpleJsxPassthrough = (expression: EsTreeNode): boolean => {
  if (!isNodeOfType(expression, "JSXElement")) return false;
  const opening = expression.openingElement;
  if (!isNodeOfType(opening.name, "JSXIdentifier")) return false;
  if (!isReactComponentName(opening.name.name)) return false;
  const attrs = opening.attributes;
  if (attrs.length > MAX_PASSTHROUGH_ATTRS) return false;
  const hasSpread = attrs.some((attr) => isNodeOfType(attr as EsTreeNode, "JSXSpreadAttribute"));
  if (!hasSpread) return false;
  for (const child of expression.children ?? []) {
    if (!isTrivialPassthroughChild(child as EsTreeNode)) return false;
  }
  return true;
};

const isSingleReturnPassthrough = (statements: ReadonlyArray<EsTreeNode>): boolean => {
  if (statements.length !== 1) return false;
  const only = statements[0]!;
  if (!isNodeOfType(only, "ReturnStatement")) return false;
  if (!only.argument) return false;
  return isSimpleJsxPassthrough(only.argument as EsTreeNode);
};

const isPassthroughFunction = (fn: EsTreeNode): boolean => {
  if (!isNodeOfType(fn, "FunctionExpression") && !isNodeOfType(fn, "FunctionDeclaration")) {
    return false;
  }
  const body = (fn as { body: EsTreeNode | null }).body;
  if (!body || !isNodeOfType(body, "BlockStatement")) return false;
  return isSingleReturnPassthrough(body.body as EsTreeNode[]);
};

const isPassthroughArrow = (arrow: EsTreeNode): boolean => {
  if (!isNodeOfType(arrow, "ArrowFunctionExpression")) return false;
  const body = arrow.body as EsTreeNode;
  if (isNodeOfType(body, "BlockStatement"))
    return isSingleReturnPassthrough(body.body as EsTreeNode[]);
  return isSimpleJsxPassthrough(body);
};

// True when the call is `memo(<arg>)` / `forwardRef(<arg>)` (with
// React.* aliases or scope-resolved local names) AND <arg> is a
// function whose body actually contains JSX AND is NOT a passthrough
// trampoline.
const isHocComponent = (call: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isHocCall(call, scopes)) return false;
  const callExpression = call as EsTreeNodeOfType<"CallExpression">;
  const arg = callExpression.arguments[0] as EsTreeNode | undefined;
  if (!arg) return false;
  if (isNodeOfType(arg, "FunctionExpression")) {
    return !isPassthroughFunction(arg) && containsJsx(arg);
  }
  if (isNodeOfType(arg, "ArrowFunctionExpression")) {
    return !isPassthroughArrow(arg) && containsJsx(arg);
  }
  return false;
};

// Walks `root` looking for any JSX. By default DOESN'T descend into
// nested function/class bodies — the caller passes the function/arrow
// they want to inspect AS the root, so the first traversal step still
// enters its body. Set `crossFunctionBoundaries` to walk through
// nested fn boundaries (used by `expression_contains_jsx` mode below).
const containsJsx = (root: EsTreeNode): boolean => {
  let found = false;
  const visit = (node: EsTreeNode): void => {
    if (found) return;
    if (node.type === "JSXElement" || node.type === "JSXFragment") {
      found = true;
      return;
    }
    // Don't recurse into nested function/class boundaries (other than
    // root itself).
    if (node !== root) {
      if (
        node.type === "FunctionDeclaration" ||
        node.type === "FunctionExpression" ||
        node.type === "ArrowFunctionExpression" ||
        node.type === "ClassDeclaration" ||
        node.type === "ClassExpression"
      ) {
        return;
      }
    }
    const record = node as unknown as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "parent") continue;
      const child = record[key];
      if (Array.isArray(child)) {
        for (const item of child) if (isAstNode(item)) visit(item);
      } else if (isAstNode(child)) {
        visit(child);
      }
      if (found) return;
    }
  };
  visit(root);
  return found;
};

// Mirror of OXC's `expression_contains_jsx`: walks INTO function /
// arrow bodies looking for JSX. Used to test "is this expression
// (which is itself a function-or-arrow) a JSX-rendering callback?"
const expressionContainsJsx = (expression: EsTreeNode): boolean => {
  if (
    isNodeOfType(expression, "FunctionExpression") ||
    isNodeOfType(expression, "FunctionDeclaration") ||
    isNodeOfType(expression, "ArrowFunctionExpression")
  ) {
    const body = (expression as { body?: EsTreeNode | null }).body;
    if (!body) return false;
    return containsJsx(body);
  }
  return false;
};

const isFunctionReturningNull = (expression: EsTreeNode): boolean => {
  if (
    !isNodeOfType(expression, "ArrowFunctionExpression") &&
    !isNodeOfType(expression, "FunctionExpression")
  ) {
    return false;
  }
  const body = (expression as { body: EsTreeNode }).body;
  if (isNodeOfType(body, "Literal")) return body.value === null;
  if (!isNodeOfType(body, "BlockStatement")) return false;
  for (const statement of body.body) {
    if (
      isNodeOfType(statement, "ReturnStatement") &&
      statement.argument &&
      isNodeOfType(statement.argument, "Literal") &&
      statement.argument.value === null
    ) {
      return true;
    }
  }
  return false;
};

interface DetectedComponent {
  name: string;
  reportNode: EsTreeNode;
  isStateless: boolean;
}

// True if the node is in a top-level `export …` declaration. Walks
// parents looking for an ExportNamedDeclaration / ExportDefaultDeclaration
// before crossing any non-trivial scope boundary.
// Collects names re-exported at the bottom of a file via the
// specifier-form `export { Foo, Bar, Baz }`. shadcn-style primitive
// files use this almost exclusively: declarations live at module
// scope, then ONE export block at the end. Without this, every such
// barrel had `exportedCount === 0` and slipped past both the barrel
// and the feature-module exemption.
//
// Also collects names from namespace-style exports:
//   export const DefinitionPopover = { Wrapper, Header, Description, … }
// The user is exporting all the private functions under a single
// namespace value — they're still part of the public API surface.
const collectReExportedNames = (program: EsTreeNode): Set<string> => {
  const names = new Set<string>();
  if (!isNodeOfType(program, "Program")) return names;
  for (const statement of program.body) {
    // `export default Foo` where `Foo` is an Identifier referencing a
    // separately-declared component. Walking up from `Foo`'s binding
    // node never reaches the ExportDefaultDeclaration, so we record
    // the name here for `isExportedDeclaration` to pick up.
    if (isNodeOfType(statement, "ExportDefaultDeclaration")) {
      if (isNodeOfType(statement.declaration, "Identifier")) {
        names.add(statement.declaration.name);
      }
      continue;
    }
    if (!isNodeOfType(statement, "ExportNamedDeclaration")) continue;
    // Specifier form: `export { Foo, Bar }`
    if (!statement.declaration) {
      for (const specifier of statement.specifiers ?? []) {
        if (!isNodeOfType(specifier, "ExportSpecifier")) continue;
        const local = specifier.local as EsTreeNode;
        if (isNodeOfType(local, "Identifier")) names.add(local.name);
      }
      continue;
    }
    // Inline form: `export const X = ObjectExpression` — namespace
    // pattern where the user re-groups private functions under a
    // single exported value (`DefinitionPopover.Wrapper` etc.).
    if (!isNodeOfType(statement.declaration, "VariableDeclaration")) continue;
    for (const declarator of statement.declaration.declarations ?? []) {
      if (!isNodeOfType(declarator, "VariableDeclarator")) continue;
      if (!isNodeOfType(declarator.init, "ObjectExpression")) continue;
      for (const property of declarator.init.properties ?? []) {
        if (!isNodeOfType(property, "Property")) continue;
        if (property.computed) continue;
        // `{ Wrapper, Header }` (shorthand) and `{ Wrapper: Wrapper, ... }`
        // both end up with Identifier values that name the binding.
        const value = property.value as EsTreeNode;
        if (isNodeOfType(value, "Identifier")) names.add(value.name);
      }
    }
  }
  return names;
};

const isExportedDeclaration = (node: EsTreeNode, reExportedNames: Set<string>): boolean => {
  // The component's reportNode is the binding identifier (e.g.
  // `Foo` inside `export function Foo()`). To detect export-ness we
  // walk up through AT MOST one function/class layer (the binding
  // node itself) so `export function Foo()` and `export const Foo =`
  // both resolve correctly, while a function nested INSIDE another
  // function still bails before climbing out of its host.
  if (isNodeOfType(node, "Identifier") && reExportedNames.has(node.name)) {
    return true;
  }
  let current: EsTreeNode | null | undefined = node.parent;
  let didCrossOneBindingLayer = false;
  while (current) {
    if (
      isNodeOfType(current, "ExportNamedDeclaration") ||
      isNodeOfType(current, "ExportDefaultDeclaration")
    ) {
      return true;
    }
    if (isNodeOfType(current, "Program")) return false;
    if (
      isNodeOfType(current, "FunctionDeclaration") ||
      isNodeOfType(current, "FunctionExpression") ||
      isNodeOfType(current, "ArrowFunctionExpression") ||
      isNodeOfType(current, "ClassDeclaration") ||
      isNodeOfType(current, "ClassExpression")
    ) {
      if (didCrossOneBindingLayer) return false;
      didCrossOneBindingLayer = true;
    }
    current = current.parent ?? null;
  }
  return false;
};

// Recognizes `const Foo = <something>` shapes that look like a
// component declaration: arrow/function returning JSX, HoC call, or
// a function expression returning null.
const detectVariableComponent = (
  declarator: EsTreeNode,
  scopes: ScopeAnalysis,
): DetectedComponent | null => {
  if (!isNodeOfType(declarator, "VariableDeclarator")) return null;
  if (!isNodeOfType(declarator.id, "Identifier")) return null;
  const name = declarator.id.name;
  if (!isReactComponentName(name)) return null;
  let init = declarator.init as EsTreeNode | null;
  if (!init) return null;
  // Strip parens / TS wrappers so `(0, arrow)` and similar shapes
  // expose their SequenceExpression / arrow inner.
  init = stripParenExpression(init);
  // Passthrough arrow / function (`const Foo = (props) => <X {...props} />`)
  // is a thin wrapper, not a separate component — skip for the same
  // reason HoC passthroughs are skipped (shadcn / Radix barrels).
  if (isPassthroughArrow(init) || isPassthroughFunction(init)) {
    return null;
  }
  // `expressionContainsJsx` walks into an arrow/function body — used
  // for shapes like `const Foo = () => <div/>` (init IS the arrow).
  if (expressionContainsJsx(init) || isFunctionReturningNull(init)) {
    return { name, reportNode: declarator.id as EsTreeNode, isStateless: true };
  }
  if (isNodeOfType(init, "SequenceExpression")) {
    const expressions = init.expressions;
    const last = expressions[expressions.length - 1];
    if (
      last &&
      (expressionContainsJsx(last as EsTreeNode) || isFunctionReturningNull(last as EsTreeNode))
    ) {
      return { name, reportNode: declarator.id as EsTreeNode, isStateless: true };
    }
  }
  if (isHocComponent(init, scopes)) {
    return { name, reportNode: declarator.id as EsTreeNode, isStateless: true };
  }
  return null;
};

interface VisitContext {
  components: DetectedComponent[];
  componentDepth: number;
  currentVarName: string | null;
  scopes: ScopeAnalysis;
}

const recordComponent = (
  context: VisitContext,
  name: string,
  reportNode: EsTreeNode,
  isStateless: boolean,
): void => {
  if (context.componentDepth === 0) {
    context.components.push({ name, reportNode, isStateless });
  }
};

const walkChildren = (node: EsTreeNode, context: VisitContext): void => {
  const record = node as unknown as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key === "parent") continue;
    const child = record[key];
    if (Array.isArray(child)) {
      for (const item of child) if (isAstNode(item)) walkComponentSearch(item, context);
    } else if (isAstNode(child)) {
      walkComponentSearch(child, context);
    }
  }
};

const walkComponentSearch = (node: EsTreeNode, context: VisitContext): void => {
  // ES6 class component
  if (isNodeOfType(node, "ClassDeclaration") || isNodeOfType(node, "ClassExpression")) {
    if (isEs6Component(node)) {
      const name = node.id ? node.id.name : "UnnamedComponent";
      recordComponent(context, name, (node.id as EsTreeNode | null) ?? node, false);
      context.componentDepth += 1;
      walkChildren(node, context);
      context.componentDepth -= 1;
      return;
    }
  }

  // Named function declaration / expression with JSX (matches OXC's
  // visit_function which handles BOTH). Passthrough wrappers — a single
  // return of `<X {...props} />` — aren't real components for the
  // "multiple components per file" purpose; they're thin re-exports,
  // common in shadcn / Radix-style barrel files and icon barrels.
  if (isNodeOfType(node, "FunctionDeclaration") || isNodeOfType(node, "FunctionExpression")) {
    if (
      node.id &&
      isReactComponentName(node.id.name) &&
      containsJsx(node as EsTreeNode) &&
      !isPassthroughFunction(node as EsTreeNode)
    ) {
      recordComponent(context, node.id.name, node.id as EsTreeNode, true);
      context.componentDepth += 1;
      walkChildren(node, context);
      context.componentDepth -= 1;
      return;
    }
  }

  // VariableDeclarator: const Foo = <init>
  if (isNodeOfType(node, "VariableDeclarator")) {
    const detected = detectVariableComponent(node, context.scopes);
    if (detected) {
      recordComponent(context, detected.name, detected.reportNode, detected.isStateless);
      const previousName = context.currentVarName;
      context.currentVarName = detected.name;
      context.componentDepth += 1;
      walkChildren(node, context);
      context.componentDepth -= 1;
      context.currentVarName = previousName;
      return;
    }
    // Track variable name so a nested createReactClass call can use it.
    const previousName = context.currentVarName;
    if (isNodeOfType(node.id, "Identifier")) context.currentVarName = node.id.name;
    walkChildren(node, context);
    context.currentVarName = previousName;
    return;
  }

  // ES5 createReactClass
  if (isNodeOfType(node, "CallExpression") && isEs5Component(node)) {
    if (context.componentDepth === 0) {
      const name = context.currentVarName ?? "UnnamedComponent";
      recordComponent(context, name, node, false);
      context.componentDepth += 1;
      walkChildren(node, context);
      context.componentDepth -= 1;
      return;
    }
  }

  // export default React.forwardRef(...) — treat as anonymous component
  // unless the wrapped function is a passthrough trampoline.
  if (isNodeOfType(node, "ExportDefaultDeclaration")) {
    const declaration = node.declaration as EsTreeNode;
    if (
      isNodeOfType(declaration, "CallExpression") &&
      isHocComponent(declaration, context.scopes)
    ) {
      recordComponent(context, "UnnamedComponent", node, true);
      context.componentDepth += 1;
      walkChildren(node, context);
      context.componentDepth -= 1;
      return;
    }
  }

  // Object property: { RenderFoo() { return <div/> } } where key is PascalCase.
  if (isNodeOfType(node, "Property")) {
    if (
      isNodeOfType(node.key, "Identifier") &&
      isReactComponentName(node.key.name) &&
      (isNodeOfType(node.value, "FunctionExpression") ||
        isNodeOfType(node.value, "ArrowFunctionExpression")) &&
      containsJsx(node.value as EsTreeNode)
    ) {
      recordComponent(context, node.key.name, node.key as EsTreeNode, true);
      context.componentDepth += 1;
      walkChildren(node, context);
      context.componentDepth -= 1;
      return;
    }
  }

  // Assignment to exports.Foo / module.exports.Foo
  if (isNodeOfType(node, "AssignmentExpression")) {
    if (
      isNodeOfType(node.left, "MemberExpression") &&
      isNodeOfType(node.left.property, "Identifier") &&
      !node.left.computed &&
      isReactComponentName(node.left.property.name)
    ) {
      const right = node.right;
      const isComponent =
        containsJsx(right as EsTreeNode) ||
        ((isNodeOfType(right, "FunctionExpression") ||
          isNodeOfType(right, "ArrowFunctionExpression")) &&
          containsJsx(right as EsTreeNode));
      if (isComponent) {
        recordComponent(context, node.left.property.name, node.left.property as EsTreeNode, true);
        context.componentDepth += 1;
        walkChildren(node, context);
        context.componentDepth -= 1;
        return;
      }
    }
  }

  walkChildren(node, context);
};

// Port of `oxc_linter::rules::react::no_multi_comp`. Detects React
// components declared in a single file via:
//   - ES6 class components (`class Foo extends React.Component`)
//   - Named function declarations returning JSX
//   - Variable declarators bound to functions/arrow returning JSX
//   - HoC wrappers: `memo(...)`, `forwardRef(...)`, `React.memo(...)`,
//     `React.forwardRef(...)`
//   - createReactClass({...}) calls
//   - PascalCase object-property values that are functions returning
//     JSX (`{ Foo() { return <div/> } }`)
//   - Assignment to `exports.Foo = function() { return <div/> }`
//
// Component nesting is tracked: components defined INSIDE another
// component aren't double-counted.
export const noMultiComp = defineRule<Rule>({
  id: "no-multi-comp",
  severity: "warn",
  recommendation: "Move secondary components into their own files.",
  category: "Architecture",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    const isTestlikeFile = isTestlikeFilename(context.filename);
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        // Test / story / Cypress files routinely declare several tiny
        // throwaway components in a single file to exercise different
        // scenarios — that's the point of fixture co-location, not a
        // bug. Skip them.
        if (isTestlikeFile) return;
        const visitContext: VisitContext = {
          components: [],
          componentDepth: 0,
          currentVarName: null,
          scopes: context.scopes,
        };
        for (const statement of node.body)
          walkComponentSearch(statement as EsTreeNode, visitContext);

        const flagged = settings.ignoreStateless
          ? visitContext.components.filter((component) => !component.isStateless)
          : visitContext.components;
        // Co-located helper pattern: a file with at most 2 detected
        // components is the canonical "1 main + 1 sub-component" shape
        // (e.g. `ErrorBoundary` + `OptionalErrorBoundary`, `FPSMeter` +
        // `FpsMeterInner`, `ArrowShapeUtil` + `ArrowClipPath`,
        // `getSvgJsx.tsx`'s `SvgExport` + `ForeignObjectShape`). Forcing
        // a second file for the helper fragments tightly-coupled UI
        // without any maintenance benefit — the helper is a private
        // implementation detail of the main component, not a sibling.
        if (flagged.length <= 2) return;
        // Two exemption shapes, both informed by the corpus:
        //
        //   1. BARREL: 4+ components, 75%+ exported — icon barrels, menu
        //      groups, shadcn re-export files. Splitting would be churn.
        //
        //   2. PAGE-WITH-HELPERS: exactly ONE exported component plus N
        //      private helpers (`function FooHelper() { ... }` only used
        //      by the exported page). This is the canonical "feature
        //      module" shape — `<SettingsAdminNewAiProvider>` with a
        //      couple internal subcomponents — and forcing the user to
        //      split each helper into its own file would only fragment
        //      tightly-coupled UI.
        const reExportedNames = collectReExportedNames(node as EsTreeNode);
        const exportedCount = flagged.filter((component) =>
          isExportedDeclaration(component.reportNode, reExportedNames),
        ).length;
        // BARREL: many components, most exported. Two band-tightnesses
        // (tuned against the corpus):
        //   - 4+ components, 70 %+ exported  → tight shadcn-style barrel
        //     (uses `Math.floor` so 11/15 = 73 % counts; the strictly-
        //     ceil version excluded `WebAnalyticsTile.tsx`-style files
        //     that are clearly a tile module by structure)
        //   - 8+ components, 50 %+ exported  → bigger feature module
        //     where a handful of private helpers (`PreferencesToggle*`
        //     / `Cell` / `SortableCell` style) sit alongside the
        //     public exports
        const isBarrelLikeFile =
          (flagged.length >= 4 && exportedCount >= Math.floor(flagged.length * 0.7)) ||
          (flagged.length >= 8 && exportedCount >= Math.floor(flagged.length * 0.5));
        if (isBarrelLikeFile) return;
        // Feature module: small exported surface + N private helpers
        // making up the bulk of the file. Two band-tightnesses:
        //   - 1–2 exported (any flagged.length) — the canonical
        //     `<FeatureScene />` + `<FeatureSceneHeader />` two-piece
        //     public API shape with a couple of internal helpers.
        //   - 1–4 exported AND flagged.length >= 8 AND the private
        //     helpers are the majority (exportedCount * 2 <
        //     flagged.length) — `PlayerSummaryViews.tsx`-style coherent
        //     feature module where one public surface like
        //     `<SessionSummary />` is implemented via a handful of
        //     internal exports plus many private subcomponents.
        const isSmallFeatureModule =
          exportedCount > 0 && exportedCount <= 2 && exportedCount < flagged.length;
        const isLargeFeatureModule =
          exportedCount > 0 &&
          exportedCount <= 4 &&
          flagged.length >= 8 &&
          exportedCount * 2 < flagged.length;
        // Very-large feature module: 8+ exports, 12+ total, private
        // helpers still 30 %+ of the file. PostHog's
        // `WebAnalyticsFilters.tsx` / `WebAnalyticsDashboard.tsx` shape
        // — feature modules with a public surface of 5–8 named
        // components plus a handful of private subcomponents
        // (`<HeaderRow>`, `<MaybeWrapInTooltip>`, etc.). Splitting each
        // public component into its own file would fragment a tightly-
        // coupled UI without any maintenance benefit; the file already
        // names the feature.
        const isVeryLargeFeatureModule =
          exportedCount >= 5 &&
          flagged.length >= 12 &&
          // Private helpers ≥ 25 % of the file (so we're not just
          // exempting a barrel that mostly re-exports).
          (flagged.length - exportedCount) * 4 >= flagged.length;
        if (isSmallFeatureModule || isLargeFeatureModule || isVeryLargeFeatureModule) return;
        for (const component of flagged.slice(1)) {
          context.report({ node: component.reportNode, message: buildMessage(component.name) });
        }
      },
    };
  },
});
