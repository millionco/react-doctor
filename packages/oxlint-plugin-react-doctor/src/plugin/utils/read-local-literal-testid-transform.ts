import * as fs from "node:fs";
import * as path from "node:path";
import { analyzeScopes, type ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceText } from "./parse-source-file.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { normalizeFilename } from "./normalize-filename.js";
import {
  recordContentProbe,
  recordExistenceProbe,
  recordRealpathProbe,
} from "./cross-file-probe-recorder.js";
import {
  readDeclaredViteDefaultBuild,
  type DeclaredViteProjectionInputs,
} from "./read-declared-vite-default-build.js";

const MASKS = [
  /\s+data-testid\s*=\s*["'][^"']*["']/g,
  /\s+data-testid\s*=\s*\{[^{}]+\}/g,
  /\s+data-testid\s*=\s*\{`[^`]*`\}/g,
];
const ERASED_KEYS = new Set([
  "start",
  "end",
  "range",
  "loc",
  "parent",
  "raw",
  "typeAnnotation",
  "returnType",
  "typeParameters",
  "typeArguments",
]);
const MAX_BYTES = 2_000_000;

// This is an authored closed grammar, not an emitter loaded or evaluated from
// the subject project. Names and diagnostic logging are not part of the proof.
const GRAMMAR = `export function eraseTestIds() {
 return { name: 'literal-attribute-strip', apply: 'build', transform(source, filename) {
  if (filename.includes('node_modules')) return null;
  if (!filename.match(/src.*\\.(tsx|jsx)$/)) return null;
  if (process.env.NODE_ENV !== 'production') return null;
  let result = source;
  let changed = false;
  try {
   const quoted = /\\s+data-testid\\s*=\\s*["'][^"']*["']/g;
   const quotedMatches = result.match(quoted);
   if (quotedMatches && quotedMatches.length > 0) { result = result.replace(quoted, ''); changed = true; }
   const expression = /\\s+data-testid\\s*=\\s*\\{[^{}]+\\}/g;
   const expressionMatches = result.match(expression);
   if (expressionMatches && expressionMatches.length > 0) { result = result.replace(expression, ''); changed = true; }
   const template = /\\s+data-testid\\s*=\\s*\\{\u0060[^\u0060]*\u0060\\}/g;
   if (template.test(result)) { result = result.replace(template, ''); changed = true; }
   if (changed) {
    const opens = (result.match(/\\{/g) || []).length;
    const closes = (result.match(/\\}/g) || []).length;
    if (opens !== closes) { return null; }
    return { code: result, map: null };
   }
  } catch (error) { return null; }
  return null;
 } };
}`;

const astNode = (value: unknown): value is EsTreeNode =>
  typeof value === "object" && value !== null && "type" in value && typeof value.type === "string";

const ordinaryPropertyName = (node: EsTreeNode): boolean => {
  const parent = node.parent;
  return Boolean(
    parent &&
    ((isNodeOfType(parent, "MemberExpression") && !parent.computed && parent.property === node) ||
      ((isNodeOfType(parent, "Property") || isNodeOfType(parent, "MethodDefinition")) &&
        !parent.computed &&
        parent.key === node)),
  );
};

const isSafeLogArgument = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (isNodeOfType(node, "Literal"))
    return typeof node.value === "string" || typeof node.value === "number";
  if (isNodeOfType(node, "Identifier")) return Boolean(scopes.symbolFor(node));
  if (isNodeOfType(node, "TemplateLiteral"))
    return node.expressions.every((part) => isSafeLogArgument(part, scopes));
  return (
    isNodeOfType(node, "MemberExpression") &&
    !node.computed &&
    !node.optional &&
    isNodeOfType(node.object, "Identifier") &&
    Boolean(scopes.symbolFor(node.object)) &&
    isNodeOfType(node.property, "Identifier") &&
    node.property.name === "length"
  );
};
const isSafeLogStatement = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (
    !isNodeOfType(node, "ExpressionStatement") ||
    !isNodeOfType(node.expression, "CallExpression")
  )
    return false;
  const call = node.expression;
  const callee = call.callee;
  return (
    !call.optional &&
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    !callee.optional &&
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "console" &&
    scopes.isGlobalReference(callee.object) &&
    isNodeOfType(callee.property, "Identifier") &&
    ["log", "warn", "error"].includes(callee.property.name) &&
    call.arguments.every((argument) => isSafeLogArgument(argument, scopes))
  );
};

const normalizedAst = (root: EsTreeNode, scopes?: ScopeAnalysis): string => {
  const bindings = new Map<unknown, number>();
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value))
      return value
        .filter((item) => !(scopes && astNode(item) && isSafeLogStatement(item, scopes)))
        .map(visit);
    if (value === null || typeof value !== "object") return value;
    if (scopes && isNodeOfType(value, "BlockStatement")) {
      const statements = value.body.filter((statement) => !isSafeLogStatement(statement, scopes));
      if (statements.length === 1 && isNodeOfType(statements[0], "ReturnStatement"))
        return visit(statements[0]);
    }
    if (scopes && isNodeOfType(value, "Identifier") && !ordinaryPropertyName(value)) {
      const binding = scopes.symbolFor(value);
      if (binding) {
        if (!bindings.has(binding)) bindings.set(binding, bindings.size);
        return { type: "Identifier", binding: bindings.get(binding) };
      }
    }
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      if (ERASED_KEYS.has(key)) continue;
      const entry = (value as Record<string, unknown>)[key];
      if (key === "properties" && Array.isArray(entry)) {
        result[key] = entry
          .filter((property) => {
            if (
              !isNodeOfType(property, "Property") ||
              property.computed ||
              !isNodeOfType(property.key, "Identifier")
            )
              return true;
            if (property.key.name !== "enforce") return true;
            if (!isNodeOfType(property.value, "Literal") || property.value.value !== "pre")
              throw new Error("Unsupported plugin order");
            return false;
          })
          .map((property) => {
            if (
              isNodeOfType(property, "Property") &&
              !property.computed &&
              isNodeOfType(property.key, "Identifier") &&
              property.key.name === "name"
            ) {
              if (
                !isNodeOfType(property.value, "Literal") ||
                typeof property.value.value !== "string" ||
                !property.value.value ||
                property.value.value.startsWith("vite:")
              )
                throw new Error("Unsupported plugin name");
              return { type: "PluginName" };
            }
            return visit(property);
          });
      } else result[key] = visit(entry);
    }
    return result;
  };
  return JSON.stringify(visit(root));
};

const ownFile = (root: string, filename: string): string | null => {
  const relative = path.relative(root, filename);
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative))
    return null;
  recordExistenceProbe(filename);
  recordRealpathProbe(filename);
  recordContentProbe(filename);
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (
      !before.isFile() ||
      before.size > BigInt(MAX_BYTES) ||
      normalizeFilename(fs.realpathSync.native(filename)) !==
        normalizeFilename(path.resolve(filename))
    )
      return null;
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd, { bigint: true });
    const named = fs.lstatSync(filename, { bigint: true });
    if (
      [after, named].some(
        (entry) =>
          before.dev !== entry.dev ||
          before.ino !== entry.ino ||
          before.size !== entry.size ||
          before.mtimeNs !== entry.mtimeNs ||
          before.ctimeNs !== entry.ctimeNs,
      )
    )
      return null;
    return bytes.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
};

const directExport = (program: EsTreeNode, name: string): EsTreeNode | null => {
  if (!isNodeOfType(program, "Program")) return null;
  let found: EsTreeNode | null = null;
  const scopes = analyzeScopes(program);
  for (const statement of program.body) {
    if (isNodeOfType(statement, "ImportDeclaration")) {
      // The existing source spelling may import Vite's Plugin as a TS type.
      // Only that erased annotation name is supported here, never side effects.
      if (statement.source.value !== "vite" || statement.specifiers.length !== 1) return null;
      const specifier = statement.specifiers[0];
      if (
        !isNodeOfType(specifier, "ImportSpecifier") ||
        !isNodeOfType(specifier.imported, "Identifier") ||
        specifier.imported.name !== "Plugin"
      )
        return null;
      const binding = scopes.symbolFor(specifier.local);
      if (
        !binding ||
        binding.references.some(({ identifier }) => !isTypeScriptTypePosition(identifier))
      )
        return null;
      continue;
    }
    if (
      !isNodeOfType(statement, "ExportNamedDeclaration") ||
      statement.source ||
      statement.specifiers.length ||
      !isNodeOfType(statement.declaration, "FunctionDeclaration") ||
      statement.declaration.id?.name !== name ||
      found
    )
      return null;
    found = statement.declaration;
  }
  return found;
};

export interface LiteralTestIdSource {
  readonly filename: string;
  readonly sourceText: string;
}
export interface LiteralTestIdTransformInput {
  readonly projectRoot: string;
  readonly configFilename: string;
  readonly sources: readonly LiteralTestIdSource[];
  readonly projectionInputs?: Omit<DeclaredViteProjectionInputs, "localTransform">;
  /** The already qualified config-source resolver, including all earlier candidates. */
  readonly resolveLocalPlugin: (configFilename: string, specifier: string) => string | null;
}

/** Never executes project config, plugin or component. Compiler/ordering proof remains separate. */
export const readLocalLiteralTestIdTransform = (
  input: LiteralTestIdTransformInput,
): {
  readonly pluginFilename: string;
  readonly exportedName: string;
  readonly sourceOutputs: readonly {
    readonly filename: string;
    readonly output: string;
    readonly removed: number;
  }[];
  readonly requiresBeforeJsxLowering: true;
} | null => {
  try {
    if (!input.sources.length || path.dirname(input.configFilename) !== input.projectRoot)
      return null;
    const configText = ownFile(input.projectRoot, input.configFilename);
    const config =
      configText && parseSourceText({ filename: input.configFilename, sourceText: configText });
    if (!isNodeOfType(config, "Program")) return null;
    const candidates = config.body.flatMap((statement) => {
      if (
        !isNodeOfType(statement, "ImportDeclaration") ||
        statement.importKind === "type" ||
        typeof statement.source.value !== "string" ||
        !/^\.\/[A-Za-z0-9_-]+(?:\.[cm]?[jt]s)?$/u.test(statement.source.value)
      )
        return [];
      return statement.specifiers.flatMap((specifier) =>
        isNodeOfType(specifier, "ImportSpecifier") &&
        specifier.importKind !== "type" &&
        isNodeOfType(specifier.imported, "Identifier")
          ? [{ specifier: statement.source.value, exportedName: specifier.imported.name }]
          : [],
      );
    });
    const matches = candidates.filter(
      (candidate) =>
        readDeclaredViteDefaultBuild(input.configFilename, {
          ...input.projectionInputs,
          localTransform: candidate,
        }) !== null,
    );
    if (matches.length !== 1) return null;
    const selected = matches[0];
    const filename = input.resolveLocalPlugin(input.configFilename, selected.specifier);
    if (!filename) return null;
    const text = ownFile(input.projectRoot, filename);
    const program = text && parseSourceText({ filename, sourceText: text });
    if (!isNodeOfType(program, "Program")) return null;
    const emitter = directExport(program, selected.exportedName);
    const grammar = parseSourceText({ filename: "authored-strip-grammar.ts", sourceText: GRAMMAR });
    const expected = grammar && directExport(grammar, "eraseTestIds");
    if (
      !emitter ||
      !expected ||
      normalizedAst(emitter, analyzeScopes(program)) !==
        normalizedAst(expected, analyzeScopes(grammar!))
    )
      return null;
    const sourceOutputs = [];
    for (const source of input.sources) {
      if (
        !/^src.*\.(tsx|jsx)$/u.test(
          normalizeFilename(path.relative(input.projectRoot, source.filename)),
        ) ||
        source.filename.includes("node_modules")
      )
        return null;
      if (ownFile(input.projectRoot, source.filename) !== source.sourceText) return null;
      if (!source.sourceText.includes("data-testid")) {
        sourceOutputs.push({ filename: source.filename, output: source.sourceText, removed: 0 });
        continue;
      }
      const before = parseSourceText({ filename: source.filename, sourceText: source.sourceText });
      if (!isNodeOfType(before, "Program")) return null;
      const attributes: EsTreeNode[] = [];
      const collect = (value: unknown): void => {
        if (Array.isArray(value)) {
          value.forEach(collect);
          return;
        }
        if (!astNode(value)) return;
        if (
          isNodeOfType(value, "JSXAttribute") &&
          isNodeOfType(value.name, "JSXIdentifier") &&
          value.name.name === "data-testid"
        )
          attributes.push(value);
        for (const key of Object.keys(value))
          if (!ERASED_KEYS.has(key)) collect((value as unknown as Record<string, unknown>)[key]);
      };
      collect(before);
      // Track each actual sequential replacement back to the original text.
      // Uncut dynamic attributes remain in the AST and are never approved as
      // removable. A later pattern cannot borrow a cut from a prior pattern.
      let output = source.sourceText;
      let offsets = Array.from({ length: output.length }, (_, index) => index);
      const cuts: { start: number; end: number }[] = [];
      for (const mask of MASKS) {
        const matches = [...output.matchAll(mask)];
        const removed = new Set<number>();
        for (const match of matches) {
          const begin = match.index!;
          const finish = begin + match[0].length;
          cuts.push({ start: offsets[begin], end: offsets[finish - 1] + 1 });
          for (let index = begin; index < finish; index++) removed.add(index);
        }
        offsets = offsets.filter((_, index) => !removed.has(index));
        output = output.replace(mask, "");
      }
      const matchedAttributes = new Set<EsTreeNode>();
      for (const cut of cuts) {
        const matches = attributes.filter((attribute) => {
          if (!isNodeOfType(attribute, "JSXAttribute")) return false;
          const offsets = attribute as EsTreeNode & { start?: number; end?: number };
          const start = offsets.start;
          const end = offsets.end;
          return (
            typeof start === "number" &&
            typeof end === "number" &&
            cut.start <= start &&
            cut.end === end &&
            /^\s+$/u.test(source.sourceText.slice(cut.start, start))
          );
        });
        const [attribute] = matches;
        if (
          matches.length !== 1 ||
          !isNodeOfType(attribute, "JSXAttribute") ||
          matchedAttributes.has(attribute)
        )
          return null;
        const value = attribute.value;
        if (
          !(isNodeOfType(value, "Literal") && typeof value.value === "string") &&
          !(
            isNodeOfType(value, "JSXExpressionContainer") &&
            isNodeOfType(value.expression, "Literal") &&
            typeof value.expression.value === "string"
          )
        )
          return null;
        matchedAttributes.add(attribute);
      }
      const after = parseSourceText({ filename: source.filename, sourceText: output });
      if (!isNodeOfType(after, "Program")) return null;
      const withoutAttributes = (value: unknown): unknown => {
        if (Array.isArray(value))
          return value
            .filter((entry) => !matchedAttributes.has(entry as EsTreeNode))
            .map(withoutAttributes);
        if (value === null || typeof value !== "object") return value;
        const result: Record<string, unknown> = {};
        for (const key of Object.keys(value))
          if (!ERASED_KEYS.has(key))
            result[key] = withoutAttributes((value as Record<string, unknown>)[key]);
        return result;
      };
      if (JSON.stringify(withoutAttributes(before)) !== JSON.stringify(withoutAttributes(after)))
        return null;
      sourceOutputs.push({ filename: source.filename, output, removed: matchedAttributes.size });
    }
    return {
      pluginFilename: filename,
      exportedName: selected.exportedName,
      sourceOutputs,
      requiresBeforeJsxLowering: true,
    };
  } catch {
    return null;
  }
};
