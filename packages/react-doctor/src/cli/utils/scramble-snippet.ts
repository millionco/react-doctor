import { parseSync } from "oxc-parser";

export interface ScrambleOptions {
  language?: "ts" | "tsx" | "js" | "jsx";
  // `offset`/`length` are UTF-16 code-unit indices into `source` (the units oxc
  // AST spans and `String.slice` use), NOT UTF-8 byte offsets. Callers holding
  // oxlint `Diagnostic` byte offsets must convert first or non-ASCII source
  // picks the wrong node.
  diagnostic?: { offset: number; length: number };
}

export interface ScrambledCode {
  source: string;
  hash: string;
  nodeType: string | null;
}

interface OxcAstNode {
  type: string;
  start?: number;
  end?: number;
  [key: string]: unknown;
}

interface SourceReplacement {
  start: number;
  end: number;
  text: string;
}

interface Span {
  start: number;
  end: number;
}

type PlaceholderKind = "hook" | "setter" | "getter" | "component" | "element" | "prop" | "var";

const FILENAME_FOR_LANGUAGE: Record<NonNullable<ScrambleOptions["language"]>, string> = {
  ts: "snippet.ts",
  tsx: "snippet.tsx",
  js: "snippet.js",
  jsx: "snippet.jsx",
};

const PLACEHOLDER_PREFIX: Record<PlaceholderKind, string> = {
  hook: "h",
  setter: "s",
  getter: "g",
  component: "C",
  element: "e",
  prop: "p",
  var: "v",
};

const RESERVED_IDENTIFIER_NAMES = new Set<string>(["constructor", "global"]);

const TOO_GRANULAR_NODES = new Set<string>([
  "Identifier",
  "JSXIdentifier",
  "PrivateIdentifier",
  "Literal",
  "MemberExpression",
  "Property",
  "JSXAttribute",
  "JSXExpressionContainer",
  "TemplateElement",
]);
const MAX_ENCLOSING_CLIMB = 6;

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const isOxcAstNode = (candidate: unknown): candidate is OxcAstNode =>
  typeof candidate === "object" && candidate !== null && "type" in candidate;

const offsetOf = (node: OxcAstNode): Span | null =>
  typeof node.start === "number" && typeof node.end === "number"
    ? { start: node.start, end: node.end }
    : null;

const visitChildren = (node: OxcAstNode, visit: (child: unknown) => void): void => {
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (Array.isArray(value)) for (const item of value) visit(item);
    else if (value && typeof value === "object") visit(value);
  }
};

const fingerprint = (input: string): string => {
  let hash = FNV_OFFSET_BASIS;
  for (let charIndex = 0; charIndex < input.length; charIndex++) {
    hash ^= input.charCodeAt(charIndex);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const parseProgram = (source: string, fileName: string): unknown | null => {
  try {
    const result = parseSync(fileName, source);
    if (result.errors.some((parseError) => parseError.severity === "Error")) return null;
    return result.program;
  } catch {
    return null;
  }
};

// tsx first then ts: value-position generics (`fn<T>()`, `<T>() => …`) parse as
// JSX under tsx rules, so the ts fallback is required when no language is given.
const parseSnippetProgram = (
  source: string,
  language: ScrambleOptions["language"],
): unknown | null => {
  if (language) return parseProgram(source, FILENAME_FOR_LANGUAGE[language]);
  return (
    parseProgram(source, FILENAME_FOR_LANGUAGE.tsx) ??
    parseProgram(source, FILENAME_FOR_LANGUAGE.ts)
  );
};

// oxc reports TemplateElement spans inconsistently (tsx wraps the
// `` ` ``/`${`/`}` delimiters, js is cooked text only) and raw text can exceed
// the span, so trim the real delimiter chars rather than using `raw.length`.
const templateInnerSpan = (source: string, localStart: number, localEnd: number): Span => {
  let start = localStart;
  let end = localEnd;
  if (source[start] === "`" || source[start] === "}") start += 1;
  if (source.slice(end - 2, end) === "${") end -= 2;
  else if (source[end - 1] === "`") end -= 1;
  return { start, end };
};

const classifyByName = (name: string): PlaceholderKind => {
  if (/^use[A-Z]/.test(name)) return "hook";
  if (/^set[A-Z]/.test(name)) return "setter";
  if (/^get[A-Z]/.test(name)) return "getter";
  if (/^[A-Z]/.test(name)) return "component";
  return "var";
};

const classifyJsxNodes = (program: unknown): Map<object, PlaceholderKind> => {
  const kinds = new Map<object, PlaceholderKind>();
  const visit = (node: unknown): void => {
    if (!isOxcAstNode(node)) return;
    if (
      (node.type === "JSXOpeningElement" || node.type === "JSXClosingElement") &&
      isOxcAstNode(node.name) &&
      node.name.type === "JSXIdentifier" &&
      typeof node.name.name === "string"
    ) {
      kinds.set(node.name, /^[A-Z]/.test(node.name.name) ? "component" : "element");
    }
    if (
      node.type === "JSXAttribute" &&
      isOxcAstNode(node.name) &&
      node.name.type === "JSXIdentifier"
    ) {
      kinds.set(node.name, "prop");
    }
    visitChildren(node, visit);
  };
  visit(program);
  return kinds;
};

// Keyed by (role, name), not name alone: one source name can play two roles
// (e.g. `className` as a var and a JSX attribute label) and each role keeps its
// own prefix, which keeps structurally identical snippets hashing identically.
const makePlaceholderFactory = (): ((name: string, kind: PlaceholderKind) => string) => {
  const assignedByKey = new Map<string, string>();
  const countByPrefix = new Map<string, number>();
  return (name, kind) => {
    const key = `${kind}\u0000${name}`;
    const existing = assignedByKey.get(key);
    if (existing !== undefined) return existing;
    const prefix = PLACEHOLDER_PREFIX[kind];
    const nextIndex = countByPrefix.get(prefix) ?? 0;
    countByPrefix.set(prefix, nextIndex + 1);
    const placeholder = `${prefix}${nextIndex}`;
    assignedByKey.set(key, placeholder);
    return placeholder;
  };
};

const scrambleReadable = (
  source: string,
  rootNode: unknown,
  jsxKinds: Map<object, PlaceholderKind>,
  offsetShift: number,
): string => {
  const placeholderFor = makePlaceholderFactory();
  const replacements: SourceReplacement[] = [];
  const add = (span: Span, text: string): void => {
    replacements.push({ start: span.start - offsetShift, end: span.end - offsetShift, text });
  };
  const visit = (node: unknown): void => {
    if (!isOxcAstNode(node)) return;
    const span = offsetOf(node);
    if (
      node.type === "Identifier" ||
      node.type === "JSXIdentifier" ||
      node.type === "PrivateIdentifier"
    ) {
      if (span && typeof node.name === "string" && !RESERVED_IDENTIFIER_NAMES.has(node.name)) {
        const kind = jsxKinds.get(node) ?? classifyByName(node.name);
        const isPrivate = node.type === "PrivateIdentifier";
        const placeholder = placeholderFor(isPrivate ? `#${node.name}` : node.name, kind);
        add(span, isPrivate ? `#${placeholder}` : placeholder);
      }
      visitChildren(node, visit);
      return;
    }
    if (
      node.type === "JSXText" &&
      span &&
      typeof node.value === "string" &&
      /\S/.test(node.value)
    ) {
      add(span, "t");
      return;
    }
    if (node.type === "Literal" && span) {
      if (typeof node.value === "string") add(span, '"s"');
      else if (typeof node.value === "number" || typeof node.value === "bigint") add(span, "0");
      else if (node.regex) add(span, "/re/");
    }
    if (node.type === "TemplateElement" && span) {
      const inner = templateInnerSpan(source, span.start - offsetShift, span.end - offsetShift);
      if (inner.end > inner.start) {
        replacements.push({ start: inner.start, end: inner.end, text: "" });
      }
    }
    visitChildren(node, visit);
  };
  visit(rootNode);

  replacements.sort((first, second) => second.start - first.start);
  let scrambled = source;
  let previousStart = Number.POSITIVE_INFINITY;
  for (const replacement of replacements) {
    if (replacement.end > previousStart || replacement.start < 0) continue;
    scrambled =
      scrambled.slice(0, replacement.start) + replacement.text + scrambled.slice(replacement.end);
    previousStart = replacement.start;
  }
  return scrambled;
};

const findMinimalNode = (program: unknown, offset: number, length: number): OxcAstNode | null => {
  const targetEnd = offset + Math.max(length, 1);
  let bestSize = Number.POSITIVE_INFINITY;
  const chain: OxcAstNode[] = [];
  let bestChain: OxcAstNode[] = [];
  const visit = (node: unknown): void => {
    if (!isOxcAstNode(node)) return;
    const span = offsetOf(node);
    if (span && span.start <= offset && span.end >= targetEnd) {
      chain.push(node);
      if (span.end - span.start < bestSize) {
        bestSize = span.end - span.start;
        bestChain = [...chain];
      }
      visitChildren(node, visit);
      chain.pop();
      return;
    }
    visitChildren(node, visit);
  };
  visit(program);
  if (bestChain.length === 0) return null;
  let index = bestChain.length - 1;
  let climbs = 0;
  while (
    index > 0 &&
    climbs < MAX_ENCLOSING_CLIMB &&
    TOO_GRANULAR_NODES.has(bestChain[index].type)
  ) {
    index -= 1;
    climbs += 1;
  }
  return bestChain[index];
};

export const scramble = (source: string, options: ScrambleOptions = {}): ScrambledCode | null => {
  const program = parseSnippetProgram(source, options.language);
  if (program === null) return null;
  const jsxKinds = classifyJsxNodes(program);

  let rootNode: unknown = program;
  let scrambledSource = source;
  let offsetShift = 0;
  let nodeType: string | null = null;

  if (options.diagnostic) {
    const node = findMinimalNode(program, options.diagnostic.offset, options.diagnostic.length);
    if (node === null) return null;
    rootNode = node;
    nodeType = node.type;
    const span = offsetOf(node);
    if (span) {
      scrambledSource = source.slice(span.start, span.end);
      offsetShift = span.start;
    }
  }

  const scrambledOutput = scrambleReadable(scrambledSource, rootNode, jsxKinds, offsetShift);
  return {
    source: scrambledOutput,
    hash: fingerprint(scrambledOutput),
    nodeType,
  };
};
