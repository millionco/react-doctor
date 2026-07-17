import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isEarlyExitStatement } from "../../utils/is-early-exit-statement.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isInsideTryStatement } from "../../utils/is-inside-try-statement.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isObjectOfMemberAccess } from "../../utils/is-object-of-member-access.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MESSAGE =
  "Reading a property straight off `JSON.parse(...)` combines a throwing parse with an unchecked result: malformed or empty input throws `SyntaxError`, while missing fields silently become `undefined`. Wrap the parse in try/catch and validate its shape before accessing fields.";

const isJsonMethodCallee = (calleeNode: EsTreeNode, method: string): boolean => {
  const callee = stripParenExpression(calleeNode);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const receiver = stripParenExpression(callee.object);
  return (
    isNodeOfType(receiver, "Identifier") &&
    receiver.name === "JSON" &&
    getStaticPropertyName(callee) === method
  );
};

const isJsonMethodCall = (node: EsTreeNode, method: string): boolean =>
  isNodeOfType(node, "CallExpression") && isJsonMethodCallee(node.callee, method);

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
    JSON.parse(literalText);
    return true;
  } catch {
    return false;
  }
};

const hasValidJsonFallbackArgument = (argument: EsTreeNode): boolean =>
  isNodeOfType(argument, "LogicalExpression") &&
  (argument.operator === "??" || argument.operator === "||") &&
  isStaticallyValidJsonLiteral(stripParenExpression(argument.right as EsTreeNode));

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

// A function passed straight to a call (`items.map(item => ...)`, an IIFE) can
// run synchronously inside an enclosing `try`, so the try still guards it; a
// function that is merely defined there (assigned to `socket.onmessage`,
// stored, returned) runs later, outside the try.
const isInvokedAtDefinitionSite = (functionNode: EsTreeNode): boolean => {
  const parent = skipParenthesizedParents(functionNode).parent;
  return Boolean(
    parent && (isNodeOfType(parent, "CallExpression") || isNodeOfType(parent, "NewExpression")),
  );
};

// The nearest enclosing function whose execution is deferred past its
// definition site — an enclosing `try` beyond it wraps only the definition,
// not the parse, so the try-walk must stop there.
const findDeferredExecutionBoundary = (node: EsTreeNode): EsTreeNode | null => {
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor) {
    if (isFunctionLike(ancestor) && !isInvokedAtDefinitionSite(ancestor)) return ancestor;
    ancestor = ancestor.parent;
  }
  return null;
};

const NODE_SCRIPT_FILENAME_PATTERN =
  /(^|\/)(scripts?|tools?|tokens?)(\/|$)|(?:^|[/.-])(release|build|generate)(?:[-.]|$)/i;

const SERIALIZER_CALL_NAME_PATTERN =
  /stringify|serializ|^(?:get|build|create).*(?:json|datasetKey)$/i;

const isKnownSerializerCall = (node: EsTreeNode): boolean => {
  const inner = stripParenExpression(node);
  if (!isNodeOfType(inner, "CallExpression")) return false;
  if (isJsonMethodCall(inner, "stringify")) return true;
  const callee = stripParenExpression(inner.callee as EsTreeNode);
  return isNodeOfType(callee, "Identifier") && SERIALIZER_CALL_NAME_PATTERN.test(callee.name);
};

const jsonValidatorCallPolarity = (node: EsTreeNode, argumentName: string): boolean | null => {
  const inner = stripParenExpression(node);
  if (isNodeOfType(inner, "UnaryExpression") && inner.operator === "!") {
    const nestedPolarity = jsonValidatorCallPolarity(inner.argument as EsTreeNode, argumentName);
    return nestedPolarity === null ? null : !nestedPolarity;
  }
  let didFindValidator = false;
  walkAst(inner, (candidate: EsTreeNode) => {
    if (didFindValidator) return false;
    if (!isNodeOfType(candidate, "CallExpression")) return;
    const callee = stripParenExpression(candidate.callee as EsTreeNode);
    if (!isNodeOfType(callee, "Identifier") || !/valid.*json|json.*valid/i.test(callee.name)) {
      return;
    }
    const firstArgument = candidate.arguments[0];
    if (!firstArgument || !isNodeOfType(firstArgument, "Identifier")) return;
    if (firstArgument.name !== argumentName) return;
    const binding = findVariableInitializer(callee, callee.name);
    if (!binding?.initializer) return;
    let containsGuardedParse = false;
    walkAst(binding.initializer, (helperNode: EsTreeNode) => {
      if (
        isJsonMethodCall(helperNode, "parse") &&
        isInsideTryStatement(helperNode, { region: "block" })
      ) {
        containsGuardedParse = true;
        return false;
      }
    });
    didFindValidator = containsGuardedParse;
  });
  return didFindValidator ? true : null;
};

const findJsonValidatorSourceName = (argument: EsTreeNode): string | null => {
  const innerArgument = stripParenExpression(argument);
  if (!isNodeOfType(innerArgument, "Identifier")) return null;
  const argumentBinding = findVariableInitializer(innerArgument, innerArgument.name);
  if (!argumentBinding?.initializer) return innerArgument.name;
  const initializer = stripParenExpression(argumentBinding.initializer);
  if (!isNodeOfType(initializer, "CallExpression")) return innerArgument.name;
  const callee = stripParenExpression(initializer.callee as EsTreeNode);
  if (!isNodeOfType(callee, "MemberExpression")) return innerArgument.name;
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
    return innerArgument.name;
  }
  return receiver.name;
};

const isGuardedByJsonValidator = (parseCall: EsTreeNode, argument: EsTreeNode): boolean => {
  const validatedSourceName = findJsonValidatorSourceName(argument);
  if (!validatedSourceName) return false;
  let child = parseCall;
  let ancestor = parseCall.parent;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "IfStatement") &&
      ancestor.consequent === child &&
      jsonValidatorCallPolarity(ancestor.test, validatedSourceName) === true
    ) {
      return true;
    }
    if (isNodeOfType(ancestor, "BlockStatement") || isNodeOfType(ancestor, "Program")) {
      const childIndex = ancestor.body.findIndex((statement) => statement === child);
      for (const statement of ancestor.body.slice(0, Math.max(childIndex, 0))) {
        if (
          isNodeOfType(statement, "IfStatement") &&
          isEarlyExitStatement(statement.consequent) &&
          jsonValidatorCallPolarity(statement.test, validatedSourceName) === false
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

const containsJsonStringifyCall = (node: EsTreeNode): boolean => {
  let didFindStringify = false;
  walkAst(node, (child: EsTreeNode) => {
    if (didFindStringify) return false;
    if (isJsonMethodCall(child, "stringify")) {
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
const isRoundTripDeserializerParse = (parseCall: EsTreeNode, argument: EsTreeNode): boolean => {
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
    serializerBinding?.initializer && containsJsonStringifyCall(serializerBinding.initializer),
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
  identifierName: string,
): boolean => {
  let didFindDominatingParse = false;
  walkAst(statement, (child: EsTreeNode) => {
    if (didFindDominatingParse) return false;
    if (!isJsonMethodCall(child, "parse") || !isNodeOfType(child, "CallExpression")) return;
    const parsedArgument = child.arguments?.[0];
    if (!parsedArgument) return;
    const innerArgument = stripParenExpression(parsedArgument);
    if (!isNodeOfType(innerArgument, "Identifier") || innerArgument.name !== identifierName) {
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

const statementWritesIdentifier = (statement: EsTreeNode, identifierName: string): boolean => {
  let didFindWrite = false;
  walkAst(statement, (child: EsTreeNode) => {
    if (didFindWrite) return false;
    const assignmentTarget = isNodeOfType(child, "AssignmentExpression")
      ? stripParenExpression(child.left as EsTreeNode)
      : null;
    if (
      assignmentTarget &&
      isNodeOfType(assignmentTarget, "Identifier") &&
      assignmentTarget.name === identifierName
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
      updateTarget.name === identifierName
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
): boolean => {
  const inner = stripParenExpression(argument);
  if (!isNodeOfType(inner, "Identifier")) return false;
  const argumentName = inner.name;
  let cursor: EsTreeNode = parseCall;
  let ancestor: EsTreeNode | null | undefined = parseCall.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "BlockStatement") || isNodeOfType(ancestor, "Program")) {
      const statements = ancestor.body;
      const cursorStatementIndex = statements.findIndex((statement) => statement === cursor);
      const precedingStatements = statements.slice(0, Math.max(cursorStatementIndex, 0));
      for (const precedingStatement of precedingStatements.toReversed()) {
        if (statementWritesIdentifier(precedingStatement, argumentName)) return false;
        if (statementUnconditionallyParsesIdentifier(precedingStatement, argumentName)) {
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
        if (!isJsonMethodCall(node as EsTreeNode, "parse")) return;
        // A same-file binding named `JSON` shadows the global — bail out.
        const callee = stripParenExpression(node.callee);
        if (!isNodeOfType(callee, "MemberExpression")) return;
        const receiver = stripParenExpression(callee.object);
        if (!isNodeOfType(receiver, "Identifier")) return;
        if (findVariableInitializer(receiver, "JSON")) return;
        const firstArgument = node.arguments?.[0];
        if (firstArgument) {
          const unwrappedArgument = stripParenExpression(firstArgument);
          // `JSON.parse(JSON.stringify(x))` is the deep-clone idiom; stringify
          // output is always valid JSON — directly or through a one-hop
          // binding (`const snapshot = JSON.stringify(state)`).
          if (isKnownSerializerCall(unwrappedArgument)) return;
          if (isNodeOfType(unwrappedArgument, "Identifier")) {
            const argumentBinding = findVariableInitializer(
              unwrappedArgument,
              unwrappedArgument.name,
            );
            if (
              argumentBinding?.initializer &&
              isKnownSerializerCall(argumentBinding.initializer)
            ) {
              return;
            }
          }
          if (hasValidJsonFallbackArgument(unwrappedArgument)) return;
          if (isStaticallyValidJsonLiteral(unwrappedArgument)) return;
          if (isRoundTripDeserializerParse(node as EsTreeNode, firstArgument)) return;
          if (isDominatedByPriorParseOfSameIdentifier(node as EsTreeNode, firstArgument)) return;
          if (isGuardedByJsonValidator(node as EsTreeNode, firstArgument)) return;
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
