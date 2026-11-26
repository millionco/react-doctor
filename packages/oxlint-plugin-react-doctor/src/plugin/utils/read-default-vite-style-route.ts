import * as path from "node:path/posix";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceText } from "./parse-source-file.js";
import type { EsTreeNode } from "./es-tree-node.js";

type Lookup =
  | { readonly kind: "file"; readonly text: string }
  | { readonly kind: "absent" | "blocked" };
interface ExternalStyle {
  readonly packageName: string;
  readonly version: string;
  readonly member: string;
  readonly text: string;
}
export interface StyleRouteInput {
  readonly localRoots: readonly string[];
  readonly externalRoots: readonly string[];
  readonly sourceAliases: ReadonlyMap<string, string>;
  readonly externalStyles: ReadonlyMap<string, ExternalStyle>;
  readonly lookup: (relativePath: string) => Lookup;
}
type Directive = {
  readonly kind: "import" | "use" | "forward" | "config";
  readonly source: string;
  readonly line: number;
};

const POSTCSS_FILES = [
  "package.json",
  ".postcssrc",
  ".postcssrc.json",
  ".postcssrc.yaml",
  ".postcssrc.yml",
  ".postcssrc.ts",
  ".postcssrc.cts",
  ".postcssrc.mts",
  ".postcssrc.js",
  ".postcssrc.cjs",
  ".postcssrc.mjs",
  "postcss.config.ts",
  "postcss.config.cts",
  "postcss.config.mts",
  "postcss.config.js",
  "postcss.config.cjs",
  "postcss.config.mjs",
];
const TAILWIND_FILES = [
  "tailwind.config.js",
  "tailwind.config.cjs",
  "tailwind.config.mjs",
  "tailwind.config.ts",
  "tailwind.config.cts",
  "tailwind.config.mts",
];

const stylePath = /^[A-Za-z0-9_./-]+\.(?:css|scss)$/u;
const projectPath = /^[A-Za-z0-9_./-]+$/u;
const inside = (name: string): boolean =>
  projectPath.test(name) &&
  !path.isAbsolute(name) &&
  !name.split("/").some((part) => part === ".." || part === "");

// The accepted stylesheet lane has only ordinary CSS at-rules and literal
// file directives. Strings and comments are skipped before inspecting tokens.
export const readStyleFileDirectives = (
  text: string,
  scss: boolean,
  allowedAtRules?: ReadonlySet<string>,
): Directive[] | null => {
  const items: Directive[] = [];
  let line = 1;
  let parentheses = 0;
  for (let start = 0; start < text.length; ) {
    const c = text[start];
    if (c === "\n") {
      line += 1;
      start += 1;
      continue;
    }
    if (text.startsWith("/*", start)) {
      const end = text.indexOf("*/", start + 2);
      if (end < 0) return null;
      line += (text.slice(start, end).match(/\n/g) ?? []).length;
      start = end + 2;
      continue;
    }
    if (scss && text.startsWith("//", start)) {
      if (parentheses !== 0 || text[start - 1] === ":") return null;
      const end = text.indexOf("\n", start + 2);
      start = end < 0 ? text.length : end;
      continue;
    }
    if (c === "'" || c === '"') {
      let end = start + 1;
      for (; end < text.length && text[end] !== c; end++) {
        if (scss && text.startsWith("#{", end)) return null;
        if (text[end] === "\\") end += 1;
        else if (text[end] === "\n") line += 1;
      }
      if (end >= text.length) return null;
      start = end + 1;
      continue;
    }
    if (scss && text.startsWith("#{", start)) return null;
    if (c === "(") parentheses += 1;
    if (c === ")") parentheses -= 1;
    if (parentheses < 0) return null;
    if (c !== "@") {
      start += 1;
      continue;
    }
    const name = /^[A-Za-z-]+/u.exec(text.slice(start + 1))?.[0];
    if (!name || text[start + 1 + name.length] === "\\") return null;
    const lower = name.toLowerCase();
    if (allowedAtRules && !allowedAtRules.has(lower)) return null;
    if (scss && (lower === "at-root" || lower === "function")) return null;
    if (lower === "config" || lower === "import" || lower === "use" || lower === "forward") {
      const rule = /^\s+(['"])([A-Za-z0-9_@./-]+)\1\s*;/u.exec(text.slice(start + 1 + name.length));
      if (!rule?.[0] || !rule[2]) return null;
      items.push({ kind: lower, source: rule[2], line });
      line += (rule[0].match(/\n/g) ?? []).length;
      start += 1 + name.length + rule[0].length;
    } else {
      start += 1 + name.length;
    }
  }
  return parentheses === 0 ? items : null;
};

const literal = (node: EsTreeNode | undefined): string | null =>
  isNodeOfType(node, "Literal") && typeof node.value === "string" ? node.value : null;

const fields = (node: EsTreeNode | null | undefined): Map<string, EsTreeNode> | null => {
  if (!isNodeOfType(node, "ObjectExpression")) return null;
  const entries = new Map<string, EsTreeNode>();
  for (const property of node.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.kind !== "init" ||
      property.computed ||
      property.method
    )
      return null;
    const key = getStaticPropertyKeyName(property);
    if (!key || ["__proto__", "prototype", "constructor"].includes(key) || entries.has(key))
      return null;
    entries.set(key, property.value);
  }
  return entries;
};

const stylesheetVariants = (name: string, importOnly: boolean): readonly string[] => {
  const dir = path.dirname(name);
  const base = path.basename(name);
  const ext = path.extname(name);
  const stem = base.slice(0, -ext.length);
  return [
    name,
    path.join(dir, "_" + base),
    ...(importOnly
      ? [path.join(dir, stem + ".import" + ext), path.join(dir, "_" + stem + ".import" + ext)]
      : []),
  ];
};

type StyleFileInputs = Omit<StyleRouteInput, "externalStyles">;
interface ExternalStylesheetLookup {
  readonly isKnownSpecifier: (specifier: string) => boolean;
  readonly accepts: (specifier: string) => boolean;
}

const readDefaultViteStyleGraph = (input: StyleFileInputs, external: ExternalStylesheetLookup) => {
  const positives = new Set<string>();
  const absences = new Set<string>();
  const edges: { from: string; line: number; kind: string; source: string; selected: string }[] =
    [];
  const nodes = new Set<string>();
  let rejected = false;
  const get = (relative: string): string | null => {
    if (!inside(relative)) {
      rejected = true;
      return null;
    }
    const file = input.lookup(relative);
    if (file.kind === "file") {
      positives.add(relative);
      return file.text;
    }
    if (file.kind === "absent") absences.add(relative);
    else rejected = true;
    return null;
  };
  const packageText = get("package.json");
  if (!packageText) return null;
  try {
    const manifest: unknown = JSON.parse(packageText);
    if (
      !manifest ||
      typeof manifest !== "object" ||
      Array.isArray(manifest) ||
      Object.hasOwn(manifest, "postcss")
    )
      return null;
  } catch {
    return null;
  }
  for (const name of [...POSTCSS_FILES, ...TAILWIND_FILES]) {
    if (["package.json", "postcss.config.cjs", "tailwind.config.cjs"].includes(name)) continue;
    if (get(name) !== null || rejected) return null;
  }

  const dataConfigFiles = new Set<string>();
  const visiting = new Set<string>();
  const readClosedConfig = (file: string, role: "postcss" | "tailwind" | "data"): boolean => {
    if (visiting.has(file)) return false;
    if (role === "data" && dataConfigFiles.has(file)) return true;
    const sourceText = get(file);
    if (sourceText === null) return false;
    const ast = parseSourceText({ filename: file, sourceText });
    if (!isNodeOfType(ast, "Program")) return false;
    const scopes = analyzeScopes(ast);
    const dependencies = new Set<number>();
    const requireSource = (node: EsTreeNode | null | undefined): string | null =>
      isNodeOfType(node, "CallExpression") &&
      !node.optional &&
      node.arguments.length === 1 &&
      isNodeOfType(node.callee, "Identifier") &&
      node.callee.name === "require" &&
      scopes.isGlobalReference(node.callee)
        ? literal(node.arguments[0])
        : null;
    const assignment = ast.body.at(-1);
    if (
      !isNodeOfType(assignment, "ExpressionStatement") ||
      !isNodeOfType(assignment.expression, "AssignmentExpression") ||
      assignment.expression.operator !== "="
    )
      return false;
    const { left, right } = assignment.expression;
    if (
      !isNodeOfType(left, "MemberExpression") ||
      left.computed ||
      left.optional ||
      !isNodeOfType(left.object, "Identifier") ||
      left.object.name !== "module" ||
      !scopes.isGlobalReference(left.object) ||
      !isNodeOfType(left.property, "Identifier") ||
      left.property.name !== "exports"
    )
      return false;
    visiting.add(file);
    for (const statement of ast.body.slice(0, -1)) {
      if (
        role === "postcss" ||
        !isNodeOfType(statement, "VariableDeclaration") ||
        statement.kind !== "const"
      )
        return false;
      for (const declaration of statement.declarations) {
        if (!isNodeOfType(declaration.id, "Identifier")) return false;
        const source = requireSource(declaration.init);
        const binding = scopes.symbolFor(declaration.id);
        if (
          !source ||
          !source.startsWith("./") ||
          !source.endsWith(".cjs") ||
          !binding ||
          binding.references.some(({ flag }) => flag !== "read")
        )
          return false;
        const target = path.normalize(path.join(path.dirname(file), source));
        if (!inside(target) || !readClosedConfig(target, "data")) return false;
        dependencies.add(binding.id);
      }
    }
    const isRequiredData = (value: EsTreeNode): boolean => {
      if (isNodeOfType(value, "Identifier")) {
        const symbol = scopes.symbolFor(value);
        return !!symbol && dependencies.has(symbol.id);
      }
      if (isNodeOfType(value, "MemberExpression") && !value.optional) {
        const member = value.computed
          ? literal(value.property)
          : isNodeOfType(value.property, "Identifier")
            ? value.property.name
            : null;
        return (
          !!member &&
          !["__proto__", "constructor", "prototype"].includes(member) &&
          isRequiredData(value.object)
        );
      }
      return false;
    };
    const isData = (node: EsTreeNode): boolean => {
      if (isRequiredData(node)) return true;
      if (isNodeOfType(node, "Literal"))
        return node.value === null || ["number", "string", "boolean"].includes(typeof node.value);
      if (isNodeOfType(node, "ArrayExpression"))
        return node.elements.every((item) => !!item && isData(item));
      if (!isNodeOfType(node, "ObjectExpression")) return false;
      return node.properties.every((property) => {
        if (isNodeOfType(property, "SpreadElement")) return isRequiredData(property.argument);
        if (
          !isNodeOfType(property, "Property") ||
          property.kind !== "init" ||
          property.computed ||
          property.method
        )
          return false;
        const key = getStaticPropertyKeyName(property, { stringifyNonStringLiterals: true });
        if (!key || ["__proto__", "prototype", "constructor"].includes(key)) return false;
        return isData(property.value);
      });
    };
    let accepted = false;
    if (role === "data") {
      accepted = isNodeOfType(right, "ObjectExpression") && isData(right);
      if (accepted) dataConfigFiles.add(file);
    } else if (role === "postcss") {
      const object = fields(right);
      const plugins = fields(object?.get("plugins"));
      accepted =
        object?.size === 1 &&
        plugins?.size === 2 &&
        [...plugins.keys()].join(",") === "tailwindcss,autoprefixer" &&
        fields(plugins.get("tailwindcss"))?.size === 0 &&
        fields(plugins.get("autoprefixer"))?.size === 0;
    } else {
      const object = fields(right);
      const plugins = object?.get("plugins");
      const content = object?.get("content");
      accepted =
        !!object &&
        isNodeOfType(plugins, "ArrayExpression") &&
        plugins.elements.length === 1 &&
        requireSource(plugins.elements[0]) === "tailwindcss-animate" &&
        isNodeOfType(content, "ArrayExpression") &&
        content.elements.every((item) => {
          const name = literal(item ?? undefined);
          return !!name?.startsWith("./") && !name.split("/").includes("..");
        }) &&
        [...object].every(
          ([key, value]) =>
            key === "plugins" ||
            (["content", "important", "darkMode", "theme"].includes(key) && isData(value)),
        );
    }
    visiting.delete(file);
    return accepted;
  };
  if (
    !readClosedConfig("postcss.config.cjs", "postcss") ||
    !readClosedConfig("tailwind.config.cjs", "tailwind")
  )
    return null;

  const externalSeen = new Set<string>();
  const includeExternal = (specifier: string): boolean => {
    if (externalSeen.has(specifier)) return true;
    if (!external.accepts(specifier)) return false;
    externalSeen.add(specifier);
    return true;
  };

  const resolve = (from: string, directive: Directive): string | null => {
    const { source, kind } = directive;
    const scss = from.endsWith(".scss");
    if (kind === "config") return null;
    if (!scss && kind !== "import") return null;
    if (kind === "import" && scss && source.endsWith(".css")) return null;
    if (!source.startsWith(".") && external.isKnownSpecifier(source)) {
      // Vite CSS resolution prefers a valid local path, then selected bare packages.
      const relative = path.join(path.dirname(from), source);
      if (
        [relative, relative + ".css"].some((name) => get(name) !== null) ||
        rejected ||
        scss ||
        !includeExternal(source)
      )
        return null;
      return "package:" + source;
    }
    if (!stylePath.test(source) || source.startsWith("/") || source.includes("/../")) return null;
    const local = path.normalize(path.join(path.dirname(from), source));
    const candidates = new Set(
      scss && source.endsWith(".scss") ? stylesheetVariants(local, kind === "import") : [local],
    );
    if (!source.startsWith(".")) {
      const prefix = source.split("/", 1)[0];
      const replacement = prefix ? input.sourceAliases.get(prefix) : undefined;
      if (!replacement || !prefix) return null;
      const atAlias = path.normalize(path.join(replacement, source.slice(prefix.length + 1)));
      for (const choice of stylesheetVariants(atAlias, kind === "import")) candidates.add(choice);
    }
    const found = [...candidates].filter((candidate) => get(candidate) !== null);
    return found.length === 1 && !rejected ? (found[0] ?? null) : null;
  };

  const includeLocal = (file: string): boolean => {
    if (visiting.has(file)) return false;
    if (nodes.has(file)) return true;
    if (!stylePath.test(file) || /\.module\./u.test(file) || !inside(file)) return false;
    const text = get(file);
    if (text === null) return false;
    const directives = readStyleFileDirectives(text, file.endsWith(".scss"));
    if (!directives) return false;
    visiting.add(file);
    for (const directive of directives) {
      const selected = resolve(file, directive);
      if (!selected || (!selected.startsWith("package:") && !includeLocal(selected))) return false;
      edges.push({ from: file, ...directive, selected });
    }
    visiting.delete(file);
    nodes.add(file);
    return true;
  };
  if (
    !input.localRoots.length ||
    !input.localRoots.every(includeLocal) ||
    !input.externalRoots.every(includeExternal) ||
    rejected
  )
    return null;
  return {
    stylesheets: [...nodes].sort(),
    externalStyles: [...externalSeen].sort(),
    edges,
    configFiles: ["postcss.config.cjs", "tailwind.config.cjs", ...dataConfigFiles],
    positivePaths: [...positives].sort(),
    absentPaths: [...absences].sort(),
    packageProviders: ["postcss", "tailwindcss", "tailwindcss-animate", "autoprefixer", "sass"],
    bundledViteLoaders: ["postcss-load-config", "postcss-import"],
    unresolvedProviderChoices: [
      "sass-embedded",
      "vite-package-fallback",
      "actual-package-export-realpaths",
    ],
  };
};

// This pass identifies candidate requests. A successful parse here does not
// establish external provider identity, bytes, or closure.
export const discoverDefaultViteStyleRequests = (
  input: StyleFileInputs,
  isKnownSpecifier: (specifier: string) => boolean,
) => readDefaultViteStyleGraph(input, { isKnownSpecifier, accepts: isKnownSpecifier });

export const readDefaultViteStyleRoute = (input: StyleRouteInput) =>
  readDefaultViteStyleGraph(input, {
    isKnownSpecifier: (specifier) => input.externalStyles.has(specifier),
    accepts: (specifier) => {
      const entry = input.externalStyles.get(specifier);
      return (
        !!entry &&
        stylePath.test(entry.member) &&
        inside(entry.member) &&
        entry.member.endsWith(".css") &&
        readStyleFileDirectives(entry.text, false)?.length === 0
      );
    },
  });
