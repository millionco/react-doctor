import {
  AUTH_CHECK_LOOKAHEAD_STATEMENTS,
  AUTH_FUNCTION_NAMES,
  AUTH_OBJECT_PATTERN,
  GENERIC_AUTH_METHOD_NAMES,
} from "../../constants/security.js";
import { defineRule } from "../../utils/define-rule.js";
import { findExportedValue } from "../../utils/find-exported-value.js";
import { getReactDoctorStringArraySetting } from "../../utils/get-react-doctor-setting.js";
import { hasDirective } from "../../utils/has-directive.js";
import { hasUseServerDirective } from "../../utils/has-use-server-directive.js";
import { isAuthGuardName } from "../../utils/is-auth-guard-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNonPrivilegedServerAction } from "../../utils/is-non-privileged-server-action.js";
import { tokenizeIdentifierWords } from "../../utils/tokenize-identifier-words.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { skipNonProductionFiles } from "../../utils/skip-non-production-files.js";

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
    const calleeName = calleeNode.name;
    return allowedFunctionNames.has(calleeName) || isAuthGuardName(calleeName) ? calleeName : null;
  }
  if (
    isNodeOfType(calleeNode, "MemberExpression") &&
    isNodeOfType(calleeNode.property, "Identifier")
  ) {
    const methodName = calleeNode.property.name;
    // A conventionally auth-shaped method name (`ctx.requireAdmin()`,
    // `auth0.getSession()`) is distinctive enough to accept on any receiver;
    // only the exact-allowlist names fall back to the auth-receiver check
    // that keeps generic ones like `analytics.getUser()` out.
    if (isAuthGuardName(methodName)) return methodName;
    if (!allowedFunctionNames.has(methodName)) return null;
    if (!isMemberCallAuthRelated(calleeNode.object, methodName, genericMethodNames)) return null;
    return methodName;
  }
  return null;
};

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
      if (isFunctionLike(child)) return false;
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

const COMPONENT_NAME_PATTERN = /^[A-Z]/;
const TEST_APP_SOURCE_PATH_PATTERN = /(?:^|[/\\])test[/\\](?:app|src)[/\\]/;

const containsJsxOutsideNestedFunctions = (rootNode: EsTreeNode): boolean => {
  let containsJsx = false;
  walkAst(rootNode, (child: EsTreeNode) => {
    if (containsJsx) return false;
    if (child !== rootNode && isFunctionLike(child)) return false;
    if (isNodeOfType(child, "JSXElement") || isNodeOfType(child, "JSXFragment")) {
      containsJsx = true;
      return false;
    }
  });
  return containsJsx;
};

const isComponentLikeServerExport = (candidate: ServerActionCandidate): boolean => {
  if (!COMPONENT_NAME_PATTERN.test(candidate.displayName)) return false;
  const functionBody = candidate.functionNode.body;
  if (!isNodeOfType(functionBody, "BlockStatement")) {
    return containsJsxOutsideNestedFunctions(functionBody);
  }

  let hasReturnedJsx = false;
  walkAst(functionBody, (child: EsTreeNode) => {
    if (hasReturnedJsx) return false;
    if (child !== functionBody && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "ReturnStatement") || !child.argument) return;
    hasReturnedJsx = containsJsxOutsideNestedFunctions(child.argument);
    return false;
  });
  return hasReturnedJsx;
};

// `signIn` / `logIn` / `signUp` tokenize as two words; merge them so the
// standalone-token check reads them as one credential phrase.
const CREDENTIAL_MERGE_TAIL_TOKENS: Readonly<Record<string, ReadonlySet<string>>> = {
  sign: new Set(["in", "up", "on"]),
  log: new Set(["in"]),
};

const mergeCredentialPhraseTokens = (tokens: string[]): string[] => {
  const mergedTokens: string[] = [];
  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const currentToken = tokens[tokenIndex];
    const tailTokens = CREDENTIAL_MERGE_TAIL_TOKENS[currentToken];
    const nextToken = tokens[tokenIndex + 1];
    if (tailTokens && nextToken && tailTokens.has(nextToken)) {
      mergedTokens.push(`${currentToken}${nextToken}`);
      tokenIndex += 1;
      continue;
    }
    mergedTokens.push(currentToken);
  }
  return mergedTokens;
};

const CREDENTIAL_STANDALONE_TOKENS: ReadonlySet<string> = new Set([
  "login",
  "signin",
  "signup",
  "signon",
  "register",
  "registration",
  "oauth",
  "otp",
]);

const CREDENTIAL_FLOW_VERB_TOKENS: ReadonlySet<string> = new Set([
  "verify",
  "confirm",
  "reset",
  "forgot",
  "recover",
]);

const CREDENTIAL_FLOW_NOUN_TOKENS: ReadonlySet<string> = new Set(["password", "email", "code"]);

// A credential-establishing action (login, signup, OAuth callback, OTP /
// email verify, password reset) legitimately runs for anonymous callers —
// no prior session can exist, so demanding an auth() gate on it is wrong.
const isCredentialEstablishingActionName = (actionName: string): boolean => {
  const tokens = mergeCredentialPhraseTokens(tokenizeIdentifierWords(actionName));
  let hasCredentialFlowVerb = false;
  let hasCredentialFlowNoun = false;
  let hasMagicToken = false;
  let hasLinkToken = false;
  for (const token of tokens) {
    if (CREDENTIAL_STANDALONE_TOKENS.has(token)) return true;
    if (CREDENTIAL_FLOW_VERB_TOKENS.has(token)) hasCredentialFlowVerb = true;
    if (CREDENTIAL_FLOW_NOUN_TOKENS.has(token)) hasCredentialFlowNoun = true;
    if (token === "magic") hasMagicToken = true;
    if (token === "link") hasLinkToken = true;
  }
  if (hasCredentialFlowVerb && hasCredentialFlowNoun) return true;
  return hasMagicToken && hasLinkToken;
};

// Naming an exported action "public" (`getPostPublicAction`) declares the
// no-auth exposure on purpose; flagging it asks the author to gate an
// endpoint they deliberately opened.
const hasPublicNameToken = (actionName: string): boolean =>
  tokenizeIdentifierWords(actionName).includes("public");

const inspectServerAction = (
  candidate: ServerActionCandidate,
  fileHasUseServerDirective: boolean,
  allowedFunctionNames: ReadonlySet<string>,
  context: RuleContext,
): void => {
  const isServerAction = fileHasUseServerDirective || hasUseServerDirective(candidate.functionNode);
  if (!isServerAction) return;

  if (isComponentLikeServerExport(candidate)) return;
  if (isCredentialEstablishingActionName(candidate.displayName)) return;
  if (hasPublicNameToken(candidate.displayName)) return;

  const rootNodes = getAuthScanRoots(candidate.functionNode);
  if (containsAuthCheck(rootNodes, allowedFunctionNames, GENERIC_AUTH_METHOD_NAMES)) return;

  // A cache-busting / navigation-only action touches no protected data, so it
  // is safe to call unauthenticated. Checked after the bounded auth scan so
  // the full-body walk is skipped for the common authenticated case.
  if (isNonPrivilegedServerAction(candidate.functionNode)) return;

  context.report({
    node: candidate.reportNode,
    message: `Anyone can call server action "${candidate.displayName}" without logging in, since it has no auth check.`,
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

export const serverAuthActions = defineRule({
  id: "server-auth-actions",
  title: "Unauthenticated server action can be called directly",
  severity: "error",
  recommendation:
    "Check auth before touching data because exported server actions can be called directly by unauthenticated clients.",
  create: skipNonProductionFiles((context: RuleContext) => {
    const shouldSkipTestAppSource = Boolean(
      context.filename && TEST_APP_SOURCE_PATH_PATTERN.test(context.filename),
    );
    let fileHasUseServerDirective = false;
    let programNode: EsTreeNodeOfType<"Program"> | null = null;
    const inspectedFunctions = new Set<AsyncFunctionLikeNode>();
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

    const inspect = (candidate: ServerActionCandidate): void => {
      if (inspectedFunctions.has(candidate.functionNode)) return;
      inspectedFunctions.add(candidate.functionNode);
      inspectServerAction(candidate, fileHasUseServerDirective, allowedFunctionNames, context);
    };

    return {
      Program(currentProgramNode: EsTreeNodeOfType<"Program">) {
        programNode = currentProgramNode;
        fileHasUseServerDirective = hasDirective(currentProgramNode, "use server");
      },
      ExportNamedDeclaration(node: EsTreeNodeOfType<"ExportNamedDeclaration">) {
        if (shouldSkipTestAppSource) return;
        const declaration = node.declaration;
        if (!declaration) {
          if (!programNode || node.source || node.exportKind === "type") return;
          for (const specifier of node.specifiers ?? []) {
            if (!isNodeOfType(specifier, "ExportSpecifier") || specifier.exportKind === "type") {
              continue;
            }
            const exportedName = isNodeOfType(specifier.exported, "Identifier")
              ? specifier.exported.name
              : isNodeOfType(specifier.exported, "Literal") &&
                  typeof specifier.exported.value === "string"
                ? specifier.exported.value
                : null;
            if (!exportedName) continue;
            const exportedValue = findExportedValue(programNode, exportedName);
            if (!isAsyncFunctionLikeNode(exportedValue)) continue;
            const localName = isNodeOfType(specifier.local, "Identifier")
              ? specifier.local.name
              : exportedName;
            inspect({
              functionNode: exportedValue,
              displayName: localName,
              reportNode: specifier.local ?? specifier,
            });
          }
          return;
        }
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
        if (shouldSkipTestAppSource) return;
        const directCandidate = getCandidateFromDefaultDeclaration(node);
        if (directCandidate) {
          inspect(directCandidate);
          return;
        }
        if (!programNode) return;
        const resolvedDefaultExport = findExportedValue(programNode, "default");
        const candidate = isAsyncFunctionLikeNode(resolvedDefaultExport)
          ? {
              functionNode: resolvedDefaultExport,
              displayName: isNodeOfType(node.declaration, "Identifier")
                ? node.declaration.name
                : "default",
              reportNode: node.declaration ?? node,
            }
          : null;
        if (candidate) inspect(candidate);
      },
    };
  }),
});
