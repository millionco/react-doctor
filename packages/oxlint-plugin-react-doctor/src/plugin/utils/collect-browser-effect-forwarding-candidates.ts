import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getFunctionExportNames } from "./get-function-export-names.js";
import { getImportedName } from "./get-imported-name.js";
import { getValueImportSource } from "./get-value-import-declaration.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

type Call = EsTreeNodeOfType<"CallExpression">;

export interface BrowserEffectForwardingCandidate {
  readonly name: string;
  readonly innerCalls: readonly [Call, Call];
  readonly callers: ReadonlySet<Call>;
}

const FORWARDED_EFFECTS = new Set(["useEffect", "useLayoutEffect"]);
const STOCK_RECEIVER_CALLS = new Set([...FORWARDED_EFFECTS, "useState"]);
const EQUALITY_OPERATORS = new Set(["===", "!==", "==", "!="]);

const isWindowTypeof = (node: EsTreeNode, scopes: ScopeAnalysis): boolean =>
  isNodeOfType(node, "UnaryExpression") &&
  node.operator === "typeof" &&
  isNodeOfType(node.argument, "Identifier") &&
  node.argument.name === "window" &&
  !scopes.symbolFor(node.argument);

const isUndefinedLiteral = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "Literal") && node.value === "undefined";

const getReturnedCall = (statement: EsTreeNode | undefined): Call | null => {
  if (!isNodeOfType(statement, "ReturnStatement")) return null;
  const argument = statement.argument;
  return isNodeOfType(argument, "CallExpression") && !argument.optional ? argument : null;
};

const getConditionalCalls = (
  wrapper: EsTreeNodeOfType<"ArrowFunctionExpression">,
  scopes: ScopeAnalysis,
): readonly [Call, Call] | null => {
  if (!isNodeOfType(wrapper.body, "BlockStatement") || wrapper.body.body.length !== 2) return null;
  const [conditional, fallback] = wrapper.body.body;
  if (!isNodeOfType(conditional, "IfStatement") || conditional.alternate) return null;
  const test = conditional.test;
  if (
    !isNodeOfType(test, "BinaryExpression") ||
    !EQUALITY_OPERATORS.has(test.operator) ||
    !(
      (isWindowTypeof(test.left, scopes) && isUndefinedLiteral(test.right)) ||
      (isWindowTypeof(test.right, scopes) && isUndefinedLiteral(test.left))
    )
  )
    return null;
  const branch = conditional.consequent;
  if (isNodeOfType(branch, "BlockStatement") && branch.body.length !== 1) return null;
  const first = getReturnedCall(isNodeOfType(branch, "BlockStatement") ? branch.body[0] : branch);
  const second = getReturnedCall(fallback);
  return first && second ? [first, second] : null;
};

const getDirectReactMemberName = (
  node: EsTreeNode,
  receiver: SymbolDescriptor,
  scopes: ScopeAnalysis,
) =>
  isNodeOfType(node, "MemberExpression") &&
  !node.optional &&
  !node.computed &&
  isNodeOfType(node.object, "Identifier") &&
  scopes.symbolFor(node.object) === receiver &&
  isNodeOfType(node.property, "Identifier")
    ? node.property.name
    : null;

const isClosedReceiverReference = (
  identifier: EsTreeNode,
  receiver: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean => {
  const member = identifier.parent;
  if (!member) return false;
  if (isNodeOfType(member, "TSQualifiedName") && member.left === identifier)
    return isNodeOfType(member.parent, "TSTypeReference");
  const memberName = getDirectReactMemberName(member, receiver, scopes);
  const caller = member.parent;
  return (
    memberName !== null &&
    STOCK_RECEIVER_CALLS.has(memberName) &&
    isNodeOfType(caller, "CallExpression") &&
    !caller.optional &&
    caller.callee === member
  );
};

const hasOpaqueRuntimeAccess = (program: EsTreeNode): boolean => {
  let opaqueAccess = false;
  walkAst(program, (node) => {
    if (opaqueAccess) return false;
    if (
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "TSImportEqualsDeclaration") ||
      (isNodeOfType(node, "Literal") &&
        (node.value === "node:module" || node.value === "module" || node.value === "require")) ||
      (isNodeOfType(node, "Identifier") &&
        (node.name === "eval" || node.name === "require" || node.name === "createRequire"))
    ) {
      opaqueAccess = true;
      return false;
    }
  });
  return opaqueAccess;
};

const findClosedReactReceiver = (
  program: EsTreeNodeOfType<"Program">,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  const receiverSymbols = scopes.rootScope.symbols.filter((symbol) => {
    if (getValueImportSource(symbol) !== "react") return false;
    const declaration = symbol.declarationNode;
    return (
      isNodeOfType(declaration, "ImportDefaultSpecifier") ||
      isNodeOfType(declaration, "ImportNamespaceSpecifier") ||
      (isNodeOfType(declaration, "ImportSpecifier") && getImportedName(declaration) === "default")
    );
  });
  const [receiver] = receiverSymbols;
  if (
    receiverSymbols.length !== 1 ||
    !receiver ||
    hasOpaqueRuntimeAccess(program) ||
    !hasCompleteSymbolReferences(receiver, program, scopes) ||
    !receiver.references.every(
      ({ identifier, flag }) =>
        flag === "read" && isClosedReceiverReference(identifier, receiver, scopes),
    )
  )
    return null;
  return receiver;
};

const isForwardedParameter = (
  parameter: EsTreeNodeOfType<"Identifier">,
  calls: readonly [Call, Call],
  argumentIndex: number,
  program: EsTreeNodeOfType<"Program">,
  scopes: ScopeAnalysis,
): boolean => {
  const symbol = scopes.symbolFor(parameter);
  return (
    symbol?.kind === "parameter" &&
    symbol.references.length === calls.length &&
    symbol.references.every(({ flag }) => flag === "read") &&
    hasCompleteSymbolReferences(symbol, program, scopes) &&
    calls.every((call) => {
      const argument = call.arguments[argumentIndex];
      return isNodeOfType(argument, "Identifier") && scopes.symbolFor(argument) === symbol;
    })
  );
};

const getSupportedCallers = (symbol: SymbolDescriptor): ReadonlySet<Call> | null => {
  const callers = new Set<Call>();
  for (const { identifier, flag } of symbol.references) {
    const caller = identifier.parent;
    if (
      flag !== "read" ||
      !isNodeOfType(caller, "CallExpression") ||
      caller.optional ||
      caller.callee !== identifier ||
      caller.arguments.length !== 2
    )
      return null;
    const [callback, dependencies] = caller.arguments;
    if (
      (!isNodeOfType(callback, "ArrowFunctionExpression") &&
        !isNodeOfType(callback, "FunctionExpression")) ||
      callback.async ||
      (isNodeOfType(callback, "FunctionExpression") && callback.generator) ||
      !isNodeOfType(dependencies, "ArrayExpression")
    )
      return null;
    callers.add(caller);
  }
  return callers.size > 0 ? callers : null;
};

export const collectBrowserEffectForwardingCandidates = (
  scopes: ScopeAnalysis,
): BrowserEffectForwardingCandidate[] => {
  const candidates: BrowserEffectForwardingCandidate[] = [];
  const program = scopes.rootScope.node;
  if (!isNodeOfType(program, "Program") || program.sourceType !== "module") return candidates;

  let receiver: SymbolDescriptor | null | undefined;
  for (const symbol of scopes.rootScope.symbols) {
    const declaration = symbol.declarationNode;
    const wrapper = symbol.initializer;
    if (
      symbol.kind !== "const" ||
      !/^use[A-Z0-9]/.test(symbol.name) ||
      !isNodeOfType(declaration, "VariableDeclarator") ||
      declaration.id !== symbol.bindingIdentifier ||
      !isNodeOfType(declaration.id, "Identifier") ||
      !isNodeOfType(declaration.parent, "VariableDeclaration") ||
      declaration.parent.parent !== program ||
      !isNodeOfType(wrapper, "ArrowFunctionExpression") ||
      wrapper.async ||
      wrapper.params.length !== 2
    )
      continue;

    const [callback, dependencies] = wrapper.params;
    if (
      !isNodeOfType(callback, "Identifier") ||
      !isNodeOfType(dependencies, "Identifier") ||
      callback.name === dependencies.name
    )
      continue;
    const innerCalls = getConditionalCalls(wrapper, scopes);
    if (!innerCalls || !innerCalls.every((call) => call.arguments.length === 2)) continue;

    if (receiver === undefined) receiver = findClosedReactReceiver(program, scopes);
    if (!receiver) break;
    const firstEffect = getDirectReactMemberName(innerCalls[0].callee, receiver, scopes);
    const secondEffect = getDirectReactMemberName(innerCalls[1].callee, receiver, scopes);
    if (
      firstEffect === null ||
      secondEffect === null ||
      firstEffect === secondEffect ||
      !FORWARDED_EFFECTS.has(firstEffect) ||
      !FORWARDED_EFFECTS.has(secondEffect) ||
      getFunctionExportNames(program, wrapper).length > 0 ||
      !hasCompleteSymbolReferences(symbol, program, scopes) ||
      !isForwardedParameter(callback, innerCalls, 0, program, scopes) ||
      !isForwardedParameter(dependencies, innerCalls, 1, program, scopes)
    )
      continue;

    const callers = getSupportedCallers(symbol);
    if (callers) candidates.push({ name: symbol.name, innerCalls, callers });
  }
  return candidates;
};
