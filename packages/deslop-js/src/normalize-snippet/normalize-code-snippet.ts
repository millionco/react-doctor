import { parseSync } from "oxc-parser";
import { isAstNode } from "../utils/is-ast-node.js";

export interface ScrambleOptions {
  language?: "ts" | "tsx" | "js" | "jsx";
  /**
   * When set, scrambles only the smallest self-contained node spanning this
   * byte range (an `offset`/`length`) instead of the whole source.
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

interface SourceReplacement {
  start: number;
  end: number;
  text: string;
}

interface AstNodeLike {
  type: string;
  start?: unknown;
  end?: unknown;
  [field: string]: unknown;
}

const FILENAME_FOR_LANGUAGE: Record<NonNullable<ScrambleOptions["language"]>, string> = {
  ts: "snippet.ts",
  tsx: "snippet.tsx",
  js: "snippet.js",
  jsx: "snippet.jsx",
};

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

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

// Resolve the program for a snippet. An explicit `language` is authoritative —
// the caller knows the file's extension. With no hint we try `tsx` first (JSX +
// most TS) then fall back to `ts`, because value-position generics (`fn<T>()`,
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

const offsetOf = (node: AstNodeLike): { start: number; end: number } | null => {
  if (typeof node.start !== "number" || typeof node.end !== "number") return null;
  return { start: node.start, end: node.end };
};

// Length of a TemplateElement's raw (source) text, used to blank only the text
// and never the delimiters — independent of how the parser reports the span.
const templateRawLength = (node: AstNodeLike): number | null => {
  const value = node.value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const raw = (value as { raw?: unknown }).raw;
    if (typeof raw === "string") return raw.length;
  }
  return null;
};

const visitChildren = (node: Record<string, unknown>, visit: (child: unknown) => void): void => {
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (Array.isArray(value)) for (const item of value) visit(item);
    else if (value && typeof value === "object") visit(value);
  }
};

// Placeholder kinds: every name is still scrambled, but the prefix encodes its
// *role* (never its actual name) so the shape stays legible — `h0` is a hook,
// `s0` a setter/mutation, `g0` a getter, `C0` a component, `e0` a host element,
// `p0` a prop/attribute, `v0` an everything-else variable. The component/host
// split (`C`/`e`) also keeps the JSX valid: `<C0>` stays a component, `<e0>` a
// host tag, mirroring React's uppercase-vs-lowercase convention.
type PlaceholderKind = "hook" | "setter" | "getter" | "component" | "element" | "prop" | "var";

// Contextual keywords that parse as `Identifier` but break re-parse when
// renamed, so they're left verbatim. See the rename pass.
const RESERVED_IDENTIFIER_NAMES = new Set<string>(["constructor", "global"]);

const PLACEHOLDER_PREFIX: Record<PlaceholderKind, string> = {
  hook: "h",
  setter: "s",
  getter: "g",
  component: "C",
  element: "e",
  prop: "p",
  var: "v",
};

// Role inferred from naming convention alone (no name leaks): `use*` is a hook,
// `set*` a setter, `get*` a getter, PascalCase a component/class, else a var.
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

const makePlaceholderFactory = (): ((name: string, kind: PlaceholderKind) => string) => {
  const assignedByName = new Map<string, string>();
  const countByPrefix = new Map<string, number>();
  return (name: string, kind: PlaceholderKind): string => {
    const existing = assignedByName.get(name);
    if (existing !== undefined) return existing;
    const prefix = PLACEHOLDER_PREFIX[kind];
    const nextIndex = countByPrefix.get(prefix) ?? 0;
    countByPrefix.set(prefix, nextIndex + 1);
    const placeholder = `${prefix}${nextIndex}`;
    assignedByName.set(name, placeholder);
    return placeholder;
  };
};

// --- Readable scramble: rewrite the source in place. EVERY identifier (incl.
// React APIs, JSX tags, DOM/a11y attributes) → a role-prefixed placeholder
// applied consistently, and every literal blinded. Nothing is preserved.
// `offsetShift` rebases the AST's absolute offsets onto `source` when `source`
// is a slice of the original (minimal-node extraction).
const scrambleReadable = (
  source: string,
  rootNode: unknown,
  jsxKinds: Map<object, PlaceholderKind>,
  offsetShift: number,
): string => {
  const placeholderFor = makePlaceholderFactory();
  const replacements: SourceReplacement[] = [];
  const add = (span: { start: number; end: number }, text: string): void => {
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
      // A handful of contextual keywords surface as `Identifier` nodes and lose
      // their meaning when renamed, so they're kept verbatim: `constructor`
      // (TS parameter properties need the constructor-ness) and `global`
      // (`declare global { … }` ambient blocks). Both break re-parse otherwise.
      if (span && typeof node.name === "string" && !RESERVED_IDENTIFIER_NAMES.has(node.name)) {
        const kind = jsxKinds.get(node) ?? classifyByName(node.name);
        // A `PrivateIdentifier` span includes the leading `#`, but `name` does
        // not. Keep the `#` (and a `#`-scoped lookup key) so `#x` stays a private
        // field, re-parses, and never collides with a public `x`.
        const isPrivate = node.type === "PrivateIdentifier";
        const placeholder = placeholderFor(isPrivate ? `#${node.name}` : node.name, kind);
        add(span, isPrivate ? `#${placeholder}` : placeholder);
      }
      // Fall through to children: a typed binding carries its `typeAnnotation`
      // as a child of the identifier, and those type names must be blinded too.
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
      // the whole run (surrounding whitespace included) to a single token; JSX
      // text is always re-parseable regardless of content.
      add(span, "t");
      return;
    }
    if (node.type === "Literal" && span) {
      if (typeof node.value === "string") add(span, '"s"');
      else if (typeof node.value === "number" || typeof node.value === "bigint") add(span, "0");
      else if (node.regex) add(span, "/re/");
    }
    // oxc reports TemplateElement spans inconsistently — TS mode includes the
    // surrounding delimiters (`` ` ``/`${`/`}`), JS mode is the cooked text only.
    // Blank exactly the raw-text characters (length-driven) so the template's
    // `${expr}` structure and backticks always survive in both modes; otherwise
    // the delimiters are destroyed and adjacent `${a}${b}` fuse into one name.
    if (node.type === "TemplateElement" && span) {
      const rawLength = templateRawLength(node);
      if (rawLength !== null && rawLength > 0) {
        const includesDelimiters = span.end - span.start !== rawLength;
        const textStart = includesDelimiters ? span.start + 1 : span.start;
        add({ start: textStart, end: textStart + rawLength }, "");
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

// --- Minimal-node extraction around a diagnostic.
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

const findMinimalNode = (program: unknown, offset: number, length: number): AstNodeLike | null => {
  const targetEnd = offset + Math.max(length, 1);
  let bestSize = Number.POSITIVE_INFINITY;
  const chain: AstNodeLike[] = [];
  let bestChain: AstNodeLike[] = [];
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
 * byte range. Returns `null` when the source can't be parsed or no node spans
 * the range.
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
