import {
  AUTH_CHECK_LOOKAHEAD_STATEMENTS,
  AUTH_FUNCTION_NAMES,
  AUTH_OBJECT_PATTERN,
  GENERIC_AUTH_METHOD_NAMES,
} from "../../constants/security.js";
import { defineRule } from "../../utils/define-rule.js";
import { hasDirective } from "../../utils/has-directive.js";
import { hasUseServerDirective } from "../../utils/has-use-server-directive.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const buildDottedReceiverSource = (receiverNode: EsTreeNode | null | undefined): string => {
  if (!receiverNode) return "";
  if (isNodeOfType(receiverNode, "Identifier")) return receiverNode.name;
  if (isNodeOfType(receiverNode, "ThisExpression")) return "this";
  if (isNodeOfType(receiverNode, "MemberExpression")) {
    const objectSource = buildDottedReceiverSource(receiverNode.object);
    const propertyName = isNodeOfType(receiverNode.property, "Identifier")
      ? receiverNode.property.name
      : "";
    if (!propertyName) return objectSource;
    return objectSource ? `${objectSource}.${propertyName}` : propertyName;
  }
  return "";
};

const isMemberCallAuthRelated = (
  receiverNode: EsTreeNode | null | undefined,
  methodName: string,
  genericMethodNames: ReadonlySet<string>,
): boolean => {
  if (!genericMethodNames.has(methodName)) return true;
  const receiverSource = buildDottedReceiverSource(receiverNode);
  return AUTH_OBJECT_PATTERN.test(receiverSource);
};

const getAuthCallName = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  allowedFunctionNames: ReadonlySet<string>,
  genericMethodNames: ReadonlySet<string>,
): string | null => {
  const calleeNode = callExpression.callee;
  if (isNodeOfType(calleeNode, "Identifier")) {
    return allowedFunctionNames.has(calleeNode.name) ? calleeNode.name : null;
  }
  if (
    isNodeOfType(calleeNode, "MemberExpression") &&
    isNodeOfType(calleeNode.property, "Identifier")
  ) {
    const methodName = calleeNode.property.name;
    if (!allowedFunctionNames.has(methodName)) return null;
    if (!isMemberCallAuthRelated(calleeNode.object, methodName, genericMethodNames)) return null;
    return methodName;
  }
  return null;
};

const containsAuthCheck = (
  statements: EsTreeNode[],
  allowedFunctionNames: ReadonlySet<string>,
  genericMethodNames: ReadonlySet<string>,
): boolean => {
  let foundAuthCall = false;
  for (const statement of statements) {
    walkAst(statement, (child: EsTreeNode) => {
      if (foundAuthCall) return;
      let callNode: EsTreeNode | null = null;
      if (isNodeOfType(child, "CallExpression")) {
        callNode = child;
      } else if (
        isNodeOfType(child, "AwaitExpression") &&
        isNodeOfType(child.argument, "CallExpression")
      ) {
        callNode = child.argument;
      }
      if (!isNodeOfType(callNode, "CallExpression")) return;
      if (getAuthCallName(callNode, allowedFunctionNames, genericMethodNames)) {
        foundAuthCall = true;
      }
    });
  }
  return foundAuthCall;
};

const getReactDoctorStringArraySetting = (
  settings: RuleContext["settings"],
  settingName: string,
): ReadonlyArray<string> => {
  const reactDoctorSettings = settings?.["react-doctor"];
  if (
    typeof reactDoctorSettings !== "object" ||
    reactDoctorSettings === null ||
    Array.isArray(reactDoctorSettings)
  ) {
    return [];
  }
  const settingValue = Object.getOwnPropertyDescriptor(reactDoctorSettings, settingName)?.value;
  if (!Array.isArray(settingValue)) return [];
  return settingValue.filter((entry): entry is string => typeof entry === "string" && entry !== "");
};

export const serverAuthActions = defineRule<Rule>({
  id: "server-auth-actions",
  severity: "error",
  recommendation:
    "Add `const session = await auth()` at the top and throw/redirect if unauthorized before any data access",
  create: (context: RuleContext) => {
    let fileHasUseServerDirective = false;
    const customAuthFunctionNames = getReactDoctorStringArraySetting(
      context.settings,
      "serverAuthFunctionNames",
    );
    // Custom auth guards from project config are treated as distinctive
    // (NOT generic) — when a project opts a name in, the user has
    // already vouched that the name uniquely identifies an auth check.
    const allowedFunctionNames: ReadonlySet<string> =
      customAuthFunctionNames.length > 0
        ? new Set([...AUTH_FUNCTION_NAMES, ...customAuthFunctionNames])
        : AUTH_FUNCTION_NAMES;

    return {
      Program(programNode: EsTreeNodeOfType<"Program">) {
        fileHasUseServerDirective = hasDirective(programNode, "use server");
      },
      ExportNamedDeclaration(node: EsTreeNodeOfType<"ExportNamedDeclaration">) {
        const declaration = node.declaration;
        if (!isNodeOfType(declaration, "FunctionDeclaration") || !declaration?.async) return;

        const isServerAction = fileHasUseServerDirective || hasUseServerDirective(declaration);
        if (!isServerAction) return;

        const firstStatements = (declaration.body?.body ?? []).slice(
          0,
          AUTH_CHECK_LOOKAHEAD_STATEMENTS,
        );
        if (!containsAuthCheck(firstStatements, allowedFunctionNames, GENERIC_AUTH_METHOD_NAMES)) {
          const functionName = declaration.id?.name ?? "anonymous";
          context.report({
            node: declaration.id ?? node,
            message: `Server action "${functionName}" — add auth check (auth(), getSession(), etc.) at the top`,
          });
        }
      },
    };
  },
});
