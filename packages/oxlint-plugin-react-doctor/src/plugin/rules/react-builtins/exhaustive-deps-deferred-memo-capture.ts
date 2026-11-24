import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getDirectConstInitializer } from "../../utils/get-direct-const-initializer.js";
import { getImportDeclarationForSymbol } from "../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { hasCompleteSymbolReferences } from "../../utils/has-complete-symbol-references.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isSymbolReadOnly } from "../../utils/is-symbol-read-only.js";
import { walkAst } from "../../utils/walk-ast.js";
import { unwrapExpression } from "./exhaustive-deps-low-level.js";

interface NamedImport {
  readonly source: string;
  readonly name: string;
}

interface DeferredMemoCapture {
  readonly guard: EsTreeNode;
  readonly factory: NamedImport;
}

const getDirectNamedImport = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): NamedImport | null => {
  const node = unwrapExpression(expression);
  if (!isNodeOfType(node, "Identifier")) return null;
  const symbol = scopes.symbolFor(node);
  const declaration = symbol && getImportDeclarationForSymbol(symbol);
  const specifier = symbol?.declarationNode;
  if (
    !declaration ||
    declaration.importKind === "type" ||
    typeof declaration.source.value !== "string" ||
    !isNodeOfType(specifier, "ImportSpecifier") ||
    specifier.importKind === "type"
  ) {
    return null;
  }
  const name = getImportedName(specifier);
  return name ? { source: declaration.source.value, name } : null;
};

const isNamedReactCall = (
  call: EsTreeNodeOfType<"CallExpression">,
  name: string,
  scopes: ScopeAnalysis,
): boolean => {
  const imported = getDirectNamedImport(call.callee, scopes);
  return !call.optional && imported?.source === "react" && imported.name === name;
};

const getOnlyCallbackExpression = (body: EsTreeNode): EsTreeNode | null => {
  if (!isNodeOfType(body, "BlockStatement")) return body;
  if (body.body.length !== 1 || !isNodeOfType(body.body[0], "ExpressionStatement")) return null;
  return body.body[0].expression;
};

const getCommittedCallbackMember = (
  arrow: EsTreeNodeOfType<"ArrowFunctionExpression">,
  scopes: ScopeAnalysis,
): EsTreeNodeOfType<"MemberExpression"> | null => {
  const [parameter] = arrow.params;
  const body = getOnlyCallbackExpression(arrow.body);
  if (!body || arrow.async || arrow.params.length !== 1 || !isNodeOfType(parameter, "Identifier")) {
    return null;
  }
  const expression = unwrapExpression(body);
  const call = isNodeOfType(expression, "ChainExpression") ? expression.expression : expression;
  if (
    !isNodeOfType(call, "CallExpression") ||
    !call.optional ||
    call.arguments.length !== 1 ||
    !isSameBinding(call.arguments[0], parameter, scopes) ||
    !isNodeOfType(call.callee, "MemberExpression") ||
    call.callee.computed ||
    call.callee.optional ||
    getStaticPropertyName(call.callee) !== "current" ||
    !isNodeOfType(call.callee.object, "Identifier")
  ) {
    return null;
  }
  return call.callee;
};

const isSameBinding = (
  left: EsTreeNode | null | undefined,
  right: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(left, "Identifier") || !isNodeOfType(right, "Identifier")) return false;
  const binding = scopes.symbolFor(right);
  return Boolean(binding && scopes.symbolFor(left) === binding);
};

const hasCommittedRefWriter = (
  member: EsTreeNodeOfType<"MemberExpression">,
  guard: EsTreeNodeOfType<"Identifier">,
  memo: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const symbol = scopes.symbolFor(member.object);
  if (
    !symbol ||
    !isSymbolReadOnly(symbol) ||
    symbol.references.length !== 2 ||
    !hasCompleteSymbolReferences(symbol, scopes.rootScope.node, scopes)
  ) {
    return false;
  }
  const initializer = getDirectConstInitializer(symbol);
  if (
    !isNodeOfType(initializer, "CallExpression") ||
    !isNamedReactCall(initializer, "useRef", scopes) ||
    initializer.arguments.length !== 1 ||
    !isSameBinding(initializer.arguments[0], guard, scopes)
  ) {
    return false;
  }
  const writer = symbol.references.find(
    ({ identifier }) => identifier !== member.object,
  )?.identifier;
  const target = writer?.parent;
  const assignment = target?.parent;
  if (
    !isNodeOfType(target, "MemberExpression") ||
    target.object !== writer ||
    target.optional ||
    target.computed ||
    getStaticPropertyName(target) !== "current" ||
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.left !== target ||
    assignment.operator !== "=" ||
    !isSameBinding(assignment.right, guard, scopes)
  ) {
    return false;
  }
  const statement = assignment.parent;
  const block = statement?.parent;
  const effect = block?.parent;
  const call = effect?.parent;
  if (
    !isNodeOfType(statement, "ExpressionStatement") ||
    !isNodeOfType(block, "BlockStatement") ||
    block.body[0] !== statement ||
    block.body.length !== 1 ||
    !isNodeOfType(effect, "ArrowFunctionExpression") ||
    effect.params.length !== 0 ||
    effect.async ||
    !isNodeOfType(call, "CallExpression") ||
    call.arguments.length !== 2 ||
    call.arguments[0] !== effect ||
    !isNamedReactCall(call, "useEffect", scopes)
  ) {
    return false;
  }
  const deps = call.arguments[1];
  const effectStatement = call.parent;
  const owner = effectStatement?.parent;
  const declaration = memo.parent;
  const statementForMemo = declaration?.parent;
  const statementForRef = symbol.declarationNode.parent;
  if (!isNodeOfType(owner, "BlockStatement")) return false;
  const refIndex = owner.body.findIndex((child) => child === statementForRef);
  const effectIndex = owner.body.findIndex((child) => child === effectStatement);
  const memoIndex = owner.body.findIndex((child) => child === statementForMemo);
  return (
    isNodeOfType(effectStatement, "ExpressionStatement") &&
    isNodeOfType(declaration, "VariableDeclarator") &&
    declaration.init === memo &&
    isNodeOfType(statementForMemo, "VariableDeclaration") &&
    isNodeOfType(statementForRef, "VariableDeclaration") &&
    statementForMemo.parent === owner &&
    statementForRef.parent === owner &&
    refIndex >= 0 &&
    refIndex < effectIndex &&
    effectIndex < memoIndex &&
    isNodeOfType(deps, "ArrayExpression") &&
    deps.elements.length === 1 &&
    isSameBinding(deps.elements[0], guard, scopes)
  );
};

const hasClosedBindings = (guard: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const program = scopes.rootScope.node;
  const binding = scopes.symbolFor(guard);
  if (
    !binding ||
    !isSymbolReadOnly(binding) ||
    !(
      binding.kind === "const" ||
      (binding.kind === "parameter" && isNodeOfType(binding.declarationNode, "ObjectPattern"))
    ) ||
    !hasCompleteSymbolReferences(binding, program, scopes) ||
    !isNodeOfType(program, "Program")
  ) {
    return false;
  }
  let closed = true;
  walkAst(program, (node) => {
    if (!closed) return false;
    if (
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "TSImportEqualsDeclaration") ||
      (isNodeOfType(node, "Identifier") &&
        ["eval", "require", "module"].includes(node.name) &&
        scopes.referenceFor(node)) ||
      (isNodeOfType(node, "ImportDeclaration") &&
        node.importKind !== "type" &&
        (node.source.value === "module" ||
          node.source.value === "node:module" ||
          (node.source.value === "react" &&
            node.specifiers.some(
              (specifier) =>
                !isNodeOfType(specifier, "ImportSpecifier") ||
                getImportedName(specifier) === "default",
            ))))
    ) {
      closed = false;
      return false;
    }
  });
  return closed;
};

const getTruthinessOperand = (expression: EsTreeNode): EsTreeNode | null => {
  const value = unwrapExpression(expression);
  if (isNodeOfType(value, "UnaryExpression") && value.operator === "!") {
    const inner = unwrapExpression(value.argument);
    if (isNodeOfType(inner, "UnaryExpression") && inner.operator === "!") return inner.argument;
  }
  if (isNodeOfType(value, "ConditionalExpression")) {
    const consequent = unwrapExpression(value.consequent);
    const alternate = unwrapExpression(value.alternate);
    if (
      isNodeOfType(consequent, "Literal") &&
      consequent.value === true &&
      isNodeOfType(alternate, "Literal") &&
      alternate.value === false
    ) {
      return value.test;
    }
  }
  return null;
};

export const readDeferredMemoCaptureShape = (
  call: EsTreeNodeOfType<"CallExpression">,
  callback: EsTreeNode,
  deps: EsTreeNodeOfType<"ArrayExpression">,
  scopes: ScopeAnalysis,
): DeferredMemoCapture | null => {
  if (
    !isNamedReactCall(call, "useMemo", scopes) ||
    call.arguments.length !== 2 ||
    call.arguments[0] !== callback ||
    deps.elements.length !== 1 ||
    !deps.elements[0] ||
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== 0 ||
    !isNodeOfType(callback.body, "BlockStatement") ||
    callback.body.body.length !== 2
  ) {
    return null;
  }
  const [branch, returned] = callback.body.body;
  if (
    !isNodeOfType(branch, "IfStatement") ||
    branch.alternate ||
    !isNodeOfType(branch.consequent, "ReturnStatement") ||
    !isNodeOfType(branch.test, "UnaryExpression") ||
    branch.test.operator !== "!" ||
    !isNodeOfType(branch.test.argument, "Identifier") ||
    !isNodeOfType(returned, "ReturnStatement") ||
    !isNodeOfType(returned.argument, "CallExpression") ||
    returned.argument.optional ||
    returned.argument.arguments.length !== 1
  ) {
    return null;
  }
  const empty = branch.consequent.argument;
  if (
    empty &&
    (!isNodeOfType(empty, "Identifier") ||
      empty.name !== "undefined" ||
      !scopes.isGlobalReference(empty))
  ) {
    return null;
  }
  const guard = branch.test.argument;
  if (
    !isSameBinding(getTruthinessOperand(deps.elements[0]), guard, scopes) ||
    !hasClosedBindings(guard, scopes)
  ) {
    return null;
  }
  const [relay] = returned.argument.arguments;
  if (!isNodeOfType(relay, "ArrowFunctionExpression")) return null;
  const member = getCommittedCallbackMember(relay, scopes);
  const factory = getDirectNamedImport(returned.argument.callee, scopes);
  if (
    !factory?.source.startsWith(".") ||
    !member ||
    !hasCommittedRefWriter(member, guard, call, scopes)
  ) {
    return null;
  }
  return { guard, factory };
};
