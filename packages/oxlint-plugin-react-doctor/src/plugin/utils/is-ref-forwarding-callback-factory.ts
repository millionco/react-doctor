import type { SourceProjectModule } from "./build-source-project-index.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactHookCall } from "./is-react-hook-call.js";
import { stripParenExpression } from "./strip-paren-expression.js";
export const isRefForwardingCallbackFactory = (
  module: SourceProjectModule,
  node: EsTreeNode,
): boolean => {
  if (
    !isNodeOfType(node, "FunctionDeclaration") ||
    node.async ||
    node.generator ||
    node.params.length !== 1 ||
    !isNodeOfType(node.params[0], "Identifier") ||
    !node.body ||
    node.body.body.length !== 3
  )
    return false;
  const scopes = module.scopes;
  const same = (a: EsTreeNode, b: EsTreeNode) =>
    Boolean(scopes.symbolFor(a) && scopes.symbolFor(a) === scopes.symbolFor(b));
  const [declaration, effect, returned] = node.body.body;
  if (
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    declaration.declarations.length !== 1
  )
    return false;
  const ref = declaration.declarations[0];
  if (
    !isNodeOfType(ref.id, "Identifier") ||
    !ref.init ||
    !isNodeOfType(ref.init, "CallExpression") ||
    !isReactHookCall(ref.init, new Set(["useRef"]), scopes) ||
    ref.init.arguments.length !== 1 ||
    !same(ref.init.arguments[0], node.params[0])
  )
    return false;
  if (
    !isNodeOfType(effect, "ExpressionStatement") ||
    !isNodeOfType(effect.expression, "CallExpression") ||
    effect.expression.optional ||
    effect.expression.arguments.length !== 1 ||
    !isNodeOfType(effect.expression.arguments[0], "ArrowFunctionExpression")
  )
    return false;
  const writeClosure = effect.expression.arguments[0];
  if (
    writeClosure.async ||
    writeClosure.params.length ||
    !isNodeOfType(writeClosure.body, "BlockStatement") ||
    writeClosure.body.body.length !== 1 ||
    !isNodeOfType(writeClosure.body.body[0], "ExpressionStatement")
  )
    return false;
  const write = writeClosure.body.body[0].expression;
  const member = (input: EsTreeNode) => {
    const value = stripParenExpression(input);
    return (
      isNodeOfType(value, "MemberExpression") &&
      !value.computed &&
      !value.optional &&
      same(value.object, ref.id) &&
      isNodeOfType(value.property, "Identifier") &&
      value.property.name === "current"
    );
  };
  if (
    !isNodeOfType(write, "AssignmentExpression") ||
    write.operator !== "=" ||
    !member(write.left) ||
    !same(write.right, node.params[0])
  )
    return false;
  if (
    !isNodeOfType(returned, "ReturnStatement") ||
    !returned.argument ||
    !isNodeOfType(returned.argument, "CallExpression") ||
    !isReactHookCall(returned.argument, new Set(["useCallback"]), scopes) ||
    returned.argument.arguments.length !== 2 ||
    !isNodeOfType(returned.argument.arguments[1], "ArrayExpression") ||
    returned.argument.arguments[1].elements.length
  )
    return false;
  const forward = returned.argument.arguments[0];
  if (
    !isNodeOfType(forward, "ArrowFunctionExpression") ||
    forward.async ||
    forward.params.length !== 1 ||
    !isNodeOfType(forward.params[0], "RestElement") ||
    !isNodeOfType(forward.params[0].argument, "Identifier")
  )
    return false;
  const invoke = stripParenExpression(forward.body);
  if (
    !isNodeOfType(invoke, "CallExpression") ||
    !member(invoke.callee) ||
    invoke.arguments.length !== 1 ||
    !isNodeOfType(invoke.arguments[0], "SpreadElement") ||
    !same(invoke.arguments[0].argument, forward.params[0].argument)
  )
    return false;
  return [node.params[0], ref.id, forward.params[0].argument].every((id, index) => {
    const symbol = scopes.symbolFor(id);
    return (
      symbol &&
      hasCompleteSymbolReferences(symbol, module.programNode, scopes) &&
      symbol.references.length === (index === 2 ? 1 : 2) &&
      symbol.references.every((ref) => ref.flag === "read")
    );
  });
};
