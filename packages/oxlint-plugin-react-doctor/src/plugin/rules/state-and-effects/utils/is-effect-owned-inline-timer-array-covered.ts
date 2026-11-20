import { hasOrdinaryViteReactProvider } from "./has-ordinary-vite-react-provider.js";
import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "../../../utils/is-proven-unmodified-global-namespace-reference.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { isSynchronousIteratorCall } from "../../../utils/is-synchronous-iterator-callback.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

type Call = EsTreeNodeOfType<"CallExpression">;
type Member = EsTreeNodeOfType<"MemberExpression">;

const getMethod = (node: EsTreeNode | null | undefined, name?: string): Member | null => {
  if (!isNodeOfType(node, "CallExpression") || node.optional) return null;
  const callee = node.callee;
  return isNodeOfType(callee, "MemberExpression") &&
    !callee.optional &&
    !callee.computed &&
    isNodeOfType(callee.property, "Identifier") &&
    (name === undefined || callee.property.name === name)
    ? callee
    : null;
};

const getPlainConst = (
  node: EsTreeNode | null | undefined,
  context: RuleContext,
): SymbolDescriptor | null => {
  if (!isNodeOfType(node, "Identifier")) return null;
  const symbol = context.scopes.symbolFor(node);
  return symbol?.kind === "const" &&
    symbol.initializer &&
    isNodeOfType(symbol.declarationNode, "VariableDeclarator") &&
    symbol.declarationNode.id === symbol.bindingIdentifier &&
    hasCompleteSymbolReferences(symbol, context.scopes.rootScope.node, context.scopes) &&
    symbol.references.every(({ flag }) => flag === "read")
    ? symbol
    : null;
};

const getReturnedCall = (node: EsTreeNode | null | undefined): Call | null => {
  if (!isNodeOfType(node, "ArrowFunctionExpression") || node.async) return null;
  const body = stripParenExpression(node.body);
  if (isNodeOfType(body, "CallExpression")) return body;
  if (!isNodeOfType(body, "BlockStatement") || body.body.length !== 1) return null;
  const [statement] = body.body;
  return isNodeOfType(statement, "ExpressionStatement") &&
    isNodeOfType(statement.expression, "CallExpression")
    ? statement.expression
    : null;
};

const isStockGlobal = (node: EsTreeNode, name: string, context: RuleContext): boolean =>
  isNodeOfType(node, "Identifier") &&
  node.name === name &&
  context.scopes.isGlobalReference(node) &&
  isProvenUnmodifiedGlobalNamespaceReference(node, name, context.scopes, undefined, true);

const isPlainArrayOrigin = (
  expression: EsTreeNode,
  context: RuleContext,
  remainingDepth = 2,
): boolean => {
  if (isNodeOfType(expression, "ArrayExpression")) return true;
  if (remainingDepth === 0 || !isNodeOfType(expression, "CallExpression")) return false;
  const method = getMethod(expression);
  if (!method || !isNodeOfType(method.property, "Identifier") || expression.arguments.length !== 1)
    return false;
  const [argument] = expression.arguments;
  if (method.property.name === "from") {
    return (
      !isNodeOfType(argument, "SpreadElement") && isStockGlobal(method.object, "Array", context)
    );
  }
  if (method.property.name !== "filter") return false;
  return (
    isClosedFilterArgument(argument) &&
    isPlainArrayOrigin(method.object, context, remainingDepth - 1)
  );
};

const isClosedFilterArgument = (node: EsTreeNode | undefined): boolean =>
  isNodeOfType(node, "ArrowFunctionExpression") &&
  !node.async &&
  node.params.length < 3 &&
  node.params.every((param) => isNodeOfType(param, "Identifier"));

const isNamedReactHook = (node: EsTreeNode, name: string, context: RuleContext): boolean => {
  if (!isNodeOfType(node, "Identifier")) return false;
  const hook = context.scopes.symbolFor(node);
  if (
    !hook ||
    getValueImportSource(hook) !== "react" ||
    !isNodeOfType(hook.declarationNode, "ImportSpecifier") ||
    getImportedName(hook.declarationNode) !== name ||
    hook.references.some(({ flag }) => flag !== "read")
  )
    return false;
  // A same-file mutable React object can change a transpiled named import.
  return context.scopes.rootScope.symbols.every((symbol) => {
    if (getValueImportSource(symbol) !== "react") return true;
    return (
      isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
      getImportedName(symbol.declarationNode) !== "default"
    );
  });
};

const getOwnedSetReceiver = (
  reference: EsTreeNode,
  context: RuleContext,
): SymbolDescriptor | null => {
  const symbol = getPlainConst(reference, context);
  const initializer = symbol?.initializer;
  if (
    !symbol ||
    !isNodeOfType(initializer, "CallExpression") ||
    initializer.optional ||
    initializer.arguments.length !== 1 ||
    !isNamedReactHook(initializer.callee, "useRef", context)
  )
    return null;
  const [set] = initializer.arguments;
  if (
    !isNodeOfType(set, "NewExpression") ||
    set.arguments.length !== 0 ||
    !isStockGlobal(set.callee, "Set", context)
  )
    return null;
  for (const read of symbol.references) {
    const current = read.identifier.parent;
    const operation = current?.parent;
    const call = operation?.parent;
    if (
      !isNodeOfType(current, "MemberExpression") ||
      current.object !== read.identifier ||
      current.optional ||
      current.computed ||
      !isNodeOfType(current.property, "Identifier") ||
      current.property.name !== "current" ||
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== operation ||
      !isNodeOfType(operation, "MemberExpression") ||
      operation.object !== current ||
      getMethod(call) !== operation ||
      !isNodeOfType(operation.property, "Identifier") ||
      call.arguments.length !== 1
    )
      return null;
    const operationName = operation.property.name;
    if (operationName === "add") {
      if (!isNodeOfType(call.parent, "ExpressionStatement")) return null;
    } else if (operationName !== "has" && operationName !== "delete") return null;
  }
  return symbol;
};

const isOwnedSetAdd = (
  statement: EsTreeNode,
  iteration: EsTreeNodeOfType<"ArrowFunctionExpression">,
  context: RuleContext,
): boolean => {
  if (
    !isNodeOfType(statement, "ExpressionStatement") ||
    !isNodeOfType(statement.expression, "CallExpression")
  )
    return false;
  const call = statement.expression;
  const current = getMethod(call, "add")?.object;
  if (
    !isNodeOfType(current, "MemberExpression") ||
    !isNodeOfType(current.object, "Identifier") ||
    !isNodeOfType(iteration.params[0], "Identifier") ||
    call.arguments.length !== 1
  )
    return false;
  const parameter = context.scopes.symbolFor(iteration.params[0]);
  const [argument] = call.arguments;
  return Boolean(
    parameter &&
    isNodeOfType(argument, "Identifier") &&
    context.scopes.symbolFor(argument) === parameter &&
    getOwnedSetReceiver(current.object, context),
  );
};

const BROWSER_WINDOW_PROPERTIES = new Set([
  "defaultView",
  "contentWindow",
  "ownerDocument",
  "opener",
  "top",
  "parent",
  "frames",
  "window",
  "self",
  "global",
  "globalThis",
]);
const NATIVE_LIFECYCLE_METHOD_NAMES = new Set([
  "setTimeout",
  "clearTimeout",
  "from",
  "filter",
  "forEach",
  "push",
  "add",
  "has",
  "delete",
]);
const PROTOTYPE_PROPERTIES = new Set(["prototype", "__proto__", "constructor"]);
const GLOBAL_OBJECT_NAMES = new Set(["window", "self", "global", "globalThis", "document"]);
const OPAQUE_GLOBAL_NAMES = new Set(["Reflect", "eval", "Function", "require"]);

const isDirectGlobalObjectRead = (node: EsTreeNode, context: RuleContext): boolean => {
  const parent = node.parent;
  if (
    isNodeOfType(parent, "UnaryExpression") &&
    parent.operator === "typeof" &&
    parent.argument === node
  )
    return true;
  return (
    isNodeOfType(parent, "MemberExpression") &&
    parent.object === node &&
    !parent.optional &&
    getResolvedStaticPropertyName(parent, context.scopes) !== null
  );
};

const opaqueProviderAccessByScope = new WeakMap<RuleContext["scopes"], boolean>();
const hasOpaqueProviderAccess = (context: RuleContext): boolean => {
  const cached = opaqueProviderAccessByScope.get(context.scopes);
  if (cached !== undefined) return cached;
  let opaque = false;
  walkAst(context.scopes.rootScope.node, (node) => {
    if (opaque) return false;
    if (
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "TSImportEqualsDeclaration") ||
      (isNodeOfType(node, "Literal") &&
        (node.value === "node:module" || node.value === "module" || node.value === "require"))
    ) {
      opaque = true;
      return false;
    }
    if (isNodeOfType(node, "Identifier") && context.scopes.isGlobalReference(node)) {
      if (
        OPAQUE_GLOBAL_NAMES.has(node.name) ||
        (GLOBAL_OBJECT_NAMES.has(node.name) && !isDirectGlobalObjectRead(node, context))
      ) {
        opaque = true;
        return false;
      }
      if (node.name === "Object") {
        const member = node.parent;
        const call = member?.parent;
        if (
          !isNodeOfType(call, "CallExpression") ||
          getMethod(call, "keys") !== member ||
          !isStockGlobal(node, "Object", context)
        )
          opaque = true;
      }
    }
    if (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern")) {
      const key = node.key;
      const name = isNodeOfType(key, "Identifier")
        ? key.name
        : isNodeOfType(key, "Literal") && typeof key.value === "string"
          ? key.value
          : null;
      if (
        node.computed ||
        (name !== null && (PROTOTYPE_PROPERTIES.has(name) || BROWSER_WINDOW_PROPERTIES.has(name)))
      ) {
        opaque = true;
        return false;
      }
    }
    if (!isNodeOfType(node, "MemberExpression")) return;
    const name = getResolvedStaticPropertyName(node, context.scopes);
    if (
      (name !== null && (PROTOTYPE_PROPERTIES.has(name) || BROWSER_WINDOW_PROPERTIES.has(name))) ||
      ((name === null || NATIVE_LIFECYCLE_METHOD_NAMES.has(name)) && isWithinAssignmentTarget(node))
    ) {
      opaque = true;
      return false;
    }
    if (node.computed && name === null) {
      const receiver = stripParenExpression(node.object);
      const origin = getPlainConst(receiver, context)?.initializer ?? receiver;
      const value = stripParenExpression(origin);
      if (
        isPlainArrayOrigin(value, context) ||
        (isNodeOfType(value, "NewExpression") && isStockGlobal(value.callee, "Set", context))
      ) {
        opaque = true;
        return false;
      }
    }
  });
  opaqueProviderAccessByScope.set(context.scopes, opaque);
  return opaque;
};

export const isEffectOwnedInlineTimerArrayCovered = (
  effect: EsTreeNode,
  allocation: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (
    !isNodeOfType(effect, "ArrowFunctionExpression") ||
    !isNodeOfType(effect.body, "BlockStatement") ||
    !isNodeOfType(allocation, "CallExpression") ||
    allocation.optional ||
    allocation.arguments.length !== 2 ||
    !isStockGlobal(allocation.callee, "setTimeout", context)
  )
    return false;
  const hook = effect.parent;
  if (
    !isNodeOfType(hook, "CallExpression") ||
    hook.optional ||
    hook.arguments[0] !== effect ||
    !isNamedReactHook(hook.callee, "useEffect", context)
  )
    return false;
  const [timerCallback, delay] = allocation.arguments;
  if (
    (!isNodeOfType(timerCallback, "ArrowFunctionExpression") &&
      !isNodeOfType(timerCallback, "FunctionExpression")) ||
    !isNodeOfType(delay, "Literal") ||
    typeof delay.value !== "number"
  )
    return false;

  const declaration = allocation.parent;
  if (!isNodeOfType(declaration, "VariableDeclarator") || declaration.init !== allocation)
    return false;
  const handle = getPlainConst(declaration.id, context);
  const declarationStatement = declaration.parent;
  const iterationBody = declarationStatement?.parent;
  const iteration = iterationBody?.parent;
  if (
    !handle ||
    handle.references.length !== 1 ||
    !isNodeOfType(declarationStatement, "VariableDeclaration") ||
    declarationStatement.declarations.length !== 1 ||
    !isNodeOfType(iterationBody, "BlockStatement") ||
    !isNodeOfType(iteration, "ArrowFunctionExpression") ||
    iteration.async ||
    iteration.params.length !== 1 ||
    !isNodeOfType(iteration.params[0], "Identifier")
  )
    return false;

  const prelude = iterationBody.body.slice(0, -2);
  const [lastDeclaration, append] = iterationBody.body.slice(-2);
  if (
    lastDeclaration !== declarationStatement ||
    prelude.length > 1 ||
    (prelude[0] && !isOwnedSetAdd(prelude[0], iteration, context)) ||
    !isNodeOfType(append, "ExpressionStatement") ||
    !isNodeOfType(append.expression, "CallExpression")
  )
    return false;
  const push = append.expression;
  const pushMethod = getMethod(push, "push");
  if (
    !pushMethod ||
    push.arguments.length !== 1 ||
    push.arguments[0] !== handle.references[0].identifier
  )
    return false;
  const buffer = getPlainConst(pushMethod.object, context);
  if (
    !buffer ||
    !isNodeOfType(buffer.initializer, "ArrayExpression") ||
    buffer.initializer.elements.length !== 0 ||
    buffer.references.length !== 2
  )
    return false;

  const loop = iteration.parent;
  const loopMethod = getMethod(loop, "forEach");
  const loopStatement = loop?.parent;
  if (
    !isNodeOfType(loop, "CallExpression") ||
    !loopMethod ||
    loop.arguments.length !== 1 ||
    loop.arguments[0] !== iteration ||
    !isNodeOfType(loopStatement, "ExpressionStatement") ||
    loopStatement.expression !== loop ||
    loopStatement.parent !== effect.body ||
    !isSynchronousIteratorCall(loop, iteration, context.scopes)
  )
    return false;
  const input = getPlainConst(loopMethod.object, context);
  if (!input?.initializer || !isPlainArrayOrigin(stripParenExpression(input.initializer), context))
    return false;
  for (const reference of input.references) {
    const member = reference.identifier.parent;
    if (member === loopMethod) continue;
    if (
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== reference.identifier ||
      member.optional ||
      member.computed ||
      !isNodeOfType(member.property, "Identifier")
    )
      return false;
    if (
      member.property.name === "length" &&
      isNodeOfType(member.parent, "BinaryExpression") &&
      (member.parent.operator === "===" || member.parent.operator === "!==")
    )
      continue;
    const filter = member.parent;
    if (
      !isNodeOfType(filter, "CallExpression") ||
      getMethod(filter, "filter") !== member ||
      filter.arguments.length !== 1 ||
      !isClosedFilterArgument(filter.arguments[0])
    )
      return false;
  }

  const [bufferDeclaration, setupLoop, returnStatement] = effect.body.body.slice(-3);
  if (
    setupLoop !== loopStatement ||
    buffer.declarationNode.parent !== bufferDeclaration ||
    !isNodeOfType(returnStatement, "ReturnStatement") ||
    !isNodeOfType(returnStatement.argument, "ArrowFunctionExpression") ||
    returnStatement.argument.params.length !== 0
  )
    return false;
  const cleanup = getReturnedCall(returnStatement.argument);
  const cleanupMethod = getMethod(cleanup, "forEach");
  if (
    !cleanup ||
    !cleanupMethod ||
    cleanup.arguments.length !== 1 ||
    !isNodeOfType(cleanupMethod.object, "Identifier") ||
    context.scopes.symbolFor(cleanupMethod.object) !== buffer
  )
    return false;
  const [release] = cleanup.arguments;
  if (
    !isNodeOfType(release, "ArrowFunctionExpression") ||
    release.params.length !== 1 ||
    !isNodeOfType(release.params[0], "Identifier")
  )
    return false;
  const clear = getReturnedCall(release);
  if (
    !clear ||
    clear.optional ||
    clear.arguments.length !== 1 ||
    !isStockGlobal(clear.callee, "clearTimeout", context)
  )
    return false;
  const [released] = clear.arguments;
  const releaseParameter = context.scopes.symbolFor(release.params[0]);
  return Boolean(
    releaseParameter &&
    isNodeOfType(released, "Identifier") &&
    context.scopes.symbolFor(released) === releaseParameter &&
    !hasOpaqueProviderAccess(context) &&
    hasOrdinaryViteReactProvider(context.filename),
  );
};
