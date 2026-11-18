import { isCheapPrimitiveValue } from "../../utils/is-cheap-primitive-value.js";
import { BUILTIN_HOOK_NAMES, TRIVIAL_INITIALIZER_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { getValueImportSource } from "../../utils/get-value-import-declaration.js";
import { hasPossibleStaticPropertyMutationOrEscape } from "../../utils/has-static-property-write-before.js";
import { isReactNamespaceImport } from "../../utils/is-react-api-call.js";
import { isReactHookCall } from "../../utils/is-react-hook-call.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import { isSymbolReadOnly } from "../../utils/is-symbol-read-only.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";

// Zero-argument native Date getters (`now.getMonth()`, `Date.now()`) cost
// nanoseconds — lazy-wrapping them is pure noise, and the rule's purpose is
// expensive initializers (JSON.parse, large array builds).
const TRIVIAL_DATE_GETTER_NAMES: ReadonlySet<string> = new Set([
  "now",
  "getTime",
  "getFullYear",
  "getMonth",
  "getDate",
  "getDay",
  "getHours",
  "getMinutes",
  "getSeconds",
  "getMilliseconds",
  "getTimezoneOffset",
  "getUTCFullYear",
  "getUTCMonth",
  "getUTCDate",
  "getUTCDay",
  "getUTCHours",
  "getUTCMinutes",
  "getUTCSeconds",
  "getUTCMilliseconds",
  "valueOf",
]);

const EAGER_CALL_RESOLUTION_DEPTH_LIMIT = 4;

// The call (or constructor) that runs eagerly on EVERY render inside a
// `useState(...)` argument. Beyond a bare `expensiveFn()`, wrapper
// shapes still evaluate the call unconditionally each render:
//   - `expensiveFn(raw) ?? []` / `expensiveFn(raw) || []` — the left of
//     a logical expression always evaluates;
//   - `[...expensiveFn(raw)]` — a spread eagerly iterates the call;
//   - `computeLayout(width).sections` — the member read forces the call.
// Right-hand logical operands and plain array elements are left alone:
// the former is conditionally evaluated, the latter overlaps common
// cheap `useState([value])` literals.
const findEagerInitializerCall = (
  expression: EsTreeNode,
  depth = 0,
): EsTreeNodeOfType<"CallExpression"> | null => {
  if (depth > EAGER_CALL_RESOLUTION_DEPTH_LIMIT) return null;
  // TS wrappers (`makeRows(raw) as Rows`, `buildModel(config)!`) and
  // optional chains are transparent — the call still runs every render.
  const innerExpression = stripParenExpression(expression);
  if (isNodeOfType(innerExpression, "CallExpression")) return innerExpression;
  if (isNodeOfType(innerExpression, "NewExpression")) return null;
  if (isNodeOfType(innerExpression, "LogicalExpression")) {
    return findEagerInitializerCall(innerExpression.left as EsTreeNode, depth + 1);
  }
  if (isNodeOfType(innerExpression, "MemberExpression")) {
    return findEagerInitializerCall(innerExpression.object as EsTreeNode, depth + 1);
  }
  if (isNodeOfType(innerExpression, "ArrayExpression")) {
    for (const element of innerExpression.elements ?? []) {
      if (!element || !isNodeOfType(element, "SpreadElement")) continue;
      const spreadCall = findEagerInitializerCall(element.argument as EsTreeNode, depth + 1);
      if (spreadCall) return spreadCall;
    }
  }
  return null;
};

const ALTERNATE_REACT_PROVIDER_GLOBALS: ReadonlySet<string> = new Set([
  "require",
  "module",
  "process",
  "React",
  "eval",
  "Function",
  "global",
  "globalThis",
  "self",
  "window",
]);

const hasAlternativeReactProvider = (program: EsTreeNode, context: RuleContext): boolean => {
  let hasAlternative = false;
  walkAst(program, (node) => {
    if (hasAlternative) return false;
    if (isNodeOfType(node, "Identifier")) {
      hasAlternative =
        ALTERNATE_REACT_PROVIDER_GLOBALS.has(node.name) && context.scopes.isGlobalReference(node);
    } else if (isNodeOfType(node, "ImportDeclaration")) {
      hasAlternative = node.source.value === "module" || node.source.value === "node:module";
    } else if (
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "TSExternalModuleReference")
    ) {
      const source = isNodeOfType(node, "ImportExpression") ? node.source : node.expression;
      hasAlternative = !isNodeOfType(source, "Literal") || source.value === "react";
    }
  });
  return hasAlternative;
};

const closedUseContextProviderByProgram = new WeakMap<EsTreeNode, boolean>();

const hasClosedUseContextProvider = (context: RuleContext): boolean => {
  const { node: program, symbols } = context.scopes.rootScope;
  const cached = closedUseContextProviderByProgram.get(program);
  if (cached !== undefined) return cached;
  const hasOpenNamespace = symbols.some((symbol) => {
    if (getValueImportSource(symbol) !== "react") return false;
    if (
      isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
      getImportedName(symbol.declarationNode) === "module.exports"
    ) {
      return true;
    }
    return (
      isReactNamespaceImport(symbol.bindingIdentifier, context.scopes) &&
      (!isSymbolReadOnly(symbol) ||
        hasPossibleStaticPropertyMutationOrEscape(
          symbol.bindingIdentifier,
          "useContext",
          context.scopes,
        ) ||
        symbol.references.some(({ identifier }) => {
          // A dynamic read or .default can expose a second handle to the CJS React object.
          const reference = findTransparentExpressionRoot(identifier);
          const member = reference.parent;
          if (!isNodeOfType(member, "MemberExpression") || member.object !== reference) return true;
          const propertyName = getStaticPropertyName(member);
          return propertyName === null || propertyName === "default";
        }))
    );
  });
  const isClosed = !hasOpenNamespace && !hasAlternativeReactProvider(program, context);
  closedUseContextProviderByProgram.set(program, isClosed);
  return isClosed;
};

export const rerenderLazyStateInit = defineRule({
  diffScope: "function",
  id: "rerender-lazy-state-init",
  title: "State initializer runs on every render",
  tags: ["test-noise"],
  severity: "warn",
  category: "Performance",
  recommendation:
    "Wrap expensive initial state in an arrow function so the initializer does not rerun and get thrown away on every render.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isReactHookCall(node, "useState", context.scopes) || !node.arguments?.length) return;
      const initializer = findEagerInitializerCall(node.arguments[0] as EsTreeNode);
      if (!initializer) return;

      const callee = initializer.callee;
      const memberPropertyName =
        isNodeOfType(callee, "MemberExpression") &&
        (isNodeOfType(callee.property, "Identifier") ||
          isNodeOfType(callee.property, "PrivateIdentifier"))
          ? callee.property.name
          : null;
      const calleeIsIdentifier = isNodeOfType(callee, "Identifier");
      const calleeName = calleeIsIdentifier ? callee.name : (memberPropertyName ?? "fn");

      if (TRIVIAL_INITIALIZER_NAMES.has(calleeName)) return;
      if (
        isNodeOfType(callee, "MemberExpression") &&
        !callee.computed &&
        memberPropertyName === "toString" &&
        initializer.arguments.length === 0 &&
        isCheapPrimitiveValue(callee.object, context.scopes, EAGER_CALL_RESOLUTION_DEPTH_LIMIT)
      )
        return;
      if (
        memberPropertyName &&
        (initializer.arguments ?? []).length === 0 &&
        TRIVIAL_DATE_GETTER_NAMES.has(memberPropertyName)
      ) {
        return;
      }

      // `useState(useContext(Ctx))` / `useState(React.useContext(Ctx))` /
      // `useState(useLocalStorageDefault(...))` captures another hook's value.
      // Wrapping it in a lazy initializer (`useState(() => useContext(Ctx))`)
      // would call a hook conditionally — an illegal rules-of-hooks violation.
      // Skip hook-shaped callees (identifier or member form), matching the
      // sibling `rerender-lazy-ref-init`.
      if (isReactHookName(calleeName)) return;
      if (calleeIsIdentifier) {
        const symbol = context.scopes.symbolFor(callee);
        if (
          symbol &&
          isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
          getValueImportSource(symbol) === "react" &&
          isSymbolReadOnly(symbol)
        ) {
          const hookName = getImportedName(symbol.declarationNode);
          if (
            hookName &&
            BUILTIN_HOOK_NAMES.has(hookName) &&
            (!initializer.optional ||
              (hookName === "useContext" && hasClosedUseContextProvider(context))) &&
            !context.scopes.rootScope.symbols.some(
              (candidate) =>
                isReactNamespaceImport(candidate.bindingIdentifier, context.scopes) &&
                hasPossibleStaticPropertyMutationOrEscape(
                  candidate.bindingIdentifier,
                  hookName,
                  context.scopes,
                ),
            )
          )
            return;
        }
      }

      if (
        !initializer.optional &&
        isNodeOfType(callee, "MemberExpression") &&
        callee.computed &&
        !callee.optional &&
        isNodeOfType(callee.property, "Literal") &&
        callee.property.value === "useContext" &&
        isNodeOfType(callee.object, "Identifier")
      ) {
        const symbol = context.scopes.symbolFor(callee.object);
        if (
          symbol &&
          (isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") ||
            isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier")) &&
          getValueImportSource(symbol) === "react" &&
          hasClosedUseContextProvider(context)
        ) {
          return;
        }
      }

      const callDescription = `${calleeName}()`;
      context.report({
        node: initializer,
        message: `useState(${callDescription}) re-runs ${callDescription} on every render & throws the result away.`,
      });
    },
  }),
});
