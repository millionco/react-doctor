import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactComponentOrHookName } from "../../utils/is-react-component-or-hook-name.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import {
  REACT_ECOSYSTEM_PACKAGE_NAMES,
  REACT_HOC_NAMES,
  REACT_RUNTIME_MODULE_SOURCES,
} from "../../constants/react.js";
import {
  getImportBindingForName,
  getImportSourceForName,
} from "../../utils/find-import-source-for-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNonReactEffectEventCallee } from "../../utils/is-non-react-effect-event-callee.js";
import { isNodeConditionallyExecuted } from "../../utils/is-node-conditionally-executed.js";
import { symbolHasReactUseEffectEventOrigin } from "../../utils/symbol-has-react-use-effect-event-origin.js";
import { isReactHocCallbackArgument } from "../../utils/is-react-hoc-callback-argument.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { getDestructuredBindingPropertyName } from "../../utils/get-destructured-binding-property-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import {
  hasPossibleStaticPropertyMutationOrEscape,
  hasPossibleStaticPropertyWriteBefore,
} from "../../utils/has-static-property-write-before.js";
import { hasSymbolWriteBefore } from "../../utils/has-symbol-write-before.js";
import { isReactNamespaceImport } from "../../utils/is-react-api-call.js";
import { resolveImportedApiReference } from "../../utils/resolve-imported-api-reference.js";
import { statementAlwaysExits } from "../../utils/statement-always-exits.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { isRulesOfHooksSuppressedAt } from "./rules-of-hooks-suppression.js";

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

// `_Calendar` / `__Menu` — the "private component exported under a public
// alias" convention (`const _Calendar = ...; export { _Calendar as Calendar }`)
// is a real component whose name just fails the PascalCase first-letter check.
// Underscore-prefixed HOOK names (`_useNotAHook`) deliberately do NOT qualify:
// upstream treats them as non-hooks and so do we. The relaxation only applies
// to functions that own their name DIRECTLY (declaration id / variable
// binding) — a callback argument inheriting the binding's name through a
// wrapper call (`memo(render, comparator)` naming the comparator
// `_Memoized`) is not the component itself.
const UNDERSCORE_PREFIXED_COMPONENT_NAME_PATTERN = /^_+[A-Z]/;

const isComponentOrHookDisplayName = (name: string, functionNode: EsTreeNode): boolean => {
  if (isReactComponentOrHookName(name)) return true;
  if (!UNDERSCORE_PREFIXED_COMPONENT_NAME_PATTERN.test(name)) return false;
  return !isNodeOfType(functionNode.parent, "CallExpression");
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
    const callObject = stripParenExpression(callee.object);
    const propertyName = callee.property.name;
    if (isPackageImportedNonReactHookMemberCallee(call, scopes)) return null;
    // Upstream's heuristic: a use-prefixed member call IS a hook iff
    // the object reads like a "namespace" — PascalCase identifier
    // (`Hook` / `This` / `Super` / `React` / `FooStore` / `Namespace`)
    // or a call-expression result (chained usage). Lowercase-starting
    // identifiers (`jest.useFakeTimers`, `lodash.useFoo`) and the
    // class-method `this` / `super` keywords are NOT hooks.
    if (isNodeOfType(callObject, "Identifier")) {
      if (settings.allowedPascalCaseHookNamespaces.includes(callObject.name)) return null;
      if (!isPascalCaseIdentifier(callObject)) return null;
      // `X.use([plugins])` is the plugin-registration idiom
      // (`SwiperCore.use([Navigation, Pagination])`) — `.use` is the
      // ecosystem's registration verb, and React 19's `use(...)` never
      // takes an array literal (it takes a promise or a context). Bare
      // `Hook.use()` stays a hook to match upstream's fixtures.
      if (
        propertyName === "use" &&
        callObject.name !== "React" &&
        isNodeOfType(call.arguments[0], "ArrayExpression")
      ) {
        return null;
      }
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

const isReactHookCapabilityValue = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const unwrappedExpression = stripParenExpression(expression);
  if (isNodeOfType(unwrappedExpression, "Identifier")) {
    const symbol = scopes.symbolFor(unwrappedExpression);
    if (!symbol || visitedSymbolIds.has(symbol.id)) return false;
    visitedSymbolIds.add(symbol.id);
    if (symbol.kind === "import") {
      return (
        isReactImport(symbol) && isReactHookName(getImportedName(symbol.declarationNode) ?? "")
      );
    }
    if (
      symbol.kind !== "const" ||
      !symbol.initializer ||
      !isNodeOfType(symbol.declarationNode, "VariableDeclarator")
    ) {
      return false;
    }
    const destructuredPropertyName = getDestructuredBindingPropertyName(symbol.bindingIdentifier);
    if (destructuredPropertyName) {
      const namespaceExpression = stripParenExpression(symbol.initializer);
      return (
        isReactHookName(destructuredPropertyName) &&
        isNodeOfType(namespaceExpression, "Identifier") &&
        isReactNamespaceImport(namespaceExpression, scopes) &&
        !hasPossibleStaticPropertyMutationOrEscape(
          namespaceExpression,
          destructuredPropertyName,
          scopes,
        )
      );
    }
    if (symbol.declarationNode.id !== symbol.bindingIdentifier) return false;
    return isReactHookCapabilityValue(symbol.initializer, scopes, visitedSymbolIds);
  }
  if (!isNodeOfType(unwrappedExpression, "MemberExpression")) return false;
  const propertyName = getStaticPropertyName(unwrappedExpression);
  if (!propertyName || !isReactHookName(propertyName)) return false;
  const namespaceExpression = stripParenExpression(unwrappedExpression.object);
  return (
    isNodeOfType(namespaceExpression, "Identifier") &&
    isReactNamespaceImport(namespaceExpression, scopes) &&
    !hasPossibleStaticPropertyMutationOrEscape(namespaceExpression, propertyName, scopes)
  );
};

const isReactHookCapabilityComparisonOperand = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const unwrappedExpression = stripParenExpression(expression);
  if (isReactHookCapabilityValue(unwrappedExpression, scopes)) return true;
  return (
    isNodeOfType(unwrappedExpression, "UnaryExpression") &&
    unwrappedExpression.operator === "typeof" &&
    isReactHookCapabilityValue(unwrappedExpression.argument, scopes)
  );
};

const isStaticCapabilityComparisonValue = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const unwrappedExpression = stripParenExpression(expression);
  if (isNodeOfType(unwrappedExpression, "Literal")) return true;
  return (
    isNodeOfType(unwrappedExpression, "Identifier") &&
    unwrappedExpression.name === "undefined" &&
    scopes.isGlobalReference(unwrappedExpression)
  );
};

const CAPABILITY_COMPARISON_OPERATORS: ReadonlySet<string> = new Set(["==", "!=", "===", "!=="]);

const isInvariantReactHookCapabilityCondition = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const unwrappedExpression = stripParenExpression(expression);
  if (isReactHookCapabilityValue(unwrappedExpression, scopes)) return true;
  if (
    isNodeOfType(unwrappedExpression, "UnaryExpression") &&
    unwrappedExpression.operator === "!"
  ) {
    return isInvariantReactHookCapabilityCondition(unwrappedExpression.argument, scopes);
  }
  if (isNodeOfType(unwrappedExpression, "LogicalExpression")) {
    return (
      isInvariantReactHookCapabilityCondition(unwrappedExpression.left, scopes) &&
      isInvariantReactHookCapabilityCondition(unwrappedExpression.right, scopes)
    );
  }
  if (
    !isNodeOfType(unwrappedExpression, "BinaryExpression") ||
    !CAPABILITY_COMPARISON_OPERATORS.has(unwrappedExpression.operator)
  ) {
    return false;
  }
  return (
    (isReactHookCapabilityComparisonOperand(unwrappedExpression.left, scopes) &&
      isStaticCapabilityComparisonValue(unwrappedExpression.right, scopes)) ||
    (isReactHookCapabilityComparisonOperand(unwrappedExpression.right, scopes) &&
      isStaticCapabilityComparisonValue(unwrappedExpression.left, scopes))
  );
};

const statementContainsOwnAbruptCompletion = (statement: EsTreeNode): boolean => {
  let doesContainAbruptCompletion = false;
  walkAst(statement, (child) => {
    if (child !== statement && isFunctionLike(child)) return false;
    if (isNodeOfType(child, "ReturnStatement") || isNodeOfType(child, "ThrowStatement")) {
      doesContainAbruptCompletion = true;
      return false;
    }
  });
  return doesContainAbruptCompletion;
};

const isInvariantReactHookCapabilityExit = (
  statement: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean =>
  isNodeOfType(statement, "IfStatement") &&
  statement.alternate === null &&
  statementAlwaysExits(statement.consequent) &&
  isInvariantReactHookCapabilityCondition(statement.test, scopes);

const isAfterOnlyInvariantReactHookCapabilityExits = (
  node: EsTreeNode,
  enclosingFunction: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isFunctionLike(enclosingFunction) ||
    !isNodeOfType(enclosingFunction.body, "BlockStatement")
  ) {
    return false;
  }
  let containingStatement = node;
  while (containingStatement.parent && containingStatement.parent !== enclosingFunction.body) {
    if (isFunctionLike(containingStatement.parent)) return false;
    if (
      isNodeOfType(containingStatement.parent, "IfStatement") ||
      isNodeOfType(containingStatement.parent, "SwitchStatement") ||
      isNodeOfType(containingStatement.parent, "SwitchCase") ||
      isNodeOfType(containingStatement.parent, "ConditionalExpression") ||
      isNodeOfType(containingStatement.parent, "LogicalExpression")
    ) {
      return false;
    }
    containingStatement = containingStatement.parent;
  }
  if (containingStatement.parent !== enclosingFunction.body) return false;
  const statementIndex = enclosingFunction.body.body.findIndex(
    (statement) => statement === containingStatement,
  );
  if (statementIndex <= 0) return false;
  const bypassingStatements = enclosingFunction.body.body
    .slice(0, statementIndex)
    .filter((statement) => statementContainsOwnAbruptCompletion(statement));
  return (
    bypassingStatements.length > 0 &&
    bypassingStatements.every((statement) => isInvariantReactHookCapabilityExit(statement, scopes))
  );
};

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

// Number of recognized hook calls living DIRECTLY in `functionNode`'s
// own scope (nested functions pruned). A function whose body issues
// several hook calls is — structurally — a render scope (a custom
// hook / context-factory body), even when its name doesn't follow the
// `useXxx` / PascalCase convention. The Solid→React port names these
// `init` / `create*`, which the name gate alone misclassifies.
// `countedFunctionNodes` guards the mutual recursion with
// `isLocalNonHookFunctionCallee`: a use*-named call that resolves to a
// LOCAL non-hook function is excluded from reporting, so it must not
// count toward the render-scope threshold either — otherwise a
// `create*` factory with one real hook plus one local `useKeyword(...)`
// helper call would wrongly qualify as a render scope and exempt the
// real hook.
const countOwnScopeHookCalls = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
  settings: Required<RulesOfHooksSettings>,
  countedFunctionNodes: Set<EsTreeNode> = new Set(),
): number => {
  if (countedFunctionNodes.has(functionNode)) return 0;
  countedFunctionNodes.add(functionNode);
  let count = 0;
  walkAst(functionNode, (child) => {
    if (child === functionNode) return;
    if (isFunctionLike(child)) return false;
    if (!isHookCall(child, scopes, settings)) return;
    if (
      isNodeOfType(child, "CallExpression") &&
      isLocalNonHookFunctionCallee(child, scopes, settings, countedFunctionNodes)
    ) {
      return;
    }
    count += 1;
  });
  return count;
};

const MIN_HOOK_CALLS_FOR_RENDER_SCOPE = 2;

// Factory-shaped names the render-scope escape is allowed to cover:
// `init` (exact or `initFileContext`-style prefix), `create*`, `make*`,
// `build*`, optionally underscore-prefixed. An arbitrary helper name
// (`handleClick`, `fetchData`) must NOT qualify — otherwise any
// module function with two copy-pasted hooks becomes exempt.
const RENDER_SCOPE_FACTORY_NAME_PATTERN = /^_?(?:init|create|make|build)(?:[A-Z0-9_]|$)/;
const HOOK_NAMESPACE_NAME_PATTERN = /Hooks?$/;

// A use-prefixed callee that scope analysis resolves to a LOCAL
// function whose own body issues zero hook calls is not a React hook
// (e.g. ajv's `useKeyword` codegen helper) — reporting its caller as
// a broken render scope is noise. Only consulted on the
// non-component report paths; conditional / loop checks are
// unaffected.
const isLocalNonHookFunctionCallee = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
  settings: Required<RulesOfHooksSettings>,
  countedFunctionNodes?: Set<EsTreeNode>,
): boolean => {
  const callee = call.callee;
  if (!isNodeOfType(callee, "Identifier")) return false;
  const symbol = scopes.symbolFor(callee);
  if (!symbol) return false;
  const localFunction =
    symbol.initializer && isFunctionLike(symbol.initializer) ? symbol.initializer : null;
  if (!localFunction) return false;
  return countOwnScopeHookCalls(localFunction, scopes, settings, countedFunctionNodes) === 0;
};

// Path-alias prefixes (`@/`, `~/`) resolve to project-local files, which
// are as likely to hold genuine React hooks as relative imports are.
const PATH_ALIAS_IMPORT_PATTERN = /^[@~]\//;

// Bare package name of an import specifier: `@tanstack/react-query/foo`
// → `@tanstack/react-query`, `next/navigation` → `next`.
const getPackageNameFromImportSource = (importSource: string): string => {
  const pathSegments = importSource.split("/");
  return importSource.startsWith("@")
    ? pathSegments.slice(0, 2).join("/")
    : (pathSegments[0] ?? importSource);
};

// A use* export from one of these sources is a REAL React hook the rule
// must keep enforcing: the React runtimes themselves, anything whose
// specifier carries "react" (react-redux, @tanstack/react-query,
// react-hook-form, react-router, preact), or a known React-ecosystem
// package that doesn't self-identify by name (next, swr, zustand, …).
const isReactEcosystemImportSource = (importSource: string): boolean =>
  REACT_RUNTIME_MODULE_SOURCES.has(importSource) ||
  importSource.toLowerCase().includes("react") ||
  REACT_ECOSYSTEM_PACKAGE_NAMES.has(getPackageNameFromImportSource(importSource));

// A use*-named function imported from a third-party PACKAGE that is not
// React-ecosystem — WebdriverIO's `useBrowser` from
// `@cloudscape-design/browser-test-tools/use-browser`, DI/middleware
// helpers, codegen utilities. These follow the use* naming convention
// without being React hooks, so "called outside a component" reports on
// them are noise. Relative / path-alias imports stay eligible — a
// project's own `./useFoo` is usually a real hook — and so do imports
// from React-ecosystem packages (`useSelector` from react-redux at
// module top level is a genuine Rules-of-Hooks violation).
const isPackageImportedNonReactHookCallee = (call: EsTreeNodeOfType<"CallExpression">): boolean => {
  const callee = call.callee;
  if (!isNodeOfType(callee, "Identifier")) return false;
  const importSource = getImportSourceForName(call, callee.name);
  if (importSource === null) return false;
  if (importSource.startsWith(".")) return false;
  if (PATH_ALIAS_IMPORT_PATTERN.test(importSource)) return false;
  return !isReactEcosystemImportSource(importSource);
};

const isPackageImportedNonReactHookMemberCallee = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const callee = call.callee;
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const propertyName = getStaticPropertyName(callee);
  if (!propertyName || !isReactHookName(propertyName)) return false;
  const receiver = stripParenExpression(callee.object);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const receiverSymbol = scopes.symbolFor(receiver);
  if (!receiverSymbol || hasSymbolWriteBefore(receiverSymbol, call, scopes)) return false;
  if (hasPossibleStaticPropertyWriteBefore(receiver, propertyName, call, scopes)) return false;
  const importedReceiver = resolveImportedApiReference(receiver, scopes);
  if (!importedReceiver) return false;
  if (importedReceiver.source.startsWith(".")) return false;
  if (PATH_ALIAS_IMPORT_PATTERN.test(importedReceiver.source)) return false;
  return !isReactEcosystemImportSource(importedReceiver.source);
};

const isDefaultImportedClassApiMemberCallee = (
  call: EsTreeNodeOfType<"CallExpression">,
): boolean => {
  const callee = call.callee;
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  if (!isNodeOfType(callee.object, "Identifier")) return false;
  if (HOOK_NAMESPACE_NAME_PATTERN.test(callee.object.name)) return false;
  const importBinding = getImportBindingForName(call, callee.object.name);
  if (!importBinding || importBinding.exportedName !== "default") return false;
  return !REACT_RUNTIME_MODULE_SOURCES.has(importBinding.source);
};

// `useMDXComponents` is the MDX/Next.js convention name for a
// components-map getter (`mdx-components.tsx`): when the project owns it
// (relative or path-alias import), it is a plain function that merely
// borrows the `use` prefix — Next.js documents calling it from async
// Server Components. Imports from React-ecosystem packages (e.g.
// @mdx-js/react, whose implementation calls useContext) keep firing.
const isProjectOwnedMdxComponentsGetter = (call: EsTreeNodeOfType<"CallExpression">): boolean => {
  const callee = call.callee;
  if (!isNodeOfType(callee, "Identifier") || callee.name !== "useMDXComponents") return false;
  const importSource = getImportSourceForName(call, callee.name);
  if (importSource === null) return false;
  return importSource.startsWith(".") || PATH_ALIAS_IMPORT_PATTERN.test(importSource);
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
        isComponentOrHook:
          isReactHocCallbackArgument(current) ||
          (resolvedName === null ? false : isComponentOrHookDisplayName(displayName, current)),
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

const findEnclosingComponentOrHookFunction = (node: EsTreeNode): EsTreeNode | null => {
  let current: EsTreeNode | null | undefined = node.parent;
  while (current) {
    if (isFunctionLike(current)) {
      if (isReactHocCallbackArgument(current)) return current;
      const resolvedName = inferFunctionName(current);
      if (resolvedName !== null && isComponentOrHookDisplayName(resolvedName, current)) {
        return current;
      }
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
export const rulesOfHooks = defineRule({
  id: "rules-of-hooks",
  title: "Hook called conditionally",
  severity: "error",
  tags: ["test-noise"],
  recommendation:
    "Call hooks at the top level of a React function component or custom Hook so React sees the same hook order on every render.",
  category: "Correctness",
  create: (hostContext) => {
    const nodeStartOffset = (node: EsTreeNode): number | null => {
      const nodeWithOffsets = node as { start?: number; range?: [number, number] };
      if (typeof nodeWithOffsets.start === "number") return nodeWithOffsets.start;
      if (Array.isArray(nodeWithOffsets.range)) return nodeWithOffsets.range[0];
      return null;
    };
    const context: typeof hostContext = {
      get filename() {
        return hostContext.filename;
      },
      get settings() {
        return hostContext.settings;
      },
      get scopes() {
        return hostContext.scopes;
      },
      get cfg() {
        return hostContext.cfg;
      },
      report: (descriptor) => {
        if (isRulesOfHooksSuppressedAt(hostContext.filename, nodeStartOffset(descriptor.node))) {
          return;
        }
        hostContext.report(descriptor);
      },
    };
    const settings = resolveSettings(context.settings);
    const additionalEffectHooksRegex = buildAdditionalEffectHooksRegex(
      settings.additionalEffectHooks,
    );
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const hookContext = isHookCall(node, context.scopes, settings);
        if (!hookContext) return;
        const { hookName } = hookContext;

        if (
          hookName === "useEffectEvent" &&
          !isUseEffectEventInitializer(node) &&
          !isNonReactEffectEventCallee(node.callee, node, context.scopes)
        ) {
          context.report({ node: node.callee, message: buildEffectEventPassedDownMessage() });
          return;
        }

        // A use*-named callee that resolves to a LOCAL function whose body
        // issues zero hook calls is not a React hook at all (`usePlugin`
        // async apply helpers, `usePromptExample` event handlers) — none of
        // the ordering rules apply to it.
        if (isLocalNonHookFunctionCallee(node, context.scopes, settings)) return;

        if (isProjectOwnedMdxComponentsGetter(node)) return;

        const enclosing = findEnclosingFunctionInfo(node);

        if (!enclosing) {
          if (isPackageImportedNonReactHookCallee(node)) return;
          context.report({ node: node.callee, message: buildTopLevelMessage(hookName) });
          return;
        }

        if (isInsideClassComponent(node)) {
          if (
            isPackageImportedNonReactHookCallee(node) ||
            isDefaultImportedClassApiMemberCallee(node)
          ) {
            return;
          }
          context.report({ node: node.callee, message: buildClassComponentMessage(hookName) });
          return;
        }

        if (enclosing.isAsync) {
          context.report({ node: node.callee, message: buildAsyncMessage(hookName) });
          return;
        }

        // Structural render-scope escape: a factory-named function
        // (`init` / `create*` / `make*` / `build*` — the Solid→React
        // port shapes) whose own scope issues several hook calls is
        // treated as a custom hook / factory body even though its name
        // violates the `useXxx` / PascalCase convention. It must NOT
        // sit inside a component / hook (hooks in a function nested
        // inside a component are never legal), and it still runs the
        // conditional / loop / try checks below, so misplaced hooks
        // inside it are caught.
        const isLikelyRenderScope =
          !enclosing.isComponentOrHook &&
          enclosing.hasResolvedName &&
          RENDER_SCOPE_FACTORY_NAME_PATTERN.test(enclosing.name) &&
          findEnclosingComponentOrHookFunction(enclosing.node) === null &&
          countOwnScopeHookCalls(enclosing.node, context.scopes, settings) >=
            MIN_HOOK_CALLS_FOR_RENDER_SCOPE;

        // The React 19 `use(...)` hook RELAXES the conditional / loop /
        // early-return checks (it's intentionally callable in
        // conditionals) BUT still must be inside a component / custom
        // hook scope — the render-scope escape counts as one — and NOT
        // inside try / catch / finally.
        if (isReactUseHook(hookName)) {
          let outerWalker: EsTreeNode | null = enclosing.node;
          let isInsideComponentOrHook = enclosing.isComponentOrHook || isLikelyRenderScope;
          while (!isInsideComponentOrHook && outerWalker) {
            const parentInfo = findEnclosingFunctionInfo(outerWalker);
            if (!parentInfo) break;
            outerWalker = parentInfo.node;
            if (parentInfo.isComponentOrHook) isInsideComponentOrHook = true;
          }
          if (!isInsideComponentOrHook) {
            if (!enclosing.hasResolvedName) return;
            if (isPackageImportedNonReactHookCallee(node)) return;
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

        if (!enclosing.isComponentOrHook && !isLikelyRenderScope) {
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

          if (isPackageImportedNonReactHookCallee(node)) return;
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

        if (isNodeConditionallyExecuted(node, enclosing.node)) {
          context.report({ node: node.callee, message: buildConditionalMessage(hookName) });
          return;
        }

        // CFG-based check: catches early-return patterns and
        // if-statement bodies.
        if (
          !context.cfg.isUnconditionalFromEntry(node) &&
          !isAfterOnlyInvariantReactHookCapabilityExits(node, enclosing.node, context.scopes)
        ) {
          context.report({ node: node.callee, message: buildConditionalMessage(hookName) });
        }
      },

      Identifier(node: EsTreeNodeOfType<"Identifier">) {
        const reference = context.scopes.referenceFor(node);
        const symbol = reference?.resolvedSymbol;
        if (!symbol || !symbolHasReactUseEffectEventOrigin(symbol, context.scopes)) return;
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
