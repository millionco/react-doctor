import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getParentComponent } from "../../utils/get-parent-component.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import type { Rule } from "../../utils/rule.js";

const STRING_IN_REF_MESSAGE =
  "Your component can't reach this node because string refs don't work in modern React.";
const THIS_REFS_MESSAGE =
  "Your component can't reach its nodes because `this.refs` is empty in modern React.";

const isStringLiteralRefAttribute = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  noTemplateLiterals: boolean,
): boolean => {
  if (!isNodeOfType(attribute.name, "JSXIdentifier") || attribute.name.name !== "ref") {
    return false;
  }
  const value = attribute.value;
  if (!value) return false;
  if (isNodeOfType(value, "Literal") && typeof value.value === "string") return true;
  if (isNodeOfType(value, "JSXExpressionContainer")) {
    const expression = value.expression;
    if (isNodeOfType(expression, "Literal") && typeof expression.value === "string") return true;
    if (noTemplateLiterals && isNodeOfType(expression, "TemplateLiteral")) return true;
  }
  return false;
};

interface NoStringRefsSettings {
  noTemplateLiterals?: boolean;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): NoStringRefsSettings => {
  const reactDoctorSettings = settings?.["react-doctor"];
  if (
    typeof reactDoctorSettings === "object" &&
    reactDoctorSettings !== null &&
    "noStringRefs" in reactDoctorSettings &&
    typeof (reactDoctorSettings as { noStringRefs?: unknown }).noStringRefs === "object" &&
    (reactDoctorSettings as { noStringRefs?: unknown }).noStringRefs !== null
  ) {
    const inner = (reactDoctorSettings as { noStringRefs: NoStringRefsSettings }).noStringRefs;
    return inner;
  }
  return {};
};

// Port of `oxc_linter::rules::react::no_string_refs`. Reports two shapes:
//   1. `<x ref="..." />` or `<x ref={"..."} />` — string-literal refs.
//      With `noTemplateLiterals: true` setting, also reports template
//      literals (`<x ref={\`...\`} />`).
//   2. `this.refs.foo` — when used inside a React component's body.
export const noStringRefs = defineRule<Rule>({
  id: "no-string-refs",
  title: "Use of string refs",
  severity: "warn",
  recommendation:
    "Use a callback ref (`ref={(node) => { this.foo = node }}`) or `useRef` instead of string refs.",
  create: (context) => {
    const { noTemplateLiterals = false } = resolveSettings(context.settings);
    // Test files routinely use library-specific JSX DSLs whose `ref`
    // attribute means something other than React's deprecated string
    // refs (e.g. tldraw's `createShapesFromJsx([<TL.geo ref="boxA"/>])`
    // where the string identifies a shape in the test, not a React ref).
    // Skip those — string-ref-deprecation warnings only matter for
    // production React code, where the test corpus showed zero hits.
    const isTestlikeFile = isTestlikeFilename(context.filename);
    return {
      JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
        if (isTestlikeFile) return;
        if (isStringLiteralRefAttribute(node, noTemplateLiterals)) {
          context.report({ node, message: STRING_IN_REF_MESSAGE });
        }
      },
      MemberExpression(node: EsTreeNodeOfType<"MemberExpression">) {
        if (isTestlikeFile) return;
        if (!isNodeOfType(node.object, "ThisExpression")) return;
        if (!isNodeOfType(node.property, "Identifier") || node.property.name !== "refs") return;
        const enclosingComponent: EsTreeNode | null = getParentComponent(node);
        if (!enclosingComponent) return;
        context.report({ node, message: THIS_REFS_MESSAGE });
      },
    };
  },
});
