import { parseSync } from "oxc-parser";

export interface ScrambleOptions {
  language?: "ts" | "tsx" | "js" | "jsx";
  /**
   * When set, scrambles only the smallest self-contained node spanning this
   * range instead of the whole source. `offset`/`length` are UTF-16 code-unit
   * indices into `source` (the same units oxc AST spans and `String.slice`
   * use) — NOT UTF-8 byte offsets. A caller holding oxlint `Diagnostic` byte
   * offsets must convert them to UTF-16 first, or non-ASCII source picks the
   * wrong node.
   */
  diagnostic?: { offset: number; length: number };
}

export interface ScrambledCode {
  /** Readable scrambled source: structure kept, names/literals blinded. */
  source: string;
  /** FNV-1a fingerprint (hex) of `source` — a stable dedup key. */
  hash: string;
  /** Node the extraction settled on (e.g. `CallExpression`), else null. */
  nodeType: string | null;
}

interface AstNode {
  type: string;
  start?: unknown;
  end?: unknown;
  [field: string]: unknown;
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

// Role inferred from a name without leaking it: `use*` hook, `set*` setter,
// `get*` getter, PascalCase component/class, else var. JSX tag + attribute
// roles can't be read from the name alone, so those are classified by node.
type PlaceholderKind = "hook" | "setter" | "getter" | "component" | "element" | "prop" | "var";

const FILENAME_FOR_LANGUAGE: Record<NonNullable<ScrambleOptions["language"]>, string> = {
  ts: "snippet.ts",
  tsx: "snippet.tsx",
  js: "snippet.js",
  jsx: "snippet.jsx",
};

// The prefix encodes the role (never the name) so the shape stays legible. The
// component/host split (`C`/`e`) also keeps JSX valid: `<C0>` is a component,
// `<e0>` a host tag, mirroring React's uppercase-vs-lowercase convention.
const PLACEHOLDER_PREFIX: Record<PlaceholderKind, string> = {
  hook: "h",
  setter: "s",
  getter: "g",
  component: "C",
  element: "e",
  prop: "p",
  var: "v",
};

// Contextual keywords that parse as `Identifier` but break re-parse when
// renamed: `constructor` (TS parameter properties) and `global`
// (`declare global { … }` ambient blocks).
const RESERVED_IDENTIFIER_NAMES = new Set<string>(["constructor", "global"]);

// Nodes too granular to be a useful diagnostic anchor; `findMinimalNode` climbs
// past them to the nearest meaningful enclosing node.
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

const isAstNode = (candidate: unknown): candidate is AstNode =>
  typeof candidate === "object" && candidate !== null && "type" in candidate;

const offsetOf = (node: AstNode): Span | null =>
  typeof node.start === "number" && typeof node.end === "number"
    ? { start: node.start, end: node.end }
    : null;

const visitChildren = (node: AstNode, visit: (child: unknown) => void): void => {
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

// An explicit `language` is authoritative. With no hint we try `tsx` first (JSX
// + most TS) then fall back to `ts`, because value-position generics (`fn<T>()`,
// `<T>() => …`) parse as JSX under TSX rules and would otherwise fail.
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

// The quasi-text slice of a TemplateElement span (local coordinates), delimiters
// trimmed. oxc reports these spans inconsistently (TS mode wraps the
// `` ` ``/`${`/`}` delimiters, JS mode is the cooked text only) and raw text can
// be longer than the span, so we trim the real delimiter characters off the span
// ends rather than computing the end from `raw.length` (which can overrun).
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

// JSX tag + attribute name nodes carry a role the name alone can't reveal (a
// host `div` vs a generic var; an attribute name vs a value). Classify those by
// node identity in a pre-pass; everything else falls back to `classifyByName`.
const classifyJsxNodes = (program: unknown): Map<object, PlaceholderKind> => {
  const kinds = new Map<object, PlaceholderKind>();
  const visit = (node: unknown): void => {
    if (!isAstNode(node)) return;
    if (
      (node.type === "JSXOpeningElement" || node.type === "JSXClosingElement") &&
      isAstNode(node.name) &&
      node.name.type === "JSXIdentifier" &&
      typeof node.name.name === "string"
    ) {
      kinds.set(node.name, /^[A-Z]/.test(node.name.name) ? "component" : "element");
    }
    if (
      node.type === "JSXAttribute" &&
      isAstNode(node.name) &&
      node.name.type === "JSXIdentifier"
    ) {
      kinds.set(node.name, "prop");
    }
    visitChildren(node, visit);
  };
  visit(program);
  return kinds;
};

// Placeholders are keyed by (role, name), not name alone: one source name can
// play two roles — e.g. `className` as both a destructured var and a JSX
// attribute label — and each role keeps its own prefix. Keying by name only
// would let whichever role was seen first win, so structurally identical
// snippets differing only in an underlying name would scramble (and hash)
// differently. `\u0000` can't occur in an identifier, so it's a safe separator.
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

// Rewrite the source in place: EVERY identifier (incl. React APIs, JSX tags,
// DOM/a11y attributes) → a role-prefixed placeholder applied consistently, and
// every literal blinded. `offsetShift` rebases the AST's absolute offsets onto
// `source` when `source` is a slice of the original (minimal-node extraction).
const scrambleReadable = (
  source: string,
  rootNode: unknown,
  jsxKinds: Map<object, PlaceholderKind>,
  offsetShift: number,
): string => {
  const placeholderFor = makePlaceholderFactory();
  const replacements: SourceReplacement[] = [];
  // Replacements are stored in `source`-local coordinates; `add` rebases the
  // AST's absolute span once at the call site so nothing downstream re-shifts.
  const add = (span: Span, text: string): void => {
    replacements.push({ start: span.start - offsetShift, end: span.end - offsetShift, text });
  };
  const visit = (node: unknown): void => {
    if (!isAstNode(node)) return;
    const span = offsetOf(node);
    if (
      node.type === "Identifier" ||
      node.type === "JSXIdentifier" ||
      node.type === "PrivateIdentifier"
    ) {
      if (span && typeof node.name === "string" && !RESERVED_IDENTIFIER_NAMES.has(node.name)) {
        const kind = jsxKinds.get(node) ?? classifyByName(node.name);
        // A `PrivateIdentifier` span includes the leading `#` but `name` does
        // not. Keep the `#` (and a `#`-scoped key) so `#x` stays a private
        // field, re-parses, and never collides with a public `x`.
        const isPrivate = node.type === "PrivateIdentifier";
        const placeholder = placeholderFor(isPrivate ? `#${node.name}` : node.name, kind);
        add(span, isPrivate ? `#${placeholder}` : placeholder);
      }
      // Fall through to children: a typed binding carries its `typeAnnotation`
      // as a child, and those type names must be blinded too.
      visitChildren(node, visit);
      return;
    }
    if (
      node.type === "JSXText" &&
      span &&
      typeof node.value === "string" &&
      /\S/.test(node.value)
    ) {
      // Visible text between JSX tags can carry copy / customer data. Collapse
      // the whole run (surrounding whitespace included) to a single token.
      add(span, "t");
      return;
    }
    if (node.type === "Literal" && span) {
      if (typeof node.value === "string") add(span, '"s"');
      else if (typeof node.value === "number" || typeof node.value === "bigint") add(span, "0");
      else if (node.regex) add(span, "/re/");
    }
    // Blank only the quasi text so the template's `${expr}` structure and
    // backticks survive in both parser modes; otherwise adjacent `${a}${b}`
    // fuse into one name. `templateInnerSpan` works in local coordinates, so
    // push directly instead of round-tripping back through `add`.
    if (node.type === "TemplateElement" && span) {
      const inner = templateInnerSpan(source, span.start - offsetShift, span.end - offsetShift);
      if (inner.end > inner.start) {
        replacements.push({ start: inner.start, end: inner.end, text: "" });
      }
    }
    visitChildren(node, visit);
  };
  visit(rootNode);

  // Right-to-left; skip spans overlapping the previous one (shorthand patterns
  // emit key + value sharing one span, which would otherwise double-slice).
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

// The smallest self-contained node spanning the byte range, climbing past
// overly granular nodes to the nearest meaningful enclosing one.
const findMinimalNode = (program: unknown, offset: number, length: number): AstNode | null => {
  const targetEnd = offset + Math.max(length, 1);
  let bestSize = Number.POSITIVE_INFINITY;
  const chain: AstNode[] = [];
  let bestChain: AstNode[] = [];
  const visit = (node: unknown): void => {
    if (!isAstNode(node)) return;
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

/**
 * Scrambles a snippet so EVERY identifier becomes a role-prefixed placeholder
 * applied consistently (so aliasing survives) — including React APIs, component
 * names, JSX tags, and DOM/a11y attributes — and every string / numeric /
 * template / regex literal is blinded. The prefix encodes the role, never the
 * name (`h`ook / `s`etter / `g`etter / `C`omponent / host `e`lement / `p`rop /
 * `v`ar). Returns the readable scrambled `source` plus a stable `hash` of it.
 *
 * With `options.diagnostic`, scrambles only the minimal node spanning the given
 * range (UTF-16 code-unit offsets, matching oxc AST spans). Returns `null` when
 * the source can't be parsed or no node spans the range.
 */
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
