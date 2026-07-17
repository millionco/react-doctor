import { defineRule } from "../../utils/define-rule.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { isMemberProperty } from "../../utils/is-member-property.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isSetterIdentifier } from "../../utils/is-setter-identifier.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";

const ESCAPE_ASSIGNMENT_TARGET_PROPERTIES = new Set(["href", "src", "current"]);

const MESSAGE =
  "`URL.createObjectURL(...)` pins the underlying Blob/File in memory until it is revoked, and this module never calls `URL.revokeObjectURL`. Store the URL, revoke it once you're done (in an effect cleanup, after the download, or on unmount) so the Blob can be freed.";

const GLOBAL_URL_OWNER_NAMES = new Set(["globalThis", "self", "window"]);

const isGlobalUrlReceiver = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const receiver = stripParenExpression(node);
  if (isNodeOfType(receiver, "Identifier")) {
    return receiver.name === "URL" && scopes.isGlobalReference(receiver);
  }
  if (
    !isNodeOfType(receiver, "MemberExpression") ||
    receiver.computed ||
    !isNodeOfType(receiver.object, "Identifier") ||
    !isNodeOfType(receiver.property, "Identifier")
  ) {
    return false;
  }
  return (
    receiver.property.name === "URL" &&
    GLOBAL_URL_OWNER_NAMES.has(receiver.object.name) &&
    scopes.isGlobalReference(receiver.object)
  );
};

const isUrlMethodCall = (
  node: EsTreeNodeOfType<"CallExpression">,
  methodName: string,
  scopes: ScopeAnalysis,
): boolean => {
  const callee = stripParenExpression(node.callee);
  return (
    isMemberProperty(callee, methodName) &&
    !callee.computed &&
    isGlobalUrlReceiver(callee.object, scopes)
  );
};

const isCreateObjectUrlCall = (
  node: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const callee = stripParenExpression(node.callee);
  if (!isMemberProperty(callee, "createObjectURL") || callee.computed) return false;
  return isGlobalUrlReceiver(callee.object, scopes);
};

const moduleCallsRevoke = (programRoot: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let found = false;
  walkAst(programRoot, (child) => {
    if (found) return false;
    if (
      isNodeOfType(child, "CallExpression") &&
      isUrlMethodCall(child, "revokeObjectURL", scopes)
    ) {
      found = true;
    }
  });
  return found;
};

const CACHE_COLLECTION_CONSTRUCTOR_NAMES = new Set(["Map", "Set"]);
const CACHE_STORE_METHOD_NAMES = new Set(["add", "set"]);

const isModuleScopeCacheReference = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(node, "Identifier")) return false;
  const symbol = scopes.symbolFor(node);
  if (!symbol || symbol.scope.kind !== "module" || !/cache/i.test(symbol.name)) return false;
  const initializer = symbol.initializer ? stripParenExpression(symbol.initializer) : null;
  return Boolean(
    initializer &&
    isNodeOfType(initializer, "NewExpression") &&
    isNodeOfType(initializer.callee, "Identifier") &&
    CACHE_COLLECTION_CONSTRUCTOR_NAMES.has(initializer.callee.name) &&
    scopes.isGlobalReference(initializer.callee),
  );
};

const isCacheStoreOfExpression = (
  call: EsTreeNodeOfType<"CallExpression">,
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const callee = stripParenExpression(call.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    !isNodeOfType(callee.property, "Identifier") ||
    !CACHE_STORE_METHOD_NAMES.has(callee.property.name) ||
    !isModuleScopeCacheReference(callee.object, scopes)
  ) {
    return false;
  }
  const storedArgument = callee.property.name === "set" ? call.arguments[1] : call.arguments[0];
  if (!storedArgument || !isNodeOfType(expression, "Identifier")) return false;
  const storedExpression = stripParenExpression(storedArgument);
  return (
    isNodeOfType(storedExpression, "Identifier") &&
    scopes.symbolFor(storedExpression) === scopes.symbolFor(expression)
  );
};

const findBoundCallResult = (call: EsTreeNode): EsTreeNode | null => {
  let resultExpression = findTransparentExpressionRoot(call);
  if (resultExpression.parent && isNodeOfType(resultExpression.parent, "AwaitExpression")) {
    resultExpression = findTransparentExpressionRoot(resultExpression.parent);
  }
  const consumer = resultExpression.parent;
  if (
    !consumer ||
    !isNodeOfType(consumer, "VariableDeclarator") ||
    consumer.init !== resultExpression ||
    !isNodeOfType(consumer.id, "Identifier")
  ) {
    return null;
  }
  return consumer.id;
};

const moduleCachesEveryReturnedResult = (
  createCall: EsTreeNode,
  programRoot: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const returnedExpression = findTransparentExpressionRoot(createCall);
  if (!returnedExpression.parent || !isNodeOfType(returnedExpression.parent, "ReturnStatement")) {
    return false;
  }
  const enclosingFunction = findEnclosingFunction(createCall);
  if (!enclosingFunction) return false;
  let didFindCall = false;
  let didFindUncachedCall = false;
  walkAst(programRoot, (child) => {
    if (didFindUncachedCall) return false;
    if (
      !isNodeOfType(child, "CallExpression") ||
      !isNodeOfType(stripParenExpression(child.callee), "Identifier")
    ) {
      return;
    }
    const callee = stripParenExpression(child.callee);
    if (
      !isNodeOfType(callee, "Identifier") ||
      scopes.symbolFor(callee)?.initializer !== enclosingFunction
    ) {
      return;
    }
    didFindCall = true;
    const resultBinding = findBoundCallResult(child);
    if (!resultBinding) {
      didFindUncachedCall = true;
      return false;
    }
    let didCacheResult = false;
    walkAst(programRoot, (candidate) => {
      if (didCacheResult) return false;
      if (
        isNodeOfType(candidate, "CallExpression") &&
        isCacheStoreOfExpression(candidate, resultBinding, scopes)
      ) {
        didCacheResult = true;
        return false;
      }
    });
    if (!didCacheResult) {
      didFindUncachedCall = true;
      return false;
    }
  });
  return didFindCall && !didFindUncachedCall;
};

const isGuardBranchOf = (parent: EsTreeNode, node: EsTreeNode): boolean =>
  (isNodeOfType(parent, "LogicalExpression") &&
    (stripParenExpression(parent.left) === stripParenExpression(node) ||
      stripParenExpression(parent.right) === stripParenExpression(node))) ||
  (isNodeOfType(parent, "ConditionalExpression") &&
    (stripParenExpression(parent.consequent) === stripParenExpression(node) ||
      stripParenExpression(parent.alternate) === stripParenExpression(node)));

const isStateSetterCallee = (callee: EsTreeNode): boolean =>
  isNodeOfType(callee, "Identifier") && isSetterIdentifier(callee.name);

const SET_ATTRIBUTE_URL_NAMES = new Set(["href", "src"]);

const isUrlSetAttributeCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  urlArgument: EsTreeNode,
): boolean => {
  const callee = call.callee;
  if (!isMemberProperty(callee, "setAttribute") || callee.computed) return false;
  const [attributeName, attributeValue] = call.arguments;
  if (!attributeName || !attributeValue) return false;
  if (!isNodeOfType(attributeName, "Literal") || typeof attributeName.value !== "string") {
    return false;
  }
  if (!SET_ATTRIBUTE_URL_NAMES.has(attributeName.value)) return false;
  return stripParenExpression(attributeValue) === stripParenExpression(urlArgument);
};

const isDirectIfBranchStatement = (assignment: EsTreeNode): boolean => {
  const statement = findTransparentExpressionRoot(assignment).parent ?? null;
  if (!statement || !isNodeOfType(statement, "ExpressionStatement")) return false;
  let container = statement.parent ?? null;
  if (container && isNodeOfType(container, "BlockStatement")) container = container.parent ?? null;
  return container !== null && isNodeOfType(container, "IfStatement");
};

const escapeIsLeaky = (callNode: EsTreeNode): boolean => {
  let topNode = callNode;
  let guarded = false;
  let parent = findTransparentExpressionRoot(topNode).parent ?? null;
  while (parent && isGuardBranchOf(parent, topNode)) {
    guarded = true;
    topNode = parent;
    parent = findTransparentExpressionRoot(topNode).parent ?? null;
  }
  if (!parent) return false;

  if (
    isNodeOfType(parent, "AssignmentExpression") &&
    stripParenExpression(parent.right) === stripParenExpression(topNode)
  ) {
    const target = parent.left;
    if (
      isNodeOfType(target, "MemberExpression") &&
      !target.computed &&
      isNodeOfType(target.property, "Identifier") &&
      ESCAPE_ASSIGNMENT_TARGET_PROPERTIES.has(target.property.name)
    ) {
      return true;
    }
    // The guarded creation assigned to a pre-declared variable is the same
    // "object URL for fetched data" leak as the guarded VariableDeclarator.
    if (isNodeOfType(target, "Identifier")) {
      return guarded || isDirectIfBranchStatement(parent);
    }
    return false;
  }

  if (isNodeOfType(parent, "ReturnStatement")) return true;

  if (
    isNodeOfType(parent, "ArrowFunctionExpression") &&
    stripParenExpression(parent.body) === stripParenExpression(topNode)
  ) {
    return true;
  }

  if (isNodeOfType(parent, "JSXExpressionContainer") && parent.parent) {
    return isNodeOfType(parent.parent, "JSXAttribute");
  }

  // A conditional/logical creation stored in a variable is the
  // "object URL for fetched data, kept in state" leak; an unguarded
  // `const x = URL.createObjectURL(file)` is the ambiguous
  // avatar/preview case the spec keeps quiet.
  if (
    isNodeOfType(parent, "VariableDeclarator") &&
    parent.init &&
    stripParenExpression(parent.init) === stripParenExpression(topNode)
  ) {
    return guarded;
  }

  // Passed directly to a state setter (`setImageUrl(URL.createObjectURL(...))`)
  // or set as an element URL attribute (`a.setAttribute('href', ...)`).
  if (isNodeOfType(parent, "CallExpression")) {
    if (isStateSetterCallee(parent.callee)) return true;
    if (isUrlSetAttributeCall(parent, topNode)) return true;
  }

  return false;
};

// Flags `URL.createObjectURL(...)` whose produced URL escapes (assigned to
// an element `href`/`src` directly or via `setAttribute`, stored into a ref,
// returned, rendered inline in JSX, passed to a state setter, or a guarded
// value bound to a variable — declared or assigned)
// when the module never references `URL.revokeObjectURL`. The blob URL
// pins its Blob/File in memory until revoked, so an un-revoked URL leaks.
export const noCreateObjectUrlWithoutRevoke = defineRule({
  id: "no-create-object-url-without-revoke",
  title: "createObjectURL without revokeObjectURL",
  tags: ["test-noise"],
  severity: "warn",
  category: "Performance",
  recommendation:
    "Call `URL.revokeObjectURL(url)` once the object URL is no longer needed (after the download, in a `useEffect` cleanup, or on unmount). An object URL keeps its Blob/File alive for the document lifetime until it is revoked.",
  create: (context: RuleContext) => {
    let moduleHasRevoke = false;
    let programRoot: EsTreeNode | null = null;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        programRoot = node;
        moduleHasRevoke = moduleCallsRevoke(node, context.scopes);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (moduleHasRevoke) return;
        if (!isCreateObjectUrlCall(node, context.scopes)) return;
        if (!escapeIsLeaky(node)) return;
        if (programRoot && moduleCachesEveryReturnedResult(node, programRoot, context.scopes))
          return;
        context.report({ node, message: MESSAGE });
      },
    };
  },
});
