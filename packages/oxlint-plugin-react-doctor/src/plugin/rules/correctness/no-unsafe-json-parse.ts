import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isInsideTryStatement } from "../../utils/is-inside-try-statement.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isObjectOfMemberAccess } from "../../utils/is-object-of-member-access.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MESSAGE =
  "Reading a property straight off `JSON.parse(...)` is a double crash: `JSON.parse` throws `SyntaxError` on malformed or empty input, and its `any` result lets an undefined property pass the type-checker and throw at runtime; wrap the parse in try/catch and validate the result before accessing fields.";

// `JSON.<method>(...)` with a non-computed `JSON` member callee. Computed
// access (`JSON["parse"]`) is a v1 non-goal (vanishingly rare).
const isJsonMethodCall = (node: EsTreeNode, method: string): boolean =>
  isNodeOfType(node, "CallExpression") &&
  isNodeOfType(node.callee, "MemberExpression") &&
  !node.callee.computed &&
  isNodeOfType(node.callee.object, "Identifier") &&
  node.callee.object.name === "JSON" &&
  isNodeOfType(node.callee.property, "Identifier") &&
  node.callee.property.name === method;

// oxc surfaces redundant parens as a `ParenthesizedExpression` wrapper,
// which TSESTree's node-type union doesn't model — compare `type` as a
// plain string to walk past it.
const PARENTHESIZED_EXPRESSION_TYPE: string = "ParenthesizedExpression";

// A `??` / `||` fallback (`JSON.parse(input ?? "{}")`) supplies valid JSON when
// the source is missing, so the parse is guarded by construction.
const hasFallbackArgument = (argument: EsTreeNode): boolean =>
  isNodeOfType(argument, "LogicalExpression") &&
  (argument.operator === "??" || argument.operator === "||");

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

const skipParenthesizedParents = (node: EsTreeNode): EsTreeNode => {
  let current = node;
  while (current.parent && current.parent.type === PARENTHESIZED_EXPRESSION_TYPE) {
    current = current.parent;
  }
  return current;
};

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

// True when a property is read directly off the call result — a member access
// (`JSON.parse(x).foo`, tolerating `(JSON.parse(x)).foo` parens) or a
// destructuring declarator. A `TSAsExpression` / `TSSatisfiesExpression`
// parent means the author annotated the result and is intentionally out of
// scope, so it is NOT treated as an unsafe deref.
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

// CommonJS Node scripts (release/build tooling that `require`s a Node
// builtin like `fs` or `child_process`) parse tool output (`npm view --json`)
// and repo-local fixtures, where a loud SyntaxError crash is the desirable
// fail-fast behavior — not an app-runtime crash. ESM `import`s of node
// builtins do NOT mark a file: library/server runtime code imports them too.
const NODE_BUILTIN_REQUIRE_TARGETS = new Set([
  "assert",
  "buffer",
  "child_process",
  "crypto",
  "events",
  "fs",
  "fs/promises",
  "http",
  "https",
  "os",
  "path",
  "readline",
  "stream",
  "url",
  "util",
  "worker_threads",
  "zlib",
]);

const isNodeBuiltinRequireCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  if (!isNodeOfType(node.callee, "Identifier") || node.callee.name !== "require") return false;
  const moduleArgument = node.arguments?.[0];
  if (!moduleArgument || !isNodeOfType(moduleArgument, "Literal")) return false;
  const moduleName = moduleArgument.value;
  return (
    typeof moduleName === "string" &&
    (moduleName.startsWith("node:") || NODE_BUILTIN_REQUIRE_TARGETS.has(moduleName))
  );
};

const programRequiresNodeBuiltin = (programNode: EsTreeNode): boolean => {
  let didFindRequire = false;
  walkAst(programNode, (child: EsTreeNode) => {
    if (didFindRequire) return false;
    if (isNodeBuiltinRequireCall(child)) {
      didFindRequire = true;
      return false;
    }
  });
  return didFindRequire;
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

// A preceding statement in the same (or an enclosing) block within the same
// function already parsed the SAME identifier unconditionally: had the string
// been malformed, the earlier parse would have thrown first, so this parse
// cannot be the crash site. Heuristic: does not model reassignment between
// the two parses.
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
      for (const precedingStatement of statements.slice(0, Math.max(cursorStatementIndex, 0))) {
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
    let fileIsNodeBuiltinRequireScript = false;
    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        fileIsNodeBuiltinRequireScript = programRequiresNodeBuiltin(node as EsTreeNode);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (fileIsNodeBuiltinRequireScript) return;
        if (!isJsonMethodCall(node as EsTreeNode, "parse")) return;
        // A same-file binding named `JSON` shadows the global — bail out.
        const callee = node.callee;
        if (
          isNodeOfType(callee, "MemberExpression") &&
          isNodeOfType(callee.object, "Identifier") &&
          findVariableInitializer(callee.object, "JSON")
        )
          return;
        const firstArgument = node.arguments?.[0];
        if (firstArgument) {
          const unwrappedArgument = stripParenExpression(firstArgument);
          // `JSON.parse(JSON.stringify(x))` is the deep-clone idiom; stringify
          // output is always valid JSON — directly or through a one-hop
          // binding (`const snapshot = JSON.stringify(state)`).
          if (isJsonMethodCall(unwrappedArgument, "stringify")) return;
          if (isNodeOfType(unwrappedArgument, "Identifier")) {
            const argumentBinding = findVariableInitializer(
              unwrappedArgument,
              unwrappedArgument.name,
            );
            if (
              argumentBinding?.initializer &&
              isJsonMethodCall(stripParenExpression(argumentBinding.initializer), "stringify")
            ) {
              return;
            }
          }
          if (hasFallbackArgument(unwrappedArgument)) return;
          if (isStaticallyValidJsonLiteral(unwrappedArgument)) return;
          if (isRoundTripDeserializerParse(node as EsTreeNode, firstArgument)) return;
          if (isDominatedByPriorParseOfSameIdentifier(node as EsTreeNode, firstArgument)) return;
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
