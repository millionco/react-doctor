import {
  MIN_NUMERIC_LITERAL_MAGNITUDE_FOR_DUPLICATE,
  MIN_STRING_LITERAL_LENGTH_FOR_DUPLICATE,
} from "../constants.js";
import { isOxcAstNode, type OxcAstNode } from "./oxc-ast-node.js";

export interface DuplicateConstantCandidate {
  constantName: string;
  literalHash: string;
  literalPreview: string;
  startOffset: number;
}

const FRAMEWORK_RESERVED_CONSTANT_NAMES = new Set([
  "dynamic",
  "dynamicParams",
  "revalidate",
  "runtime",
  "fetchCache",
  "preferredRegion",
  "maxDuration",
  "metadata",
  "viewport",
  "generateStaticParams",
  "generateMetadata",
  "config",
  "loader",
  "action",
  "links",
  "meta",
  "headers",
  "handle",
  "shouldRevalidate",
  "ErrorBoundary",
  "HydrateFallback",
  "Layout",
]);

const isLiteralCandidate = (node: OxcAstNode): boolean => {
  if (node.type === "Literal") {
    const value = (node as { value?: unknown }).value;
    if (typeof value === "string") {
      if (value.length < MIN_STRING_LITERAL_LENGTH_FOR_DUPLICATE) return false;
      return true;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return false;
      if (Math.abs(value) < MIN_NUMERIC_LITERAL_MAGNITUDE_FOR_DUPLICATE) return false;
      return true;
    }
    return false;
  }
  if (node.type === "TemplateLiteral") {
    const expressions = (node as { expressions?: unknown[] }).expressions;
    if (Array.isArray(expressions) && expressions.length > 0) return false;
    const quasis = (node as { quasis?: Array<{ value?: { cooked?: string } }> }).quasis;
    if (!Array.isArray(quasis) || quasis.length === 0) return false;
    const cooked = quasis[0].value?.cooked ?? "";
    return cooked.length >= MIN_STRING_LITERAL_LENGTH_FOR_DUPLICATE;
  }
  if (node.type === "ArrayExpression") {
    const elements = (node as { elements?: unknown[] }).elements ?? [];
    if (elements.length === 0) return false;
    for (const element of elements) {
      if (!isOxcAstNode(element)) return false;
      if (element.type !== "Literal") return false;
    }
    return true;
  }
  return false;
};

const hashLiteralNode = (node: OxcAstNode): string => {
  if (node.type === "Literal") {
    return `lit:${typeof (node as { value?: unknown }).value}:${JSON.stringify((node as { value?: unknown }).value)}`;
  }
  if (node.type === "TemplateLiteral") {
    const quasis = (node as { quasis?: Array<{ value?: { cooked?: string } }> }).quasis ?? [];
    return `tpl:${JSON.stringify(quasis[0]?.value?.cooked ?? "")}`;
  }
  if (node.type === "ArrayExpression") {
    const elements = (node as { elements?: unknown[] }).elements ?? [];
    const values = elements.map((element) => {
      if (!isOxcAstNode(element)) return "?";
      if (element.type !== "Literal") return "?";
      return JSON.stringify((element as { value?: unknown }).value);
    });
    return `arr:[${values.join(",")}]`;
  }
  return "?";
};

const previewLiteralNode = (node: OxcAstNode): string => {
  if (node.type === "Literal") {
    const value = (node as { value?: unknown }).value;
    if (typeof value === "string")
      return `"${value.length > 60 ? value.slice(0, 57) + "..." : value}"`;
    return String(value);
  }
  if (node.type === "TemplateLiteral") {
    const quasis = (node as { quasis?: Array<{ value?: { cooked?: string } }> }).quasis ?? [];
    const cooked = quasis[0]?.value?.cooked ?? "";
    return `\`${cooked.length > 60 ? cooked.slice(0, 57) + "..." : cooked}\``;
  }
  if (node.type === "ArrayExpression") {
    const elements = (node as { elements?: unknown[] }).elements ?? [];
    const head = elements
      .slice(0, 3)
      .map((element) =>
        isOxcAstNode(element) && element.type === "Literal"
          ? JSON.stringify((element as { value?: unknown }).value)
          : "?",
      )
      .join(", ");
    const suffix = elements.length > 3 ? `, +${elements.length - 3} more` : "";
    return `[${head}${suffix}]`;
  }
  return "<literal>";
};

const visitForConstants = (
  statementNode: unknown,
  candidates: DuplicateConstantCandidate[],
): void => {
  if (!isOxcAstNode(statementNode)) return;
  const inner =
    (statementNode.type === "ExportNamedDeclaration" ||
      statementNode.type === "ExportDefaultDeclaration") &&
    (statementNode as { declaration?: unknown }).declaration
      ? (statementNode as { declaration?: unknown }).declaration
      : statementNode;
  if (!isOxcAstNode(inner)) return;
  if (inner.type !== "VariableDeclaration") return;
  if ((inner as { kind?: string }).kind !== "const") return;
  const declarators = (inner as { declarations?: unknown[] }).declarations ?? [];
  for (const declarator of declarators) {
    if (!isOxcAstNode(declarator)) continue;
    const idNode = (declarator as { id?: OxcAstNode }).id;
    const initializerNode = (declarator as { init?: OxcAstNode }).init;
    if (!idNode || !initializerNode) continue;
    if (idNode.type !== "Identifier") continue;
    const constantName = (idNode as { name?: string }).name;
    if (!constantName) continue;
    if (FRAMEWORK_RESERVED_CONSTANT_NAMES.has(constantName)) continue;
    if (!isLiteralCandidate(initializerNode)) continue;
    candidates.push({
      constantName,
      literalHash: hashLiteralNode(initializerNode),
      literalPreview: previewLiteralNode(initializerNode),
      startOffset: declarator.start ?? inner.start ?? 0,
    });
  }
};

export const collectDuplicateConstantCandidates = (
  programBody: unknown[],
): DuplicateConstantCandidate[] => {
  const candidates: DuplicateConstantCandidate[] = [];
  for (const statement of programBody) {
    visitForConstants(statement, candidates);
  }
  return candidates;
};
