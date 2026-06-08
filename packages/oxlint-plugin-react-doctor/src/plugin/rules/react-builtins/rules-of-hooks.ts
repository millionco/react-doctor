import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactComponentOrHookName } from "../../utils/is-react-component-or-hook-name.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import { REACT_HOC_NAMES } from "../../constants/react.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import type { Rule } from "../../utils/rule.js";

// Port of `oxc_linter::rules::react::rules_of_hooks`. Enforces React's
// Rules of Hooks:
//   1. Hook calls must be at the top level of a React function
//      component or a custom Hook — never inside conditionals, loops,
//      or nested non-Hook functions.
//   2. Hook calls must be unconditional (every render hits the same
//      hook calls in the same order).
//   3. Hook calls must not appear after early return / inside try /
//      inside async functions.
//
// Uses the CFG (`context.cfg.isUnconditionalFromEntry`) for the
// "unconditional" check and walks the AST parent chain for the rest.

const buildTopLevelMessage = (hookName: string): string =>
  `\`${hookName}\` can only run inside a React component or custom Hook because React needs that render scope to track Hook state.`;
const buildNonComponentMessage = (hookName: string, functionName: string): string =>
  `\`${hookName}\` runs inside \`${functionName}\`, which is not a component or Hook, so React cannot attach Hook state to a render.`;
const buildConditionalMessage = (hookName: string): string =>
  `\`${hookName}\` changes Hook order between renders when called conditionally, so React can attach state to the wrong Hook.`;
const buildLoopMessage = (hookName: string): string =>
  `\`${hookName}\` can run a different number of times inside a loop, so React can attach state to the wrong Hook.`;
const buildAsyncMessage = (hookName: string): string =>
  `\`${hookName}\` runs inside an async function, so React cannot guarantee the same Hook order during render.`;
const buildClassComponentMessage = (hookName: string): string =>
  `\`${hookName}\` cannot run in a class component because Hooks require a function component or custom Hook render scope.`;
const buildTryMessage = (hookName: string): string =>
  `\`${hookName}\` can be skipped by try/catch/finally control flow, so React can attach state to the wrong Hook.`;
const buildEffectEventCallMessage = (bindingName: string): string =>
  `\`${bindingName}\` comes from useEffectEvent, so it only works when called from Effects in the same component.`;
const buildEffectEventAssignmentMessage = (bindingName: string): string =>
  `${buildEffectEventCallMessage(bindingName)} It also breaks if saved in a variable or passed around.`;
const buildEffectEventPassedDownMessage = (): string =>
  `A function from useEffectEvent only works inside Effects in the same component, so passing it around breaks the event/dependency split.`;

// ASCII range used for the PascalCase namespace heuristic in member
// hook calls (`Hook.useFoo` flagged, `jest.useFoo` not).
const ASCII_UPPERCASE_A = 65;
const ASCII_UPPERCASE_Z = 90;

interface HookContext {
  hookName: string;
}

interface RulesOfHooksSettings {
  additionalEffectHooks?: string;
  allowedPascalCaseHookNamespaces?: ReadonlyArray<string>;
}

const EFFECT_HOOK_NAMES: ReadonlySet<string> = new Set([
  "useEffect",
  "useLayoutEffect",
  "useInsertionEffect",
]);

const isPascalCaseIdentifier = (identifier: EsTreeNodeOfType<"Identifier">): boolean => {
  const firstCharCode = identifier.name.charCodeAt(0);
  return firstCharCode >= ASCII_UPPERCASE_A && firstCharCode <= ASCII_UPPERCASE_Z;
};

const buildAdditionalEffectHooksRegex = (additionalEffectHooks: string): RegExp | null => {
  if (!additionalEffectHooks) return null;
  try {
    return new RegExp(additionalEffectHooks);
  } catch {
    return null;
  }
};

const getHookNameFromCallee = (callee: EsTreeNode): string | null => {
  if (isNodeOfType(callee, "Identifier")) return callee.name;
  if (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.property, "Identifier")
  ) {
    return callee.property.name;
  }
  return null;
};

const readAdditionalEffectHooks = (value: unknown): string => {
  if (typeof value !== "object" || value === null) return "";
  const settings = value as RulesOfHooksSettings;
  return settings.additionalEffectHooks ?? "";
};

const readAllowedPascalCaseHookNamespaces = (value: unknown): ReadonlyArray<string> => {
  if (typeof value !== "object" || value === null) return [];
  const settings = value as RulesOfHooksSettings;
  return settings.allowedPascalCaseHookNamespaces ?? [];
};

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<RulesOfHooksSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const reactDoctorSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? (reactDoctor as { rulesOfHooks?: RulesOfHooksSettings })["rulesOfHooks"]
      : undefined;

  return {
    additionalEffectHooks:
      reactDoctorSettings?.additionalEffectHooks ??
      readAdditionalEffectHooks(settings?.["react-hooks"]),
    allowedPascalCaseHookNamespaces:
      reactDoctorSettings?.allowedPascalCaseHookNamespaces ??
      readAllowedPascalCaseHookNamespaces(settings?.["react-hooks"]),
  };
};

// Mirrors OXC's `is_react_hook` — matches:
//   useFoo(...)                 (bare identifier with use prefix)
//   React.useFoo(...)           (the React namespace)
//   someCall().useFoo(...)      (chained call result)
// Crucially does NOT match `Sinon.useFakeTimers(...)` — third-party
// libraries that just happen to have a use-prefixed member.
//
// For bare identifier calls, additionally consult scope analysis to
// confirm the binding (if resolved) actually comes from React; a local
// `use` parameter / non-React import shouldn't be treated as a hook.
const isHookCall = (
  call: EsTreeNode,
  scopes: ScopeAnalysis,
  settings: Required<RulesOfHooksSettings>,
): HookContext | null => {
  if (!isNodeOfType(call, "CallExpression")) return null;
  const callee = call.callee;
  if (isNodeOfType(callee, "Identifier") && isReactHookName(callee.name)) {
    // Resolution policy mirrors upstream's "use-prefixed names ARE
    // hooks" stance for everything except the React 19 `use` hook:
    //   - parameter / catch-clause / for-binding → skip (purely local)
    //   - For `use` specifically (a generic verb that conflicts with
    //     fixture-runner / dependency-injection libraries), require
    //     the binding to resolve to a React `use` export. Otherwise
    //     skip.
    //   - For every other use-prefixed callee (e.g. `useState`,
    //     `useBasename`, `useFeatureFlag`, …), trust the naming
    //     convention even when the binding is from a non-React
    //     module. This matches upstream's intentional false-positive
    //     stance on `useBasename` from `history` etc.
    const symbol = scopes.symbolFor(callee);
    if (symbol) {
      if (symbol.kind === "parameter" || symbol.kind === "catch-clause-parameter") {
        return null;
      }
      if (callee.name === "use") {
        const reactName = resolveReactImportName(symbol, scopes);
        if (reactName !== "use") return null;
        // Hoisted local `function use() {...}` bindings are ALSO
        // skipped — these would shadow the React import locally.
        if (symbol.kind === "function") return null;
      }
    }
    return { hookName: callee.name };
  }
  if (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.property, "Identifier") &&
    isReactHookName(callee.property.name)
  ) {
    const callObject = callee.object;
    const propertyName = callee.property.name;
    // Upstream's heuristic: a use-prefixed member call IS a hook iff
    // the object reads like a "namespace" — PascalCase identifier
    // (`Hook` / `This` / `Super` / `React` / `FooStore` / `Namespace`)
    // or a call-expression result (chained usage). Lowercase-starting
    // identifiers (`jest.useFakeTimers`, `lodash.useFoo`) and the
    // class-method `this` / `super` keywords are NOT hooks.
    if (isNodeOfType(callObject, "Identifier")) {
      if (settings.allowedPascalCaseHookNamespaces.includes(callObject.name)) return null;
      if (!isPascalCaseIdentifier(callObject)) return null;
      return { hookName: propertyName };
    }
    // Chained-call hooks (`<callExpr>.useFoo(...)`) are vanishingly
    // rare in real React code — and frequent in library APIs whose
    // method names happen to start with `use`: NestJS's
    // `Test.createTestingModule(...).overrideGuard(...).useValue(...)`,
    // `unified().use(rehypeParse)`, `chai.expect(x).use(...)`, RxJS's
    // `pipe().use(...)`, etc. Zero upstream fixtures exercise this
    // chain shape for an actual hook, so we don't flag it. Bare
    // `useState(...)` and namespace-qualified `Hook.useState(...)`
    // patterns continue to fire correctly via the other branches.
    return null;
  }
  return null;
};

const isReactImport = (symbol: SymbolDescriptor): boolean => {
  // The declarationNode is an ImportSpecifier / ImportDefaultSpecifier /
  // ImportNamespaceSpecifier. Its parent chain leads to an
  // ImportDeclaration whose source we read.
  let importDeclaration: EsTreeNode | null | undefined = symbol.declarationNode?.parent;
  while (importDeclaration && !isNodeOfType(importDeclaration, "ImportDeclaration")) {
    importDeclaration = importDeclaration.parent ?? null;
  }
  if (!importDeclaration || !isNodeOfType(importDeclaration, "ImportDeclaration")) return false;
  const source = importDeclaration.source;
  return Boolean(source && isNodeOfType(source, "Literal") && source.value === "react");
};

// Returns the "effective React import name" that `symbol` ultimately
// resolves to, OR null if the symbol doesn't trace back to React. The
// returned name is the property/member accessed at the React boundary
// (e.g. `useState` for `import { useState } from "react"`, `useFoo`
// for `React.useFoo`, the namespace name for `import * as React`).
//
// Used by the rule to determine whether a local callee that LOOKS
// like a React hook (matches isReactHookName) actually corresponds
// to a React-exported hook of that exact name. This ensures
// `const use = useState; use()` is treated as a useState call, not
// a "use" call.
const resolveReactImportName = (
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): string | null => {
  if (visitedSymbolIds.has(symbol.id)) return null;
  visitedSymbolIds.add(symbol.id);

  if (symbol.kind === "import") {
    if (!isReactImport(symbol)) return null;
    const declarationNode = symbol.declarationNode;
    if (isNodeOfType(declarationNode, "ImportSpecifier")) {
      const importedName = declarationNode.imported;
      if (isNodeOfType(importedName, "Identifier")) return importedName.name;
    }
    // Default / namespace imports: use the local name as the
    // "React identifier" so callers expecting the namespace can see it.
    return symbol.name;
  }

  const initializer = symbol.initializer;
  if (!initializer) return null;

  // `const x = React.foo` → "foo".
  if (
    isNodeOfType(initializer, "MemberExpression") &&
    isNodeOfType(initializer.object, "Identifier") &&
    initializer.object.name === "React" &&
    isNodeOfType(initializer.property, "Identifier") &&
    !initializer.computed
  ) {
    return initializer.property.name;
  }

  // `const x = require("react")` — namespace alias.
  if (isRequireReactCall(initializer)) {
    return symbol.name;
  }

  // `const x = require("react").foo` → "foo".
  if (
    isNodeOfType(initializer, "MemberExpression") &&
    isRequireReactCall(initializer.object) &&
    isNodeOfType(initializer.property, "Identifier") &&
    !initializer.computed
  ) {
    return initializer.property.name;
  }

  // `const x = otherIdentifier` — chase the alias.
  if (isNodeOfType(initializer, "Identifier")) {
    const aliasSymbol = scopes.symbolFor(initializer);
    if (aliasSymbol) {
      const aliasResolvedName = resolveReactImportName(aliasSymbol, scopes, visitedSymbolIds);
      if (!aliasResolvedName) return null;
      const destructureKey = inferDestructureSourceKey(symbol.bindingIdentifier);
      if (destructureKey !== null) return destructureKey;
      return aliasResolvedName;
    }
  }

  return null;
};

const isRequireReactCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  if (!isNodeOfType(node.callee, "Identifier") || node.callee.name !== "require") return false;
  const firstArgument = node.arguments[0];
  if (!firstArgument || !isNodeOfType(firstArgument as EsTreeNode, "Literal")) return false;
  return (firstArgument as EsTreeNodeOfType<"Literal">).value === "react";
};

// Given a binding-identifier inside an ObjectPattern destructure, find
// the source key (e.g. for `{ use: localName }`, returns "use").
// Returns null when the binding isn't in a destructure or the key
// isn't statically resolvable.
const inferDestructureSourceKey = (bindingIdentifier: EsTreeNode): string | null => {
  let current: EsTreeNode | null | undefined = bindingIdentifier.parent;
  while (current) {
    if (isNodeOfType(current, "Property")) {
      if (!current.computed && isNodeOfType(current.key, "Identifier")) {
        return current.key.name;
      }
      if (isNodeOfType(current.key, "Literal") && typeof current.key.value === "string") {
        return current.key.value;
      }
      return null;
    }
    if (
      isNodeOfType(current, "VariableDeclarator") ||
      isNodeOfType(current, "ArrowFunctionExpression") ||
      isNodeOfType(current, "FunctionExpression") ||
      isNodeOfType(current, "FunctionDeclaration")
    ) {
      // Walked too far — not in an ObjectPattern destructure.
      return null;
    }
    current = current.parent ?? null;
  }
  return null;
};

// React 19's `use(...)` hook is intentionally callable in
// conditionals, loops, and after early returns — it's the rule's
// only recognized exception. We still require it to be inside a
// component / custom hook scope.
const isReactUseHook = (hookName: string): boolean => hookName === "use";

interface FunctionInfo {
  node: EsTreeNode;
  // The name we'd display in error messages. Best-effort: the
  // function's own id, the variable it's assigned to, or "anonymous".
  name: string;
  // True iff `name` was actually inferred (vs the "anonymous"
  // fallback). Used to skip the non-component check on truly
  // anonymous functions — OXC's rule conservatively skips those
  // because a callback's runtime context can't be determined.
  hasResolvedName: boolean;
  isAsync: boolean;
  isComponentOrHook: boolean;
}

const getCallExpressionCalleeName = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
): string | null => {
  const callee = callExpression.callee;
  if (isNodeOfType(callee, "Identifier")) return callee.name;
  if (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "React" &&
    isNodeOfType(callee.property, "Identifier")
  ) {
    return `React.${callee.property.name}`;
  }
  return null;
};

// Best-effort name inference: looks at the function's parent for a
// VariableDeclarator / AssignmentExpression / Property / CallExpression
// that gives the function a usable name.
const inferFunctionName = (functionNode: EsTreeNode): string | null => {
  if (
    (isNodeOfType(functionNode, "FunctionDeclaration") ||
      isNodeOfType(functionNode, "FunctionExpression")) &&
    functionNode.id
  ) {
    return functionNode.id.name;
  }
  let parent: EsTreeNode | null | undefined = functionNode.parent;
  // Skip over wrapper calls like `memo(<fn>)` / `forwardRef(<fn>)` —
  // their named-binding context is one level up. Only standard React
  // HoCs are skipped; arbitrary `hoc(...)` calls are kept as the
  // immediate parent so the function isn't promoted to a component.
  while (parent && isNodeOfType(parent, "CallExpression")) {
    const calleeName = getCallExpressionCalleeName(parent);
    if (calleeName !== null && REACT_HOC_NAMES.has(calleeName)) {
      parent = parent.parent ?? null;
    } else {
      break;
    }
  }
  // Skip transparent wrapper nodes between the function and its
  // naming context: AssignmentPattern (default-value destructure
  // like `{ j = () => {} }`) just forwards to the surrounding
  // Property; TS as / satisfies / non-null / ChainExpression wrap an
  // expression whose containing context names the function.
  while (
    parent &&
    (isNodeOfType(parent, "AssignmentPattern") ||
      parent.type === "TSAsExpression" ||
      parent.type === "TSSatisfiesExpression" ||
      parent.type === "TSNonNullExpression" ||
      parent.type === "ChainExpression")
  ) {
    parent = parent.parent ?? null;
  }
  if (!parent) return null;
  if (isNodeOfType(parent, "VariableDeclarator") && isNodeOfType(parent.id, "Identifier")) {
    return parent.id.name;
  }
  if (isNodeOfType(parent, "AssignmentExpression") && isNodeOfType(parent.left, "Identifier")) {
    return parent.left.name;
  }
  if (
    isNodeOfType(parent, "Property") &&
    !parent.computed &&
    isNodeOfType(parent.key, "Identifier")
  ) {
    return parent.key.name;
  }
  // ExportDefaultDeclaration → return null (treat as anonymous).
  // Upstream's rules-of-hooks deliberately doesn't enforce on
  // default-exported anonymous arrows / functions because the
  // file's caller pattern is unknown — it could be a component, a
  // hook, or a utility. The "anonymous walk-out" logic in the rule
  // handles this conservatively.
  return null;
};

const findEnclosingFunctionInfo = (node: EsTreeNode): FunctionInfo | null => {
  let current: EsTreeNode | null | undefined = node.parent;
  while (current) {
    if (
      isNodeOfType(current, "FunctionDeclaration") ||
      isNodeOfType(current, "FunctionExpression") ||
      isNodeOfType(current, "ArrowFunctionExpression")
    ) {
      const resolvedName = inferFunctionName(current);
      const displayName = resolvedName ?? "anonymous";
      return {
        node: current,
        name: displayName,
        hasResolvedName: resolvedName !== null,
        isAsync: Boolean(current.async),
        isComponentOrHook: resolvedName === null ? false : isReactComponentOrHookName(displayName),
      };
    }
    current = current.parent ?? null;
  }
  return null;
};

const isInsideClassComponent = (node: EsTreeNode): boolean => {
  // Walk all ancestors. If we reach a Class container before any
  // standalone (non-class-method) function boundary, we're inside a
  // class. Functions are class methods iff their parent is a
  // MethodDefinition or PropertyDefinition — those don't terminate
  // the walk.
  let current: EsTreeNode | null | undefined = node.parent;
  while (current) {
    if (isNodeOfType(current, "ClassDeclaration") || isNodeOfType(current, "ClassExpression")) {
      return true;
    }
    if (
      isNodeOfType(current, "FunctionDeclaration") ||
      isNodeOfType(current, "FunctionExpression") ||
      isNodeOfType(current, "ArrowFunctionExpression")
    ) {
      const functionParent = current.parent;
      const isClassMember =
        Boolean(functionParent) &&
        (isNodeOfType(functionParent!, "MethodDefinition") ||
          isNodeOfType(functionParent!, "PropertyDefinition"));
      if (!isClassMember) return false;
    }
    current = current.parent ?? null;
  }
  return false;
};

// True if any AST ancestor between `descendant` (exclusive) and
// `ancestor` (exclusive) is a conditional / short-circuit expression
// whose right-hand side encloses `descendant`.
const hasShortCircuitAncestor = (descendant: EsTreeNode, ancestor: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = descendant.parent;
  while (current && current !== ancestor) {
    if (isNodeOfType(current, "ConditionalExpression")) return true;
    if (
      isNodeOfType(current, "LogicalExpression") &&
      (current.operator === "&&" || current.operator === "||" || current.operator === "??") &&
      isWithinRange(descendant, current.right)
    ) {
      return true;
    }
    current = current.parent ?? null;
  }
  return false;
};

interface NodeWithRange {
  start?: number;
  end?: number;
}

// HACK: walking the AST back from a parent into its own children to
// find which side an expression sits on is awkward. Compare the start
// / end ranges instead — a node is "within" a sibling's range iff its
// span fits inside.
const isWithinRange = (descendant: EsTreeNode, sibling: EsTreeNode): boolean => {
  const descendantSpan = descendant as NodeWithRange;
  const siblingSpan = sibling as NodeWithRange;
  if (
    typeof descendantSpan.start !== "number" ||
    typeof siblingSpan.start !== "number" ||
    typeof siblingSpan.end !== "number"
  ) {
    return false;
  }
  return (
    descendantSpan.start >= siblingSpan.start &&
    (descendantSpan.end ?? siblingSpan.end) <= siblingSpan.end
  );
};

const isInsideTry = (descendant: EsTreeNode, ancestor: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = descendant.parent;
  while (current && current !== ancestor) {
    if (isNodeOfType(current, "TryStatement") || isNodeOfType(current, "CatchClause")) return true;
    current = current.parent ?? null;
  }
  return false;
};

const isInsideLoop = (descendant: EsTreeNode, ancestor: EsTreeNode): boolean => {
  let current: EsTreeNode | null | undefined = descendant.parent;
  while (current && current !== ancestor) {
    if (
      isNodeOfType(current, "ForStatement") ||
      isNodeOfType(current, "ForInStatement") ||
      isNodeOfType(current, "ForOfStatement") ||
      isNodeOfType(current, "WhileStatement") ||
      isNodeOfType(current, "DoWhileStatement")
    ) {
      return true;
    }
    current = current.parent ?? null;
  }
  return false;
};

const isUseEffectEventSymbol = (symbol: SymbolDescriptor): boolean => {
  const initializer = symbol.initializer;
  if (!initializer || !isNodeOfType(initializer, "CallExpression")) return false;
  return getHookNameFromCallee(initializer.callee) === "useEffectEvent";
};

const findEnclosingComponentOrHookFunction = (node: EsTreeNode): EsTreeNode | null => {
  let current: EsTreeNode | null | undefined = node.parent;
  while (current) {
    if (isFunctionLike(current)) {
      const resolvedName = inferFunctionName(current);
      if (resolvedName !== null && isReactComponentOrHookName(resolvedName)) return current;
    }
    current = current.parent ?? null;
  }
  return null;
};

const isSameComponentOrHookScope = (symbol: SymbolDescriptor, referenceNode: EsTreeNode): boolean =>
  findEnclosingComponentOrHookFunction(symbol.declarationNode) ===
  findEnclosingComponentOrHookFunction(referenceNode);

const isAllowedEffectEventHook = (
  hookName: string,
  additionalEffectHooksRegex: RegExp | null,
): boolean =>
  hookName === "useEffectEvent" ||
  EFFECT_HOOK_NAMES.has(hookName) ||
  Boolean(additionalEffectHooksRegex && additionalEffectHooksRegex.test(hookName));

const isCallbackArgumentForAllowedEffectEventHook = (
  functionNode: EsTreeNode,
  additionalEffectHooksRegex: RegExp | null,
): boolean => {
  const parent = functionNode.parent;
  if (!parent || !isNodeOfType(parent, "CallExpression")) return false;
  const hookName = getHookNameFromCallee(parent.callee);
  if (!hookName) return false;
  if (!parent.arguments.some((argument) => argument === functionNode)) return false;
  return isAllowedEffectEventHook(hookName, additionalEffectHooksRegex);
};

const isInsideAllowedEffectEventCallback = (
  node: EsTreeNode,
  additionalEffectHooksRegex: RegExp | null,
): boolean => {
  let current: EsTreeNode | null | undefined = node.parent;
  while (current) {
    if (
      isFunctionLike(current) &&
      isCallbackArgumentForAllowedEffectEventHook(current, additionalEffectHooksRegex)
    ) {
      return true;
    }
    current = current.parent ?? null;
  }
  return false;
};

const isCallCallee = (identifier: EsTreeNode): boolean => {
  const parent = identifier.parent;
  return Boolean(parent && isNodeOfType(parent, "CallExpression") && parent.callee === identifier);
};

const isUseEffectEventInitializer = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  const parent = node.parent;
  return Boolean(
    parent &&
    isNodeOfType(parent, "VariableDeclarator") &&
    parent.init === node &&
    isNodeOfType(parent.id, "Identifier"),
  );
};

// `test-noise` because stories / tests / playground / examples don't
// ship to production and are full of hook-named test helpers
// (`useStorybookMocks`, `useSetupMocks`, `useInsightMocks`) that aren't
// actually React hooks — flagging them as Rules-of-Hooks violations is
// unactionable noise. Real misuse will surface at runtime inside the
// test/story.
export const rulesOfHooks = defineRule<Rule>({
  id: "rules-of-hooks",
  title: "Hook called conditionally",
  severity: "error",
  tags: ["test-noise"],
  recommendation:
    "Call hooks at the top level of a React function component or custom Hook so React sees the same hook order on every render.",
  category: "Correctness",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    const additionalEffectHooksRegex = buildAdditionalEffectHooksRegex(
      settings.additionalEffectHooks,
    );
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const hookContext = isHookCall(node, context.scopes, settings);
        if (!hookContext) return;
        const { hookName } = hookContext;

        if (hookName === "useEffectEvent" && !isUseEffectEventInitializer(node)) {
          context.report({ node: node.callee, message: buildEffectEventPassedDownMessage() });
          return;
        }

        const enclosing = findEnclosingFunctionInfo(node);

        if (!enclosing) {
          context.report({ node: node.callee, message: buildTopLevelMessage(hookName) });
          return;
        }

        if (isInsideClassComponent(node)) {
          context.report({ node: node.callee, message: buildClassComponentMessage(hookName) });
          return;
        }

        if (enclosing.isAsync) {
          context.report({ node: node.callee, message: buildAsyncMessage(hookName) });
          return;
        }

        // The React 19 `use(...)` hook RELAXES the conditional / loop /
        // early-return checks (it's intentionally callable in
        // conditionals) BUT still must be inside a component / custom
        // hook scope and NOT inside try / catch / finally.
        if (isReactUseHook(hookName)) {
          let outerWalker: EsTreeNode | null = enclosing.node;
          let isInsideComponentOrHook = enclosing.isComponentOrHook;
          while (!isInsideComponentOrHook && outerWalker) {
            const parentInfo = findEnclosingFunctionInfo(outerWalker);
            if (!parentInfo) break;
            outerWalker = parentInfo.node;
            if (parentInfo.isComponentOrHook) isInsideComponentOrHook = true;
          }
          if (!isInsideComponentOrHook) {
            context.report({
              node: node.callee,
              message: buildNonComponentMessage(hookName, enclosing.name),
            });
            return;
          }
          if (isInsideTry(node, enclosing.node)) {
            context.report({ node: node.callee, message: buildTryMessage(hookName) });
          }
          return;
        }

        // For anonymous callbacks, look outward: if any enclosing
        // function IS a component / custom hook, this nested anonymous
        // callback can't legally call a hook (Rule of Hooks forbids
        // hooks in nested callbacks even when the outer function is a
        // component). When NO outer function is a component / hook, the
        // callback's runtime context is unknown — skip to avoid false
        // positives on generic callbacks (utility / event-handler
        // factories).
        if (!enclosing.hasResolvedName) {
          let outerWalker: EsTreeNode | null = enclosing.node;
          let outerIsComponentOrHook = false;
          while (outerWalker) {
            const outerInfo = findEnclosingFunctionInfo(outerWalker);
            if (!outerInfo) break;
            if (outerInfo.isComponentOrHook) {
              outerIsComponentOrHook = true;
              break;
            }
            outerWalker = outerInfo.node;
          }
          if (!outerIsComponentOrHook) return;
          context.report({ node: node.callee, message: buildConditionalMessage(hookName) });
          return;
        }

        if (!enclosing.isComponentOrHook) {
          context.report({
            node: node.callee,
            message: buildNonComponentMessage(hookName, enclosing.name),
          });
          return;
        }

        if (isInsideLoop(node, enclosing.node)) {
          context.report({ node: node.callee, message: buildLoopMessage(hookName) });
          return;
        }

        if (isInsideTry(node, enclosing.node)) {
          context.report({ node: node.callee, message: buildTryMessage(hookName) });
          return;
        }

        if (hasShortCircuitAncestor(node, enclosing.node)) {
          context.report({ node: node.callee, message: buildConditionalMessage(hookName) });
          return;
        }

        // CFG-based check: catches early-return patterns and
        // if-statement bodies.
        if (!context.cfg.isUnconditionalFromEntry(node)) {
          context.report({ node: node.callee, message: buildConditionalMessage(hookName) });
        }
      },

      Identifier(node: EsTreeNodeOfType<"Identifier">) {
        const reference = context.scopes.referenceFor(node);
        const symbol = reference?.resolvedSymbol;
        if (!symbol || !isUseEffectEventSymbol(symbol)) return;
        if (!isSameComponentOrHookScope(symbol, node)) return;
        if (isInsideAllowedEffectEventCallback(node, additionalEffectHooksRegex)) return;

        context.report({
          node,
          message: isCallCallee(node)
            ? buildEffectEventCallMessage(symbol.name)
            : buildEffectEventAssignmentMessage(symbol.name),
        });
      },
    };
  },
});
