import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getCallbackStatements } from "../../../utils/get-callback-statements.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getStaticKeyName } from "../../../utils/get-static-key-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getSymbolTypeAnnotation } from "../../../utils/get-symbol-type-annotation.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isKeyedDraftTypeReference } from "../../../utils/is-keyed-draft-type-reference.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNodeReachableWithinFunction } from "../../../utils/is-node-reachable-within-function.js";
import { resolveReactUseStatePair } from "../../../utils/resolve-react-use-state-pair.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { someAst } from "../../../utils/some-ast.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

const CLOSED_REACT_METHODS: ReadonlySet<string> = new Set([
  "memo",
  "useEffect",
  "useRef",
  "useState",
]);
const closedReactDefaults = new WeakMap<SymbolDescriptor, boolean>();

const getReactDefaultReceiver = (
  call: EsTreeNode | null | undefined,
  api: string,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  if (!isNodeOfType(call, "CallExpression") || call.optional) return null;
  const callee = stripParenExpression(call.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    callee.optional ||
    getStaticPropertyName(callee) !== api ||
    !isNodeOfType(callee.object, "Identifier")
  )
    return null;
  const receiver = scopes.symbolFor(callee.object);
  if (!receiver || !isNodeOfType(receiver.declarationNode, "ImportDefaultSpecifier")) return null;
  const declaration = getImportDeclarationForSymbol(receiver);
  return declaration?.source.value === "react" && declaration.importKind !== "type"
    ? receiver
    : null;
};

const hasClosedReactDefault = (receiver: SymbolDescriptor, scopes: ScopeAnalysis): boolean => {
  const cached = closedReactDefaults.get(receiver);
  if (cached !== undefined) return cached;
  const program = scopes.rootScope.node;
  const closed =
    hasCompleteSymbolReferences(receiver, program, scopes) &&
    receiver.references.every(({ flag, identifier }) => {
      if (isKeyedDraftTypeReference(identifier)) return true;
      const member = identifier.parent;
      const call = member?.parent;
      if (
        flag !== "read" ||
        !isNodeOfType(member, "MemberExpression") ||
        member.object !== identifier ||
        member.computed ||
        member.optional ||
        !isNodeOfType(call, "CallExpression") ||
        call.callee !== member ||
        call.optional
      )
        return false;
      const method = getStaticPropertyName(member);
      return method !== null && CLOSED_REACT_METHODS.has(method);
    }) &&
    !someAst(program, (node) => {
      if (isNodeOfType(node, "ImportExpression")) return true;
      if (isNodeOfType(node, "Identifier") && (node.name === "eval" || node.name === "require"))
        return !isKeyedDraftTypeReference(node);
      if (!isNodeOfType(node, "ImportDeclaration") || node.importKind === "type") return false;
      if (node.source.value === "module" || node.source.value === "node:module") return true;
      return (
        node.source.value === "react" &&
        node.specifiers.some(
          (specifier) =>
            specifier !== receiver.declarationNode &&
            (isNodeOfType(specifier, "ImportNamespaceSpecifier") ||
              isNodeOfType(specifier, "ImportDefaultSpecifier") ||
              (isNodeOfType(specifier, "ImportSpecifier") &&
                specifier.importKind !== "type" &&
                getImportedName(specifier) === "default")),
        )
      );
    });
  closedReactDefaults.set(receiver, closed);
  return closed;
};

const hasExactReadReferences = (
  symbol: SymbolDescriptor,
  allowed: ReadonlySet<EsTreeNode>,
  scopes: ScopeAnalysis,
): boolean => {
  const binding = symbol.bindingIdentifier;
  const property = binding.parent;
  const pattern = property?.parent;
  const declarationKey =
    isNodeOfType(property, "Property") &&
    property.shorthand &&
    !property.computed &&
    property.value === binding &&
    isNodeOfType(pattern, "ObjectPattern") &&
    isNodeOfType(symbol.declarationNode, "VariableDeclarator") &&
    symbol.declarationNode.id === pattern
      ? property.key
      : null;
  const references = symbol.references.filter(
    ({ identifier }) => identifier !== binding && identifier !== declarationKey,
  );
  return (
    references.length === allowed.size &&
    references.every(({ flag, identifier }) => flag === "read" && allowed.has(identifier)) &&
    hasCompleteSymbolReferences(symbol, scopes.rootScope.node, scopes)
  );
};

const isOptionalStringProp = (
  input: SymbolDescriptor,
  owner: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const declaration = input.declarationNode;
  const property = input.bindingIdentifier.parent;
  if (
    input.kind !== "const" ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "ObjectPattern") ||
    !isNodeOfType(declaration.init, "Identifier") ||
    !isNodeOfType(property, "Property") ||
    property.parent !== declaration.id ||
    property.value !== input.bindingIdentifier ||
    property.computed ||
    findEnclosingFunction(declaration) !== owner ||
    !isNodeOfType(owner, "ArrowFunctionExpression")
  )
    return false;
  const key = getStaticKeyName(property.key);
  const props = scopes.symbolFor(declaration.init);
  if (
    !key ||
    !props ||
    props.kind !== "parameter" ||
    !isNodeOfType(props.bindingIdentifier, "Identifier") ||
    owner.params.length !== 1 ||
    owner.params[0] !== props.bindingIdentifier ||
    !hasExactReadReferences(props, new Set([declaration.init]), scopes)
  )
    return false;
  const type = getSymbolTypeAnnotation(props);
  if (!isNodeOfType(type, "TSTypeLiteral")) return false;
  const matching = type.members.filter(
    (member) =>
      isNodeOfType(member, "TSPropertySignature") &&
      !member.computed &&
      getStaticKeyName(member.key) === key,
  );
  const [optional] = matching;
  return (
    matching.length === 1 &&
    isNodeOfType(optional, "TSPropertySignature") &&
    optional.optional === true &&
    isNodeOfType(optional.typeAnnotation?.typeAnnotation, "TSStringKeyword")
  );
};

const isReturnedJsxStateRead = (
  identifier: EsTreeNode,
  owner: EsTreeNode,
  context: RuleContext,
): boolean => {
  let current = findTransparentExpressionRoot(identifier);
  const container = current.parent;
  if (!isNodeOfType(container, "JSXExpressionContainer") || container.expression !== current)
    return false;
  current = container;
  while (isNodeOfType(current.parent, "JSXElement") || isNodeOfType(current.parent, "JSXFragment"))
    current = current.parent;
  if (!isNodeOfType(current, "JSXElement") && !isNodeOfType(current, "JSXFragment")) return false;
  const result = findTransparentExpressionRoot(current);
  return (
    isNodeOfType(result.parent, "ReturnStatement") &&
    result.parent.argument === result &&
    findEnclosingFunction(result) === owner &&
    isNodeReachableWithinFunction(result.parent, context)
  );
};

export const isRetainedOptionalStringProp = (
  effect: EsTreeNode,
  write: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (
    !isNodeOfType(effect, "CallExpression") ||
    effect.arguments.length !== 2 ||
    !isNodeOfType(write, "CallExpression") ||
    write.optional ||
    write.arguments.length !== 1 ||
    !isNodeOfType(write.callee, "Identifier")
  )
    return false;
  const callback = stripParenExpression(effect.arguments[0]);
  const dependencies = stripParenExpression(effect.arguments[1]);
  const owner = findEnclosingFunction(effect);
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== 0 ||
    !isNodeOfType(dependencies, "ArrayExpression") ||
    dependencies.elements.length !== 1 ||
    !isNodeOfType(owner, "ArrowFunctionExpression") ||
    !isNodeOfType(owner.body, "BlockStatement") ||
    !isNodeOfType(effect.parent, "ExpressionStatement") ||
    effect.parent.parent !== owner.body ||
    !isNodeReachableWithinFunction(effect, context)
  )
    return false;
  const [guard, update] = getCallbackStatements(callback);
  if (
    !isNodeOfType(guard, "IfStatement") ||
    guard.alternate ||
    !isNodeOfType(update, "ExpressionStatement") ||
    stripParenExpression(update.expression) !== write
  )
    return false;
  const test = stripParenExpression(guard.test);
  const branch = guard.consequent;
  const exit =
    isNodeOfType(branch, "BlockStatement") && branch.body.length === 1 ? branch.body[0] : branch;
  if (
    !isNodeOfType(exit, "ReturnStatement") ||
    exit.argument ||
    !isNodeOfType(test, "UnaryExpression") ||
    test.operator !== "!"
  )
    return false;

  const condition = stripParenExpression(test.argument);
  const input = stripParenExpression(write.arguments[0]);
  const dependency = dependencies.elements[0];
  const scopes = context.scopes;
  if (
    !isNodeOfType(condition, "Identifier") ||
    !isNodeOfType(input, "Identifier") ||
    !isNodeOfType(dependency, "Identifier")
  )
    return false;

  const symbol = scopes.symbolFor(input);
  const pair = resolveReactUseStatePair(write.callee, scopes);
  const hook = pair?.declarator.init;
  if (
    !symbol ||
    !pair?.stateSymbol ||
    pair.setterSymbol.kind !== "const" ||
    pair.stateSymbol.kind !== "const" ||
    scopes.symbolFor(write.callee) !== pair.setterSymbol ||
    findEnclosingFunction(pair.declarator) !== owner ||
    !isNodeOfType(hook, "CallExpression") ||
    hook.arguments.length !== 1
  )
    return false;
  const initialized = stripParenExpression(hook.arguments[0]);
  if (
    !isNodeOfType(initialized, "Identifier") ||
    scopes.symbolFor(initialized) !== symbol ||
    scopes.symbolFor(condition) !== symbol ||
    scopes.symbolFor(dependency) !== symbol ||
    !hasExactReadReferences(symbol, new Set([initialized, condition, input, dependency]), scopes) ||
    !isOptionalStringProp(symbol, owner, scopes) ||
    !hasExactReadReferences(pair.setterSymbol, new Set([write.callee]), scopes) ||
    !hasCompleteSymbolReferences(pair.stateSymbol, scopes.rootScope.node, scopes) ||
    pair.stateSymbol.references.some(({ flag }) => flag !== "read") ||
    !pair.stateSymbol.references.some(({ identifier }) =>
      isReturnedJsxStateRead(identifier, owner, context),
    )
  )
    return false;

  const receiver = getReactDefaultReceiver(effect, "useEffect", scopes);
  const ownerRoot = findTransparentExpressionRoot(owner);
  const memo = ownerRoot.parent;
  return Boolean(
    receiver &&
    getReactDefaultReceiver(hook, "useState", scopes) === receiver &&
    isNodeOfType(memo, "CallExpression") &&
    memo.arguments[0] === ownerRoot &&
    getReactDefaultReceiver(memo, "memo", scopes) === receiver &&
    hasClosedReactDefault(receiver, scopes),
  );
};
