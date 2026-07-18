import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactFunctionCall } from "../../utils/is-react-function-call.js";

const REQUIRE_DESTRUCTURE_MESSAGE =
  "`useState` should be destructured as `[value, setValue]` so readers can see the state value and setter together.";
const NAMING_CONVENTION_MESSAGE =
  "This `useState` setter does not match its value name, so updates are harder to trace.";

interface HookUseStateSettings {
  allowDestructuredState?: boolean;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<HookUseStateSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { hookUseState?: HookUseStateSettings }).hookUseState ?? {})
      : {};
  return { allowDestructuredState: ruleSettings.allowDestructuredState ?? false };
};

const isDestructurePattern = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "ObjectPattern") || isNodeOfType(node, "ArrayPattern");

// Splits a name into its leading-lowercase prefix + remainder. Matches
// OXC's `split_leading_lowercase`. Names that don't start with a
// lowercase ASCII letter return null — which OXC then treats as
// "violates naming convention" because no `set<X>` form can be
// constructed.
const splitLeadingLowercase = (name: string): { prefix: string; suffix: string } | null => {
  let splitIndex = 0;
  while (splitIndex < name.length) {
    const code = name.charCodeAt(splitIndex);
    const isAsciiLowercase = code >= 97 && code <= 122;
    if (!isAsciiLowercase) break;
    splitIndex += 1;
  }
  if (splitIndex === 0) return null;
  return { prefix: name.slice(0, splitIndex), suffix: name.slice(splitIndex) };
};

const expectedSetterNames = (prefix: string, suffix: string): ReadonlyArray<string> => [
  // Capitalize first letter of prefix only: `color` → `setColor`
  `set${prefix.charAt(0).toUpperCase()}${prefix.slice(1)}${suffix}`,
  // Uppercase the whole prefix: `color` → `setCOLOR`
  `set${prefix.toUpperCase()}${suffix}`,
];

// Port of `oxc_linter::rules::react::hook_use_state`. Reports
//   - `const x = useState(...)` (not destructured),
//   - `const [x, y, z] = useState(...)` (wrong arity),
//   - destructured value position (`[{ res }, setRes] = …`) without
//     `allowDestructuredState`,
//   - destructured setter position (`[res, {}] = …`) — always invalid,
//   - `[color, updateColor]` (setter doesn't match `set<X>` of the value).
// Names that don't start with a lowercase letter (`RGB`) are flagged
// because no `set<X>` convention can be derived (mirrors OXC's
// `split_leading_lowercase` early-return).
export const hookUseState = defineRule({
  id: "hook-use-state",
  title: "useState not destructured",
  severity: "warn",
  // Stylistic naming rule — flags `const [count, _setCount]` (the
  // unused-marker underscore convention) and `const [instance] =
  // useState(() => new Foo())` (the create-once initializer pattern
  // where the setter is intentionally never used). Both are
  // idiomatic. Default off.
  defaultEnabled: false,
  recommendation:
    "Destructure `useState` as `const [thing, setThing] = useState(…)` so state reads and writes stay visible together.",
  category: "Architecture",
  create: (context) => {
    const { allowDestructuredState } = resolveSettings(context.settings);

    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        const callExpressionNode: EsTreeNode = node;
        if (!isReactFunctionCall(callExpressionNode, "useState")) return;
        const expressionRoot = findTransparentExpressionRoot(callExpressionNode);
        const expressionParent = expressionRoot.parent;
        if (isNodeOfType(expressionParent, "ReturnStatement")) return;
        if (
          isNodeOfType(expressionParent, "ArrowFunctionExpression") &&
          expressionParent.body === expressionRoot
        ) {
          return;
        }
        const parent = node.parent;
        if (!parent) return;
        if (!isNodeOfType(parent, "VariableDeclarator")) {
          context.report({ node, message: REQUIRE_DESTRUCTURE_MESSAGE });
          return;
        }
        const idPattern = parent.id;
        if (!isNodeOfType(idPattern, "ArrayPattern")) {
          context.report({ node: parent, message: REQUIRE_DESTRUCTURE_MESSAGE });
          return;
        }
        if (idPattern.elements.length !== 2) {
          context.report({ node: idPattern, message: REQUIRE_DESTRUCTURE_MESSAGE });
          return;
        }
        const valueElement = idPattern.elements[0];
        const setterElement = idPattern.elements[1];
        if (!valueElement || !setterElement) return;

        // Setter MUST be a plain identifier — `[res, {}] = useState()` is
        // always wrong (regardless of allowDestructuredState).
        if (isDestructurePattern(setterElement as EsTreeNode)) {
          context.report({ node: idPattern, message: REQUIRE_DESTRUCTURE_MESSAGE });
          return;
        }
        if (!isNodeOfType(setterElement, "Identifier")) return;

        if (isDestructurePattern(valueElement as EsTreeNode)) {
          if (allowDestructuredState) return;
          context.report({ node: idPattern, message: REQUIRE_DESTRUCTURE_MESSAGE });
          return;
        }

        if (!isNodeOfType(valueElement, "Identifier")) return;
        const setterName = setterElement.name;
        const split = splitLeadingLowercase(valueElement.name);
        if (!split) {
          context.report({ node: idPattern, message: NAMING_CONVENTION_MESSAGE });
          return;
        }
        const expected = expectedSetterNames(split.prefix, split.suffix);
        if (expected.includes(setterName)) return;
        context.report({ node: idPattern, message: NAMING_CONVENTION_MESSAGE });
      },
    };
  },
});
