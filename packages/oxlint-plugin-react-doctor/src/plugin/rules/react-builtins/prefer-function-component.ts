import { containsJsxElement } from "../../utils/contains-jsx-element.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isEs6Component } from "../../utils/is-es6-component.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE = "This class component is harder to maintain than a function component.";

interface PreferFunctionComponentSettings {
  allowErrorBoundary?: boolean;
  allowJsxUtilityClass?: boolean;
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<PreferFunctionComponentSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { preferFunctionComponent?: PreferFunctionComponentSettings })
          .preferFunctionComponent ?? {})
      : {};
  return {
    allowErrorBoundary: ruleSettings.allowErrorBoundary ?? true,
    allowJsxUtilityClass: ruleSettings.allowJsxUtilityClass ?? false,
  };
};

const ERROR_BOUNDARY_METHODS = new Set(["componentDidCatch", "getDerivedStateFromError"]);

const isErrorBoundaryClass = (classNode: EsTreeNode): boolean => {
  const classBody = (classNode as { body?: EsTreeNode }).body;
  if (!classBody) return false;
  const members = (classBody as { body?: ReadonlyArray<EsTreeNode> }).body ?? [];
  for (const member of members) {
    if (!isNodeOfType(member, "MethodDefinition")) continue;
    const key = member.key;
    if (isNodeOfType(key, "Identifier") && ERROR_BOUNDARY_METHODS.has(key.name)) {
      return true;
    }
  }
  return false;
};

// Port of `oxc_linter::rules::react::prefer_function_component`. Flags
// classes that look like React components and could be re-written as
// functions. Both `ClassDeclaration` and `ClassExpression` are
// visited so HoC-wrapped class components
// (`connect(mapState)(class extends Component {...})`) are still
// caught.
//
// Defaults:
//   - error boundary classes (componentDidCatch /
//     getDerivedStateFromError) are exempt — there's no hook
//     equivalent. Override with `allowErrorBoundary: false`.
//   - "JSX utility classes" (a class that contains JSX but does NOT
//     extend Component) are NOT flagged by default — matching the
//     conservative behaviour. Enable OXC-parity flagging with
//     `allowJsxUtilityClass: true`.
export const preferFunctionComponent = defineRule<Rule>({
  id: "prefer-function-component",
  title: "Class component instead of function",
  severity: "warn",
  // Class components are still valid React — required for error
  // boundaries (no hook equivalent), used widely in legacy code and
  // third-party libraries. Forcing rewrites by default is too
  // opinionated. Off by default.
  defaultEnabled: false,
  recommendation: "Re-write the class component as a function component using hooks.",
  category: "Architecture",
  create: (context) => {
    const settings = resolveSettings(context.settings);
    const checkClass = (node: EsTreeNode): void => {
      if (!isEs6Component(node)) {
        if (!settings.allowJsxUtilityClass) {
          // Without isEs6Component matching, we don't flag — OXC's
          // jsx-utility-class branch is approximated by our default off.
          return;
        }
        if (!containsJsxElement(node)) return;
      }
      if (settings.allowErrorBoundary && isErrorBoundaryClass(node)) return;
      const reportNode = ((node as { id?: EsTreeNode }).id ?? node) as EsTreeNode;
      context.report({ node: reportNode, message: MESSAGE });
    };
    return {
      ClassDeclaration(node: EsTreeNodeOfType<"ClassDeclaration">) {
        checkClass(node);
      },
      ClassExpression(node: EsTreeNodeOfType<"ClassExpression">) {
        checkClass(node);
      },
    };
  },
});
