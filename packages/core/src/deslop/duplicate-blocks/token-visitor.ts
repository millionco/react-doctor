import type { SourceToken } from "./token-types.js";
import { isAstNode } from "../utils/is-ast-node.js";

const NODES_DROPPED_FROM_TOKEN_STREAM = new Set<string>([
  "ImportDeclaration",
  "ExportAllDeclaration",
  "TSTypeAnnotation",
  "TSTypeAliasDeclaration",
  "TSInterfaceDeclaration",
  "TSTypeParameterDeclaration",
  "TSTypeParameterInstantiation",
  "TSTypeReference",
  "TSAnyKeyword",
  "TSUnknownKeyword",
  "TSStringKeyword",
  "TSNumberKeyword",
  "TSBooleanKeyword",
  "TSVoidKeyword",
  "TSUndefinedKeyword",
  "TSNullKeyword",
  "TSNeverKeyword",
  "TSUnionType",
  "TSIntersectionType",
  "TSLiteralType",
  "TSArrayType",
  "TSTupleType",
  "TSTypeLiteral",
  "TSPropertySignature",
  "TSMethodSignature",
  "TSCallSignatureDeclaration",
  "TSConstructSignatureDeclaration",
  "TSIndexSignature",
  "TSConditionalType",
  "TSMappedType",
  "TSInferType",
  "TSImportType",
  "TSQualifiedName",
  "TSTypeOperator",
  "TSTypePredicate",
  "TSFunctionType",
  "TSConstructorType",
]);

const visitChildrenRaw = (node: unknown, visit: (child: unknown) => void): void => {
  if (!isAstNode(node)) return;
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end" || key === "loc" || key === "range") {
      continue;
    }
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
    } else if (value !== null && typeof value === "object") {
      visit(value);
    }
  }
};

const safeNumberOrZero = (candidate: unknown): number =>
  typeof candidate === "number" ? candidate : 0;

/**
 * Walk an oxc AST and emit a flat token stream suitable for suffix-array-based
 * duplicate-block detection. Two structurally-identical regions of code produce the same
 * token sequence (modulo identifier/literal-value normalization, applied later
 * in `normalize.ts`).
 *
 * Implementation note: rather than a hand-written keyword/operator lexer-style
 * visitor, we walk the AST generically and emit one `node-enter` token per
 * visited node. This trades a slightly different token-density profile for
 * less code. AST-shape tokens still distinguish
 * `function add(a, b) { return a + b }` from `const add = (a, b) => a + b`.
 * Identifiers and value literals get dedicated tokens so semantic-mode
 * normalization can blind them.
 *
 * Imports and type-only constructs are dropped to keep import-block boilerplate
 * and ambient type declarations from inflating the noise floor.
 */
export const tokenizeAst = (program: unknown): SourceToken[] => {
  const tokens: SourceToken[] = [];

  const visit = (node: unknown): void => {
    if (!isAstNode(node)) return;
    const nodeType = node.type;
    if (NODES_DROPPED_FROM_TOKEN_STREAM.has(nodeType)) return;

    const start = safeNumberOrZero(node.start);
    const end = safeNumberOrZero(node.end);

    if (nodeType === "Identifier" || nodeType === "PrivateIdentifier") {
      const identifierName = node.name;
      tokens.push({
        kind: "identifier",
        payload: typeof identifierName === "string" ? identifierName : "",
        start,
        end,
      });
      return;
    }

    if (nodeType === "Literal") {
      const literalValue = node.value;
      if (typeof literalValue === "string") {
        tokens.push({ kind: "string-literal", payload: literalValue, start, end });
      } else if (typeof literalValue === "number") {
        tokens.push({ kind: "numeric-literal", payload: String(literalValue), start, end });
      } else if (typeof literalValue === "boolean") {
        tokens.push({
          kind: "boolean-literal",
          payload: literalValue ? "true" : "false",
          start,
          end,
        });
      } else if (literalValue === null) {
        tokens.push({ kind: "null-literal", payload: "null", start, end });
      } else if (node.regex) {
        tokens.push({ kind: "regexp-literal", payload: "regex", start, end });
      } else {
        tokens.push({ kind: "node-enter", payload: nodeType, start, end });
      }
      return;
    }

    if (nodeType === "TemplateLiteral") {
      tokens.push({ kind: "template-literal", payload: "tpl", start, end });
      visitChildrenRaw(node, visit);
      return;
    }

    tokens.push({ kind: "node-enter", payload: nodeType, start, end });
    visitChildrenRaw(node, visit);
  };

  visit(program);
  return tokens;
};
