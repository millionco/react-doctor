import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findDeferredExecutionBoundary } from "../../utils/find-deferred-execution-boundary.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { hasBindingWriteBetween } from "../../utils/has-binding-write-between.js";
import { isEarlyExitStatement } from "../../utils/is-early-exit-statement.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isInsideTryStatement } from "../../utils/is-inside-try-statement.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isObjectOfMemberAccess } from "../../utils/is-object-of-member-access.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";

const MESSAGE =
  "Reading a property straight off `JSON.parse(...)` combines a throwing parse with an unchecked result: malformed or empty input throws `SyntaxError`, while missing fields silently become `undefined`. Wrap the parse in try/catch and validate its shape before accessing fields.";

const isJsonMethodCallee = (
  calleeNode: EsTreeNode,
  method: string,
  scopes?: ScopeAnalysis,
): boolean => {
  const callee = stripParenExpression(calleeNode);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const receiver = stripParenExpression(callee.object);
  return (
    isNodeOfType(receiver, "Identifier") &&
    receiver.name === "JSON" &&
    getStaticPropertyName(callee) === method &&
    (!scopes || scopes.isGlobalReference(receiver))
  );
};

const isJsonMethodCall = (node: EsTreeNode, method: string, scopes?: ScopeAnalysis): boolean =>
  isNodeOfType(node, "CallExpression") && isJsonMethodCallee(node.callee, method, scopes);

// A string/template literal that parses at lint time cannot throw at
// runtime (`JSON.parse('{"version":"1.0.0"}')` inline fixtures).
const isStaticallyValidJsonLiteral = (argument: EsTreeNode): boolean => {
  let literalText: string | null = null;
  if (isNodeOfType(argument, "Literal") && typeof argument.value === "string") {
    literalText = argument.value;
  } else if (
    isNodeOfType(argument, "TemplateLiteral") &&
    (argument.expressions?.length ?? 0) === 0
  ) {
    literalText = argument.quasis[0]?.value.cooked ?? null;
  }
  if (literalText === null) return false;
  try {
    return JSON.parse(literalText) !== null;
  } catch {
    return false;
  }
};

const skipParenthesizedParents = (node: EsTreeNode): EsTreeNode =>
  findTransparentExpressionRoot(node);

// Destructuring reads properties straight off the parse result:
// `const { foo } = JSON.parse(raw)` / `const [first] = JSON.parse(raw)`.
const isDestructuredDeclaratorInit = (node: EsTreeNode): boolean => {
  const parent = node.parent;
  return Boolean(
    parent &&
    isNodeOfType(parent, "VariableDeclarator") &&
    parent.init === node &&
    (isNodeOfType(parent.id, "ObjectPattern") || isNodeOfType(parent.id, "ArrayPattern")),
  );
};

// True when a property is read directly off the call result, including through
// transparent TypeScript and parenthesis wrappers.
const isResultImmediatelyRead = (call: EsTreeNode): boolean => {
  const unwrapped = skipParenthesizedParents(call);
  return isObjectOfMemberAccess(unwrapped) || isDestructuredDeclaratorInit(unwrapped);
};

const NODE_SCRIPT_FILENAME_PATTERN =
  /(^|\/)(scripts?|tools?|tokens?)(\/|$)|(?:^|[/.-])(release|build|generate)(?:[-.]|$)/i;

const SERIALIZER_CALL_NAME_PATTERN =
  /stringify|serializ|^(?:get|build|create).*(?:json|datasetKey)$/i;

const isKnownSerializerCall = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const inner = stripParenExpression(node);
  if (!isNodeOfType(inner, "CallExpression")) return false;
  if (isJsonMethodCall(inner, "stringify", scopes)) return true;
  const callee = stripParenExpression(inner.callee as EsTreeNode);
  return isNodeOfType(callee, "Identifier") && SERIALIZER_CALL_NAME_PATTERN.test(callee.name);
};

const referencesSameBinding = (
  left: EsTreeNodeOfType<"Identifier">,
  right: EsTreeNodeOfType<"Identifier">,
  scopes: ScopeAnalysis,
): boolean => {
  const leftSymbol = scopes.symbolFor(left);
  const rightSymbol = scopes.symbolFor(right);
  return leftSymbol ? leftSymbol === rightSymbol : rightSymbol === null && left.name === right.name;
};

const JSON_VALIDATOR_CONTROL_FLOW_BARRIER_TYPES = new Set([
  "ConditionalExpression",
  "IfStatement",
  "LogicalExpression",
  "SwitchStatement",
]);

const expressionUnconditionallyParsesParameter = (
  root: EsTreeNode,
  parameter: EsTreeNodeOfType<"Identifier">,
  scopes: ScopeAnalysis,
): boolean => {
  let didFindParse = false;
  walkAst(root, (candidate: EsTreeNode) => {
    if (didFindParse) return false;
    if (candidate !== root && isFunctionLike(candidate)) return false;
    if (
      !isJsonMethodCall(candidate, "parse", scopes) ||
      !isNodeOfType(candidate, "CallExpression")
    ) {
      return;
    }
    const parsedArgument = candidate.arguments[0];
    if (
      !parsedArgument ||
      !isNodeOfType(parsedArgument, "Identifier") ||
      !referencesSameBinding(parsedArgument, parameter, scopes)
    ) {
      return;
    }
    let ancestor: EsTreeNode | null | undefined = candidate.parent;
    while (ancestor) {
      if (
        isFunctionLike(ancestor) ||
        JSON_VALIDATOR_CONTROL_FLOW_BARRIER_TYPES.has(ancestor.type)
      ) {
        return;
      }
      if (ancestor === root) {
        didFindParse = true;
        return false;
      }
      ancestor = ancestor.parent ?? null;
    }
  });
  return didFindParse;
};

const findDirectBlockStatementChild = (
  node: EsTreeNode,
  block: EsTreeNodeOfType<"BlockStatement">,
): EsTreeNode | null => {
  let child = node;
  let ancestor = node.parent;
  while (ancestor && ancestor !== block) {
    child = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return ancestor === block ? child : null;
};

const validatorSafelyParsesFirstParameter = (
  validator: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const inner = stripParenExpression(validator);
  if (!isFunctionLike(inner)) return false;
  const firstParameter = inner.params?.[0];
  if (!firstParameter || !isNodeOfType(firstParameter, "Identifier")) return false;
  let hasSafeTry = false;
  walkAst(inner.body as EsTreeNode, (helperNode: EsTreeNode) => {
    if (hasSafeTry) return false;
    if (isFunctionLike(helperNode) && helperNode !== inner) return false;
    if (!isNodeOfType(helperNode, "TryStatement") || !helperNode.handler) return;
    const returnStatements: EsTreeNodeOfType<"ReturnStatement">[] = [];
    walkAst(helperNode.block, (tryNode: EsTreeNode) => {
      if (isFunctionLike(tryNode)) return false;
      if (isNodeOfType(tryNode, "ReturnStatement")) returnStatements.push(tryNode);
    });
    let hasValidatedSuccessReturn = false;
    const everySuccessReturnIsValidated = returnStatements.every((returnStatement) => {
      const returnedValue = returnStatement.argument;
      if (isNodeOfType(returnedValue, "Literal") && returnedValue.value === false) return true;
      if (
        returnedValue &&
        expressionUnconditionallyParsesParameter(returnedValue, firstParameter, scopes)
      ) {
        hasValidatedSuccessReturn = true;
        return true;
      }
      const topLevelStatement = findDirectBlockStatementChild(returnStatement, helperNode.block);
      if (!topLevelStatement) return false;
      const statementIndex = helperNode.block.body.findIndex(
        (statement) => statement === topLevelStatement,
      );
      const isDominatedByParse = helperNode.block.body
        .slice(0, Math.max(statementIndex, 0))
        .some((statement) =>
          expressionUnconditionallyParsesParameter(statement, firstParameter, scopes),
        );
      if (isDominatedByParse) hasValidatedSuccessReturn = true;
      return isDominatedByParse;
    });
    let catchReturnCount = 0;
    let everyCatchReturnIsFalse = true;
    walkAst(helperNode.handler.body, (catchNode: EsTreeNode) => {
      if (isFunctionLike(catchNode)) return false;
      if (!isNodeOfType(catchNode, "ReturnStatement")) return;
      catchReturnCount += 1;
      if (!isNodeOfType(catchNode.argument, "Literal") || catchNode.argument.value !== false) {
        everyCatchReturnIsFalse = false;
      }
    });
    hasSafeTry =
      hasValidatedSuccessReturn &&
      everySuccessReturnIsValidated &&
      catchReturnCount > 0 &&
      everyCatchReturnIsFalse;
  });
  return hasSafeTry;
};

const jsonValidatorCallPolarity = (
  node: EsTreeNode,
  sourceIdentifier: EsTreeNodeOfType<"Identifier">,
  scopes: ScopeAnalysis,
): boolean | null => {
  const inner = stripParenExpression(node);
  if (isNodeOfType(inner, "UnaryExpression") && inner.operator === "!") {
    const nestedPolarity = jsonValidatorCallPolarity(
      inner.argument as EsTreeNode,
      sourceIdentifier,
      scopes,
    );
    return nestedPolarity === null ? null : !nestedPolarity;
  }
  if (!isNodeOfType(inner, "CallExpression")) return null;
  const callee = stripParenExpression(inner.callee as EsTreeNode);
  if (!isNodeOfType(callee, "Identifier") || !/valid.*json|json.*valid/i.test(callee.name)) {
    return null;
  }
  const firstArgument = inner.arguments[0];
  if (!firstArgument || !isNodeOfType(firstArgument, "Identifier")) return null;
  if (!referencesSameBinding(firstArgument, sourceIdentifier, scopes)) return null;
  const binding = findVariableInitializer(callee, callee.name);
  return binding?.initializer && validatorSafelyParsesFirstParameter(binding.initializer, scopes)
    ? true
    : null;
};

const expressionGuaranteesJsonValidity = (
  node: EsTreeNode,
  branchRunsWhenTruthy: boolean,
  sourceIdentifier: EsTreeNodeOfType<"Identifier">,
  scopes: ScopeAnalysis,
): boolean => {
  const inner = stripParenExpression(node);
  if (isNodeOfType(inner, "UnaryExpression") && inner.operator === "!") {
    return expressionGuaranteesJsonValidity(
      inner.argument as EsTreeNode,
      !branchRunsWhenTruthy,
      sourceIdentifier,
      scopes,
    );
  }
  if (isNodeOfType(inner, "LogicalExpression")) {
    const leftGuarantees = expressionGuaranteesJsonValidity(
      inner.left as EsTreeNode,
      branchRunsWhenTruthy,
      sourceIdentifier,
      scopes,
    );
    const rightGuarantees = expressionGuaranteesJsonValidity(
      inner.right as EsTreeNode,
      branchRunsWhenTruthy,
      sourceIdentifier,
      scopes,
    );
    if (inner.operator === "&&") {
      return branchRunsWhenTruthy
        ? leftGuarantees || rightGuarantees
        : leftGuarantees && rightGuarantees;
    }
    if (inner.operator === "||") {
      return branchRunsWhenTruthy
        ? leftGuarantees && rightGuarantees
        : leftGuarantees || rightGuarantees;
    }
  }
  return jsonValidatorCallPolarity(inner, sourceIdentifier, scopes) === branchRunsWhenTruthy;
};

const findJsonValidatorSource = (argument: EsTreeNode): EsTreeNodeOfType<"Identifier"> | null => {
  const innerArgument = stripParenExpression(argument);
  if (!isNodeOfType(innerArgument, "Identifier")) return null;
  const argumentBinding = findVariableInitializer(innerArgument, innerArgument.name);
  if (!argumentBinding?.initializer) return innerArgument;
  const initializer = stripParenExpression(argumentBinding.initializer);
  if (!isNodeOfType(initializer, "CallExpression")) return innerArgument;
  const callee = stripParenExpression(initializer.callee as EsTreeNode);
  if (!isNodeOfType(callee, "MemberExpression")) return innerArgument;
  const receiver = stripParenExpression(callee.object);
  const [matchPattern, replacement] = initializer.arguments;
  if (
    getStaticPropertyName(callee) !== "replace" ||
    !isNodeOfType(receiver, "Identifier") ||
    !matchPattern ||
    !isNodeOfType(matchPattern, "Literal") ||
    !("regex" in matchPattern) ||
    matchPattern.regex?.pattern !== "\\bnan\\b" ||
    !replacement ||
    !isNodeOfType(replacement, "Literal") ||
    replacement.value !== "null"
  ) {
    return innerArgument;
  }
  return receiver;
};

const isGuardedByJsonValidator = (
  parseCall: EsTreeNode,
  argument: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const validatedSource = findJsonValidatorSource(argument);
  if (!validatedSource) return false;
  let child = parseCall;
  let ancestor = parseCall.parent;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "IfStatement") &&
      ancestor.consequent === child &&
      expressionGuaranteesJsonValidity(ancestor.test, true, validatedSource, scopes) &&
      !hasBindingWriteBetween(validatedSource, ancestor.test, parseCall, scopes)
    ) {
      return true;
    }
    if (isNodeOfType(ancestor, "BlockStatement") || isNodeOfType(ancestor, "Program")) {
      const childIndex = ancestor.body.findIndex((statement) => statement === child);
      for (const statement of ancestor.body.slice(0, Math.max(childIndex, 0))) {
        if (
          isNodeOfType(statement, "IfStatement") &&
          isEarlyExitStatement(statement.consequent) &&
          expressionGuaranteesJsonValidity(statement.test, false, validatedSource, scopes) &&
          !hasBindingWriteBetween(validatedSource, statement.test, parseCall, scopes)
        ) {
          return true;
        }
      }
    }
    if (isFunctionLike(ancestor)) return false;
    child = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

const nameOfEnclosingFunction = (node: EsTreeNode): string | null => {
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor) {
    if (isFunctionLike(cursor)) {
      if (isNodeOfType(cursor, "FunctionDeclaration") && cursor.id) return cursor.id.name;
      const functionParent = cursor.parent;
      if (
        functionParent &&
        isNodeOfType(functionParent, "VariableDeclarator") &&
        isNodeOfType(functionParent.id, "Identifier")
      ) {
        return functionParent.id.name;
      }
      return null;
    }
    cursor = cursor.parent ?? null;
  }
  return null;
};

const containsJsonStringifyCall = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let didFindStringify = false;
  walkAst(node, (child: EsTreeNode) => {
    if (didFindStringify) return false;
    if (isJsonMethodCall(child, "stringify", scopes)) {
      didFindStringify = true;
      return false;
    }
  });
  return didFindStringify;
};

// `deserializeKeyPair(value)` parsing its own parameter, with the sibling
// `serializeKeyPair` in the same module returning `JSON.stringify(...)`, is a
// same-module round-trip pair: the only producer of the input is the
// serializer, so the string is valid JSON by construction.
const isRoundTripDeserializerParse = (
  parseCall: EsTreeNode,
  argument: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const inner = stripParenExpression(argument);
  if (!isNodeOfType(inner, "Identifier")) return false;
  const argumentBinding = findVariableInitializer(inner, inner.name);
  if (!argumentBinding || argumentBinding.initializer !== null) return false;
  if (!isFunctionLike(argumentBinding.scopeOwner)) return false;
  const functionName = nameOfEnclosingFunction(parseCall);
  if (!functionName || !/^deserialize/i.test(functionName)) return false;
  const serializerName = functionName.replace(/^deserialize/i, "serialize");
  const serializerBinding = findVariableInitializer(parseCall, serializerName);
  return Boolean(
    serializerBinding?.initializer &&
    containsJsonStringifyCall(serializerBinding.initializer, scopes),
  );
};

// Node types on the path from a statement down to a parse call that make the
// parse conditional or deferred — such a prior parse does not prove the
// string is well-formed on the current path.
const PRIOR_PARSE_CONTROL_FLOW_BARRIER_TYPES = new Set([
  "IfStatement",
  "ConditionalExpression",
  "LogicalExpression",
  "SwitchStatement",
  "TryStatement",
  "CatchClause",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
]);

const statementUnconditionallyParsesIdentifier = (
  statement: EsTreeNode,
  identifier: EsTreeNodeOfType<"Identifier">,
  scopes: ScopeAnalysis,
): boolean => {
  let didFindDominatingParse = false;
  walkAst(statement, (child: EsTreeNode) => {
    if (didFindDominatingParse) return false;
    if (child !== statement && isFunctionLike(child)) return false;
    if (!isJsonMethodCall(child, "parse", scopes) || !isNodeOfType(child, "CallExpression")) return;
    const parsedArgument = child.arguments?.[0];
    if (!parsedArgument) return;
    const innerArgument = stripParenExpression(parsedArgument);
    if (
      !isNodeOfType(innerArgument, "Identifier") ||
      !referencesSameBinding(innerArgument, identifier, scopes)
    ) {
      return;
    }
    let pathAncestor: EsTreeNode | null | undefined = child.parent;
    let executesUnconditionally = true;
    while (pathAncestor) {
      if (
        isFunctionLike(pathAncestor) ||
        PRIOR_PARSE_CONTROL_FLOW_BARRIER_TYPES.has(pathAncestor.type)
      ) {
        executesUnconditionally = false;
        break;
      }
      if (pathAncestor === statement) break;
      pathAncestor = pathAncestor.parent ?? null;
    }
    if (executesUnconditionally) {
      didFindDominatingParse = true;
      return false;
    }
  });
  return didFindDominatingParse;
};

const statementWritesIdentifier = (
  statement: EsTreeNode,
  identifier: EsTreeNodeOfType<"Identifier">,
  scopes: ScopeAnalysis,
): boolean => {
  let didFindWrite = false;
  walkAst(statement, (child: EsTreeNode) => {
    if (didFindWrite) return false;
    if (child !== statement && isFunctionLike(child)) return false;
    const assignmentTarget = isNodeOfType(child, "AssignmentExpression")
      ? stripParenExpression(child.left as EsTreeNode)
      : null;
    if (
      assignmentTarget &&
      isNodeOfType(assignmentTarget, "Identifier") &&
      referencesSameBinding(assignmentTarget, identifier, scopes)
    ) {
      didFindWrite = true;
      return false;
    }
    const updateTarget = isNodeOfType(child, "UpdateExpression")
      ? stripParenExpression(child.argument as EsTreeNode)
      : null;
    if (
      updateTarget &&
      isNodeOfType(updateTarget, "Identifier") &&
      referencesSameBinding(updateTarget, identifier, scopes)
    ) {
      didFindWrite = true;
      return false;
    }
  });
  return didFindWrite;
};

// A preceding statement in the same (or an enclosing) block within the same
// function already parsed the SAME identifier unconditionally: had the string
// been malformed, the earlier parse would have thrown first, so this parse
// cannot be the crash site. A write between the parses invalidates this proof.
const isDominatedByPriorParseOfSameIdentifier = (
  parseCall: EsTreeNode,
  argument: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const inner = stripParenExpression(argument);
  if (!isNodeOfType(inner, "Identifier")) return false;
  let cursor: EsTreeNode = parseCall;
  let ancestor: EsTreeNode | null | undefined = parseCall.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "BlockStatement") || isNodeOfType(ancestor, "Program")) {
      const statements = ancestor.body;
      const cursorStatementIndex = statements.findIndex((statement) => statement === cursor);
      const precedingStatements = statements.slice(0, Math.max(cursorStatementIndex, 0));
      for (const precedingStatement of precedingStatements.toReversed()) {
        if (statementWritesIdentifier(precedingStatement, inner, scopes)) return false;
        if (statementUnconditionallyParsesIdentifier(precedingStatement, inner, scopes)) {
          return true;
        }
      }
    }
    if (isFunctionLike(ancestor)) return false;
    cursor = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

export const noUnsafeJsonParse = defineRule({
  id: "no-unsafe-json-parse",
  title: "Unsafe JSON.parse dereference",
  severity: "warn",
  category: "Correctness",
  tags: ["test-noise"],
  recommendation:
    "Wrap `JSON.parse(x)` in try/catch and validate the result (for example with a schema) before reading properties off it. A bare `JSON.parse(x).foo` throws on bad input and lets undefined fields slip past the type-checker.",
  create: (context: RuleContext) => {
    const fileIsNodeScript = NODE_SCRIPT_FILENAME_PATTERN.test(context.filename ?? "");
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (fileIsNodeScript) return;
        if (!isJsonMethodCall(node as EsTreeNode, "parse", context.scopes)) return;
        const callee = stripParenExpression(node.callee);
        if (!isNodeOfType(callee, "MemberExpression")) return;
        const receiver = stripParenExpression(callee.object);
        if (!isNodeOfType(receiver, "Identifier")) return;
        const firstArgument = node.arguments?.[0];
        if (firstArgument) {
          const unwrappedArgument = stripParenExpression(firstArgument);
          // `JSON.parse(JSON.stringify(x))` is the deep-clone idiom; stringify
          // output is always valid JSON — directly or through a one-hop
          // binding (`const snapshot = JSON.stringify(state)`).
          if (isKnownSerializerCall(unwrappedArgument, context.scopes)) return;
          if (isNodeOfType(unwrappedArgument, "Identifier")) {
            const argumentBinding = findVariableInitializer(
              unwrappedArgument,
              unwrappedArgument.name,
            );
            if (
              argumentBinding?.initializer &&
              isKnownSerializerCall(argumentBinding.initializer, context.scopes) &&
              !hasBindingWriteBetween(
                unwrappedArgument,
                argumentBinding.bindingIdentifier,
                node as EsTreeNode,
                context.scopes,
              )
            ) {
              return;
            }
          }
          if (isStaticallyValidJsonLiteral(unwrappedArgument)) return;
          if (isRoundTripDeserializerParse(node as EsTreeNode, firstArgument, context.scopes))
            return;
          if (
            isDominatedByPriorParseOfSameIdentifier(
              node as EsTreeNode,
              firstArgument,
              context.scopes,
            )
          ) {
            return;
          }
          if (isGuardedByJsonValidator(node as EsTreeNode, firstArgument, context.scopes)) return;
        }
        if (!isResultImmediatelyRead(node as EsTreeNode)) return;
        if (
          isInsideTryStatement(node as EsTreeNode, {
            region: "block",
            boundary: findDeferredExecutionBoundary(node as EsTreeNode),
          })
        )
          return;
        context.report({ node, message: MESSAGE });
      },
    };
  },
});
