import { BUILTIN_GLOBAL_NAMESPACE_NAMES } from "../../constants/js.js";
import { EFFECT_HOOK_NAMES, TRIVIAL_DERIVATION_CALLEE_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { getCallbackStatements } from "../../utils/get-callback-statements.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { getRootIdentifierName } from "../../utils/get-root-identifier-name.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isSetterCall } from "../../utils/is-setter-call.js";
import { isSetterIdentifier } from "../../utils/is-setter-identifier.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// HACK: AST-aware walker for "what reactive values does this expression
// actually READ?". The plain `walkAst` adds every Identifier it sees,
// which over-counts in two ways:
//   - the CALLEE of a CallExpression (`getFilteredTodos(...)`) is a
//     function reference, almost always module-scoped and stable —
//     React's exhaustive-deps lint correctly omits these from deps.
//   - the PROPERTY of a non-computed MemberExpression (`obj.foo`) is
//     a static identifier, not a separate reactive read; only `obj`
//     is the reactive value.
// Without this, `setX(getFilteredTodos(todos, filter))` would treat
// `getFilteredTodos` as a missing dep and bail before the §2 "expensive
// derivation" branch could fire.
const collectValueIdentifierNames = (node: EsTreeNode | null | undefined, into: string[]): void => {
  if (!node || typeof node !== "object") return;
  if (isNodeOfType(node, "CallExpression")) {
    if (isNodeOfType(node.callee, "MemberExpression")) {
      // For `state.method(arg)`, `state` is a reactive read; `method`
      // is not. Skip the callee chain entirely when its root is a
      // built-in global (`Math.floor`, `JSON.parse`, ...) — those
      // aren't reactive reads either.
      const rootName = getRootIdentifierName(node.callee);
      if (!rootName || !BUILTIN_GLOBAL_NAMESPACE_NAMES.has(rootName)) {
        collectValueIdentifierNames(node.callee.object, into);
      }
    }
    for (const argument of node.arguments ?? []) {
      collectValueIdentifierNames(argument, into);
    }
    return;
  }
  if (isNodeOfType(node, "MemberExpression")) {
    const rootName = getRootIdentifierName(node);
    if (!rootName || !BUILTIN_GLOBAL_NAMESPACE_NAMES.has(rootName)) {
      collectValueIdentifierNames(node.object, into);
    }
    if (node.computed) collectValueIdentifierNames(node.property, into);
    return;
  }
  if (isNodeOfType(node, "Identifier")) {
    into.push(node.name);
    return;
  }
  const nodeRecord = node as unknown as Record<string, unknown>;
  for (const key of Object.keys(nodeRecord)) {
    if (key === "parent" || key === "type") continue;
    const child = nodeRecord[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === "object" && "type" in item) {
          collectValueIdentifierNames(item as EsTreeNode, into);
        }
      }
    } else if (child && typeof child === "object" && "type" in child) {
      collectValueIdentifierNames(child as EsTreeNode, into);
    }
  }
};

export const noDerivedStateEffect = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "State & Effects",
  recommendation:
    "For derived state, compute inline: `const x = fn(dep)`. For state resets on prop change, use a key prop: `<Component key={prop} />`. See https://react.dev/learn/you-might-not-need-an-effect",
  examples: [
    {
      before:
        "const [fullName, setFullName] = useState('');\nuseEffect(() => {\n  setFullName(firstName + ' ' + lastName);\n}, [firstName, lastName]);",
      after: "const fullName = firstName + ' ' + lastName;",
    },
  ],
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node, EFFECT_HOOK_NAMES) || (node.arguments?.length ?? 0) < 2) return;

      const callback = getEffectCallback(node);
      if (!callback) return;

      const depsNode = node.arguments[1];
      if (!isNodeOfType(depsNode, "ArrayExpression") || !depsNode.elements?.length) return;

      const dependencyNames = new Set<string>();
      for (const element of depsNode.elements ?? []) {
        if (isNodeOfType(element, "Identifier")) dependencyNames.add(element.name);
      }
      if (dependencyNames.size === 0) return;

      const statements = getCallbackStatements(callback);
      if (statements.length === 0) return;

      const containsOnlySetStateCalls = statements.every((statement: EsTreeNode) => {
        if (!isNodeOfType(statement, "ExpressionStatement")) return false;
        return isSetterCall(statement.expression);
      });
      if (!containsOnlySetStateCalls) return;

      let allArgumentsDeriveFromDeps = true;
      let hasAnyDependencyReference = false;
      // §2 of "You Might Not Need an Effect" branches the suggested
      // fix on whether the derivation is potentially expensive. A
      // setter argument that contains a user-defined CallExpression
      // (e.g. `setVisibleTodos(getFilteredTodos(todos, filter))`)
      // gets the `useMemo` recommendation; pure data shaping like
      // `firstName + " " + lastName` keeps the cheaper "compute
      // during render" message.
      let hasExpensiveDerivation = false;
      for (const statement of statements) {
        if (!isNodeOfType(statement, "ExpressionStatement")) continue;
        if (!isNodeOfType(statement.expression, "CallExpression")) continue;
        const setStateArguments = statement.expression.arguments;
        if (!setStateArguments?.length) continue;

        const valueIdentifierNames: string[] = [];
        collectValueIdentifierNames(setStateArguments[0], valueIdentifierNames);

        walkAst(setStateArguments[0], (child: EsTreeNode) => {
          if (!isNodeOfType(child, "CallExpression")) return;
          if (isNodeOfType(child.callee, "MemberExpression")) {
            // `Math.floor(x)` / `Date.now()` are trivial regardless
            // of the property — gate on the chain root, not the
            // method name (which would never match TRIVIAL_*).
            const rootName = getRootIdentifierName(child.callee);
            if (rootName && BUILTIN_GLOBAL_NAMESPACE_NAMES.has(rootName)) return;
            hasExpensiveDerivation = true;
            return;
          }
          if (isNodeOfType(child.callee, "Identifier")) {
            const calleeName = child.callee.name;
            if (
              !TRIVIAL_DERIVATION_CALLEE_NAMES.has(calleeName) &&
              !isSetterIdentifier(calleeName)
            ) {
              hasExpensiveDerivation = true;
            }
          }
        });

        const nonSetterIdentifiers = valueIdentifierNames.filter(
          (name) => !isSetterIdentifier(name),
        );

        if (nonSetterIdentifiers.some((name) => dependencyNames.has(name))) {
          hasAnyDependencyReference = true;
        }

        if (nonSetterIdentifiers.some((name) => !dependencyNames.has(name))) {
          allArgumentsDeriveFromDeps = false;
          break;
        }
      }

      if (!allArgumentsDeriveFromDeps) return;

      // HACK: a user-defined function call inside the setter arg
      // (`setFilteredItems(applyFilters())`) closes over reactive
      // values implicitly — it's a derivation, not a "state reset".
      // Without this, a zero-arg call would leave the identifier list
      // empty and the message would vacuously default to the wrong
      // "state reset" branch.
      if (hasExpensiveDerivation) hasAnyDependencyReference = true;

      let message: string;
      if (!hasAnyDependencyReference) {
        message =
          "State reset in useEffect — use a key prop to reset component state when props change";
      } else if (hasExpensiveDerivation) {
        message =
          "Derived state in useEffect — wrap the calculation in useMemo([deps]) (or compute it directly during render if it isn't expensive)";
      } else {
        message = "Derived state in useEffect — compute during render instead";
      }

      context.report({ node, message });
    },
  }),
});
