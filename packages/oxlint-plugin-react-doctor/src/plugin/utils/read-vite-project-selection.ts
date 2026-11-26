import * as fs from "node:fs";
import * as path from "node:path";
import { parse, defaultTreeAdapter } from "parse5";
import { analyzeScopes, type ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceText } from "./parse-source-file.js";

import {
  recordContentProbe,
  recordExistenceProbe,
  recordRealpathProbe,
} from "./cross-file-probe-recorder.js";

const CONFIG_FILES = [
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.ts",
  "vite.config.cjs",
  "vite.config.mts",
  "vite.config.cts",
];
const PRODUCTION_ENV_FILES = [".env", ".env.local", ".env.production", ".env.production.local"];
type LocalValue = "user-agent" | "body" | "comparison";
type Binding = NonNullable<ReturnType<ScopeAnalysis["symbolFor"]>>;

const propertyName = (node: EsTreeNode): string | null =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  !node.optional &&
  isNodeOfType(node.property, "Identifier")
    ? node.property.name
    : null;
const isPathFromGlobal = (
  node: EsTreeNode,
  names: readonly string[],
  scopes: ScopeAnalysis,
): boolean => {
  if (names.length === 1) {
    return (
      isNodeOfType(node, "Identifier") && node.name === names[0] && scopes.isGlobalReference(node)
    );
  }
  return (
    isNodeOfType(node, "MemberExpression") &&
    propertyName(node) === names.at(-1) &&
    isPathFromGlobal(node.object, names.slice(0, -1), scopes)
  );
};
const isStringLiteral = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "Literal") && typeof node.value === "string";
const callName = (call: EsTreeNode) =>
  isNodeOfType(call, "CallExpression") && !call.optional ? propertyName(call.callee) : null;

const hasOnlyBrowserAttributes = (source: string): boolean => {
  const program = parseSourceText({ filename: "index-prelude.js", sourceText: source });
  if (!isNodeOfType(program, "Program") || program.body.length !== 1) return false;
  const scopes = analyzeScopes(program);
  const [statement] = program.body;
  if (!isNodeOfType(statement, "ExpressionStatement")) return false;
  const call = statement.expression;
  if (
    !isNodeOfType(call, "CallExpression") ||
    callName(call) !== "addEventListener" ||
    !isPathFromGlobal(call.callee, ["document", "addEventListener"], scopes) ||
    call.arguments.length !== 2
  )
    return false;
  const [event, callback] = call.arguments;
  if (
    !isNodeOfType(event, "Literal") ||
    event.value !== "DOMContentLoaded" ||
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length ||
    !isNodeOfType(callback.body, "BlockStatement")
  )
    return false;

  const values = new Map<Binding, LocalValue>();
  const localValue = (node: EsTreeNode) => {
    if (!isNodeOfType(node, "Identifier")) return undefined;
    const binding = scopes.symbolFor(node);
    return binding ? values.get(binding) : undefined;
  };
  const readValue = (init: EsTreeNode): LocalValue | undefined => {
    if (isPathFromGlobal(init, ["document", "body"], scopes)) return "body";
    if (
      isNodeOfType(init, "CallExpression") &&
      callName(init) === "toLowerCase" &&
      init.arguments.length === 0 &&
      isPathFromGlobal(init.callee, ["window", "navigator", "userAgent", "toLowerCase"], scopes)
    ) {
      return "user-agent";
    }
    if (
      !isNodeOfType(init, "BinaryExpression") ||
      init.operator !== ">" ||
      !isNodeOfType(init.right, "UnaryExpression") ||
      init.right.operator !== "-" ||
      !isNodeOfType(init.right.argument, "Literal") ||
      init.right.argument.value !== 1
    )
      return undefined;
    const check = init.left;
    if (
      isNodeOfType(check, "CallExpression") &&
      callName(check) === "indexOf" &&
      isNodeOfType(check.callee, "MemberExpression") &&
      localValue(check.callee.object) === "user-agent" &&
      check.arguments.length === 1 &&
      isStringLiteral(check.arguments[0])
    )
      return "comparison";
    return undefined;
  };
  const allowedWrite = (node: EsTreeNode): boolean => {
    if (isNodeOfType(node, "BlockStatement")) return node.body.every(allowedWrite);
    if (isNodeOfType(node, "IfStatement")) {
      return (
        localValue(node.test) === "comparison" &&
        allowedWrite(node.consequent) &&
        (!node.alternate || allowedWrite(node.alternate))
      );
    }
    if (!isNodeOfType(node, "ExpressionStatement")) return false;
    const update = node.expression;
    if (
      !isNodeOfType(update, "CallExpression") ||
      callName(update) !== "setAttribute" ||
      !isNodeOfType(update.callee, "MemberExpression") ||
      localValue(update.callee.object) !== "body" ||
      update.arguments.length !== 2
    )
      return false;
    const [name, value] = update.arguments;
    return (
      isNodeOfType(name, "Literal") &&
      typeof name.value === "string" &&
      /^data-[a-z][a-z0-9-]*$/u.test(name.value) &&
      isStringLiteral(value)
    );
  };
  for (const entry of callback.body.body) {
    if (isNodeOfType(entry, "VariableDeclaration") && entry.kind === "const") {
      for (const item of entry.declarations) {
        if (!isNodeOfType(item.id, "Identifier") || !item.init) return false;
        const binding = scopes.symbolFor(item.id);
        const value = readValue(item.init);
        if (!binding || !value || binding.references.some(({ flag }) => flag !== "read"))
          return false;
        values.set(binding, value);
      }
    } else if (!allowedWrite(entry)) return false;
  }
  return true;
};

const readModuleScript = (html: string): string | null => {
  const document = parse(html);
  const queue: [typeof document | ReturnType<typeof defaultTreeAdapter.getChildNodes>[number]] = [
    document,
  ];
  let entry: string | null = null;
  for (const node of queue) {
    if (defaultTreeAdapter.isElementNode(node)) {
      const { tagName, attrs } = node;
      if (
        ["base", "iframe", "object", "embed", "template"].includes(tagName) ||
        attrs.some(({ name, value }) => name.startsWith("on") || /^\s*javascript:/iu.test(value))
      )
        return null;
      if (tagName === "script") {
        const type = attrs.find(({ name }) => name === "type")?.value;
        const source = attrs.find(({ name }) => name === "src")?.value;
        const body = node.childNodes
          .map((child) => (defaultTreeAdapter.isTextNode(child) ? child.value : ""))
          .join("");
        if (type === "module") {
          if (
            entry ||
            !source ||
            body.trim() ||
            attrs.length !== 2 ||
            !/^\/src\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.[jt]sx?$/u.test(source)
          )
            return null;
          entry = source;
        } else if (attrs.length !== 0 || !hasOnlyBrowserAttributes(body)) return null;
      }
    }
    if ("childNodes" in node) {
      for (const child of defaultTreeAdapter.getChildNodes(node)) queue.push(child);
    }
  }
  return entry;
};

export interface ScanSelection {
  readonly projectDirectory: string;
  readonly manifestFile: string;
  readonly configFile: string;
  readonly htmlFile: string;
  readonly moduleEntry: string;
}
interface ScanInputs {
  readonly existence: Set<string>;
  readonly content: Set<string>;
  readonly physical: Map<string, string>;
}

// Discovers the live project's declared default build inputs. Runtime
// compiler and plugin package selection must still be proved by the caller.
export interface DeclaredViteSelectionOptions {
  readonly allowTypeScriptNoEmitPrefix?: boolean;
}

export const readDeclaredViteSelection = (
  filename: string,
  options: DeclaredViteSelectionOptions = {},
): {
  selection: ScanSelection | null;
  inputs: ScanInputs;
} => {
  const inputs: ScanInputs = { existence: new Set(), content: new Set(), physical: new Map() };
  const rejected = { selection: null, inputs };
  const probe = (file: string) => {
    inputs.existence.add(file);
    recordExistenceProbe(file);
    return fs.lstatSync(file, { throwIfNoEntry: false });
  };
  const readFile = (file: string) => {
    if (!probe(file)?.isFile()) return null;
    inputs.content.add(file);
    recordContentProbe(file);
    recordRealpathProbe(file);
    if (fs.realpathSync(file) !== file) return null;
    return fs.readFileSync(file, "utf8");
  };
  const plainFile = (file: string) => {
    if (!probe(file)?.isFile()) return false;
    recordRealpathProbe(file);
    const real = fs.realpathSync(file);
    inputs.physical.set(file, real);
    return real === file;
  };
  try {
    if (!path.isAbsolute(filename) || !plainFile(filename)) return rejected;
    let directory = path.dirname(filename);
    while (true) {
      const manifestFile = path.join(directory, "package.json");
      if (probe(manifestFile)) {
        const raw = readFile(manifestFile);
        if (!raw) return rejected;
        const manifest = JSON.parse(raw);
        const scripts = manifest?.scripts;
        if (
          manifest?.private !== true ||
          ["exports", "main", "module", "browser"].some((key) => Object.hasOwn(manifest, key)) ||
          !scripts ||
          typeof scripts.build !== "string" ||
          !(
            options.allowTypeScriptNoEmitPrefix
              ? /^[ \t]*(?:tsc[ \t]*&&[ \t]*)?vite[ \t]+build[ \t]*$/u
              : /^[ \t]*vite[ \t]+build[ \t]*$/u
          ).test(scripts.build) ||
          ["prebuild", "postbuild"].some((key) => Object.hasOwn(scripts, key))
        )
          return rejected;
        const relative = path.relative(directory, filename);
        if (!relative.startsWith("src" + path.sep)) return rejected;
        if (PRODUCTION_ENV_FILES.some((name) => probe(path.join(directory, name)))) return rejected;
        const configFile = CONFIG_FILES.map((name) => path.join(directory, name)).find((file) =>
          probe(file),
        );
        if (!configFile || !plainFile(configFile)) return rejected;
        const htmlFile = path.join(directory, "index.html");
        const html = readFile(htmlFile);
        if (!html) return rejected;
        const source = readModuleScript(html);
        if (!source) return rejected;
        const moduleEntry = path.join(directory, source);
        if (!plainFile(moduleEntry)) return rejected;
        return {
          selection: {
            projectDirectory: directory,
            manifestFile,
            configFile,
            htmlFile,
            moduleEntry,
          },
          inputs,
        };
      }
      if (directory === path.dirname(directory)) return rejected;
      directory = path.dirname(directory);
    }
  } catch {
    return rejected;
  }
};
