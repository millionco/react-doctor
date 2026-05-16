import {
  AUTH_CHECK_LOOKAHEAD_STATEMENTS,
  AUTH_FUNCTION_NAMES,
  AUTH_OBJECT_PATTERN,
  GENERIC_AUTH_METHOD_NAMES,
} from "../../constants/security.js";
import { defineRule } from "../../utils/define-rule.js";
import { getReactDoctorStringArraySetting } from "../../utils/get-react-doctor-setting.js";
import { hasDirective } from "../../utils/has-directive.js";
import { hasUseServerDirective } from "../../utils/has-use-server-directive.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

type AsyncFunctionLikeNode =
  | EsTreeNodeOfType<"FunctionDeclaration">
  | EsTreeNodeOfType<"FunctionExpression">
  | EsTreeNodeOfType<"ArrowFunctionExpression">;

const isAsyncFunctionLikeNode = (
  node: EsTreeNode | null | undefined,
): node is AsyncFunctionLikeNode => {
  if (!node) return false;
  if (
    !isNodeOfType(node, "FunctionDeclaration") &&
    !isNodeOfType(node, "FunctionExpression") &&
    !isNodeOfType(node, "ArrowFunctionExpression")
  ) {
    return false;
  }
  return Boolean(node.async);
};

const unwrapTypeWrappedCallee = (node: EsTreeNode | null | undefined): EsTreeNode | null => {
  let currentNode: EsTreeNode | null | undefined = node;
  while (currentNode) {
    if (
      isNodeOfType(currentNode, "TSAsExpression") ||
      isNodeOfType(currentNode, "TSNonNullExpression") ||
      isNodeOfType(currentNode, "TSTypeAssertion") ||
      isNodeOfType(currentNode, "TSSatisfiesExpression") ||
      isNodeOfType(currentNode, "TSInstantiationExpression")
    ) {
      currentNode = currentNode.expression;
      continue;
    }
    if (isNodeOfType(currentNode, "ChainExpression")) {
      currentNode = currentNode.expression;
      continue;
    }
    return currentNode;
  }
  return null;
};

const buildDottedReceiverSource = (receiverNode: EsTreeNode | null | undefined): string => {
  const unwrapped = unwrapTypeWrappedCallee(receiverNode);
  if (!unwrapped) return "";
  if (isNodeOfType(unwrapped, "Identifier")) return unwrapped.name;
  if (isNodeOfType(unwrapped, "ThisExpression")) return "this";
  if (isNodeOfType(unwrapped, "MemberExpression")) {
    const objectSource = buildDottedReceiverSource(unwrapped.object);
    const propertyName = isNodeOfType(unwrapped.property, "Identifier")
      ? unwrapped.property.name
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
  const calleeNode = unwrapTypeWrappedCallee(callExpression.callee);
  if (!calleeNode) return null;
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

const isFunctionLikeNode = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "FunctionDeclaration") ||
  isNodeOfType(node, "FunctionExpression") ||
  isNodeOfType(node, "ArrowFunctionExpression");

const containsAuthCheck = (
  rootNodes: EsTreeNode[],
  allowedFunctionNames: ReadonlySet<string>,
  genericMethodNames: ReadonlySet<string>,
): boolean => {
  let foundAuthCall = false;
  for (const rootNode of rootNodes) {
    walkAst(rootNode, (child: EsTreeNode) => {
      if (foundAuthCall) return;
      // Prune at any function-like node. A call to `auth()` inside a
      // helper that the action never invokes does not protect the
      // action, so we restrict the search to expressions evaluated
      // directly by the action's top-level statements. This also
      // covers a hoisted-helper top-level statement (a
      // FunctionDeclaration as a root) — we don't want its inner
      // `auth()` to count either.
      if (isFunctionLikeNode(child)) return false;
      if (!isNodeOfType(child, "CallExpression")) return;
      if (getAuthCallName(child, allowedFunctionNames, genericMethodNames)) {
        foundAuthCall = true;
      }
    });
  }
  return foundAuthCall;
};

const getAuthScanRoots = (functionNode: AsyncFunctionLikeNode): EsTreeNode[] => {
  const bodyNode = functionNode.body;
  if (!bodyNode) return [];
  if (isNodeOfType(bodyNode, "BlockStatement")) {
    return (bodyNode.body ?? []).slice(0, AUTH_CHECK_LOOKAHEAD_STATEMENTS);
  }
  // Concise-body arrow (`async () => somethingExpr`): the body IS the
  // (only) expression — treat it as the single root to scan.
  return [bodyNode];
};

interface ServerActionCandidate {
  functionNode: AsyncFunctionLikeNode;
  displayName: string;
  reportNode: EsTreeNode;
}

const inspectServerAction = (
  candidate: ServerActionCandidate,
  fileHasUseServerDirective: boolean,
  allowedFunctionNames: ReadonlySet<string>,
  context: RuleContext,
): void => {
  const isServerAction = fileHasUseServerDirective || hasUseServerDirective(candidate.functionNode);
  if (!isServerAction) return;

  const rootNodes = getAuthScanRoots(candidate.functionNode);
  if (containsAuthCheck(rootNodes, allowedFunctionNames, GENERIC_AUTH_METHOD_NAMES)) return;

  context.report({
    node: candidate.reportNode,
    message: `Server action "${candidate.displayName}" — add auth check (auth(), getSession(), etc.) at the top`,
  });
};

const collectCandidatesFromVariableDeclaration = (
  variableDeclaration: EsTreeNodeOfType<"VariableDeclaration">,
): ServerActionCandidate[] => {
  const candidates: ServerActionCandidate[] = [];
  for (const declarator of variableDeclaration.declarations ?? []) {
    if (!isAsyncFunctionLikeNode(declarator.init)) continue;
    const bindingNode = isNodeOfType(declarator.id, "Identifier") ? declarator.id : null;
    candidates.push({
      functionNode: declarator.init,
      displayName: bindingNode?.name ?? "anonymous",
      reportNode: bindingNode ?? declarator,
    });
  }
  return candidates;
};

const getCandidateFromDefaultDeclaration = (
  node: EsTreeNodeOfType<"ExportDefaultDeclaration">,
): ServerActionCandidate | null => {
  const declaration = node.declaration;
  if (!isAsyncFunctionLikeNode(declaration)) return null;
  // Only FunctionDeclaration / FunctionExpression carry an `id`;
  // arrow functions never do. Fall back to "default" when missing.
  const functionId =
    (isNodeOfType(declaration, "FunctionDeclaration") ||
      isNodeOfType(declaration, "FunctionExpression")) &&
    declaration.id
      ? declaration.id
      : null;
  return {
    functionNode: declaration,
    displayName: functionId?.name ?? "default",
    reportNode: functionId ?? node,
  };
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

    const inspect = (candidate: ServerActionCandidate): void =>
      inspectServerAction(candidate, fileHasUseServerDirective, allowedFunctionNames, context);

    return {
      Program(programNode: EsTreeNodeOfType<"Program">) {
        fileHasUseServerDirective = hasDirective(programNode, "use server");
      },
      ExportNamedDeclaration(node: EsTreeNodeOfType<"ExportNamedDeclaration">) {
        const declaration = node.declaration;
        if (!declaration) return;
        if (isAsyncFunctionLikeNode(declaration)) {
          if (!isNodeOfType(declaration, "FunctionDeclaration")) return;
          inspect({
            functionNode: declaration,
            displayName: declaration.id?.name ?? "anonymous",
            reportNode: declaration.id ?? node,
          });
          return;
        }
        if (isNodeOfType(declaration, "VariableDeclaration")) {
          for (const candidate of collectCandidatesFromVariableDeclaration(declaration)) {
            inspect(candidate);
          }
        }
      },
      ExportDefaultDeclaration(node: EsTreeNodeOfType<"ExportDefaultDeclaration">) {
        const candidate = getCandidateFromDefaultDeclaration(node);
        if (candidate) inspect(candidate);
      },
    };
  },
});
