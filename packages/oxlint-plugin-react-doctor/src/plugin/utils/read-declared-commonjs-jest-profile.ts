import * as fs from "node:fs";
import * as path from "node:path";
import { analyzeScopes, type ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceText } from "./parse-source-file.js";

import {
  recordContentProbe,
  recordExistenceProbe,
  recordRealpathProbe,
} from "./cross-file-probe-recorder.js";

type Binding = NonNullable<ReturnType<ScopeAnalysis["symbolFor"]>>;

type ProjectionValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<ProjectionValue>
  | ProjectionObject;
interface ProjectionObject {
  readonly [key: string]: ProjectionValue;
}
interface JestProfile {
  testMatch: readonly string[];
  testPathIgnorePatterns: readonly string[];
  modulePaths: readonly string[];
  moduleNameMapper: ReadonlyArray<readonly [string, string]>;
  transformIgnorePatterns: readonly string[];
}

const JEST_CONFIG_NAMES = [
  "jest.config.js",
  "jest.config.ts",
  "jest.config.mjs",
  "jest.config.mts",
  "jest.config.cjs",
  "jest.config.cts",
  "jest.config.json",
];
const COVERAGE_KEYS = new Set([
  "collectCoverage",
  "coverageDirectory",
  "coverageProvider",
  "coveragePathIgnorePatterns",
]);
const CONFIG_KEYS = new Set([
  "preset",
  "testEnvironment",
  "roots",
  "modulePaths",
  "moduleNameMapper",
  "transform",
  "transformIgnorePatterns",
  "testMatch",
  "testPathIgnorePatterns",
  ...COVERAGE_KEYS,
]);

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const string = (node: EsTreeNode): string | undefined =>
  isNodeOfType(node, "Literal") && typeof node.value === "string" ? node.value : undefined;

const key = (node: EsTreeNode): string | undefined =>
  isNodeOfType(node, "Identifier") ? node.name : string(node);

const ownStaticProperties = (node: EsTreeNode): Map<string, EsTreeNode> | null => {
  if (!isNodeOfType(node, "ObjectExpression")) return null;
  const properties = new Map<string, EsTreeNode>();
  for (const property of node.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.kind !== "init" ||
      property.method
    ) {
      return null;
    }
    const name = key(property.key);
    if (!name || name === "__proto__" || properties.has(name)) return null;
    properties.set(name, property.value);
  }
  return properties;
};

const strings = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item: unknown) => typeof item === "string");

const staticValue = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  values: ReadonlyMap<Binding, ProjectionValue>,
): ProjectionValue | undefined => {
  if (
    isNodeOfType(node, "Literal") &&
    (node.value === null ||
      typeof node.value === "string" ||
      typeof node.value === "boolean" ||
      typeof node.value === "number")
  )
    return node.value;
  if (isNodeOfType(node, "Identifier")) {
    const binding = scopes.symbolFor(node);
    return binding ? values.get(binding) : undefined;
  }
  if (isNodeOfType(node, "TemplateLiteral") && node.expressions.length < 8) {
    let text = "";
    for (const [index, quasi] of node.quasis.entries()) {
      if (quasi.value.cooked === null || quasi.value.cooked === undefined) return undefined;
      text += quasi.value.cooked;
      if (index >= node.expressions.length) continue;
      const value = staticValue(node.expressions[index], scopes, values);
      if (typeof value !== "string") return undefined;
      text += value;
    }
    return text;
  }
  if (isNodeOfType(node, "ArrayExpression")) {
    const array: ProjectionValue[] = [];
    for (const element of node.elements) {
      if (!element || isNodeOfType(element, "SpreadElement")) return undefined;
      const value = staticValue(element, scopes, values);
      if (value === undefined) return undefined;
      array.push(value);
    }
    return array;
  }
  if (isNodeOfType(node, "ObjectExpression")) {
    const properties = ownStaticProperties(node);
    if (!properties) return undefined;
    const result: Record<string, ProjectionValue> = {};
    for (const [name, child] of properties) {
      const value = staticValue(child, scopes, values);
      if (value === undefined) return undefined;
      Object.defineProperty(result, name, { value, enumerable: true });
    }
    return result;
  }
  if (
    isNodeOfType(node, "MemberExpression") &&
    !node.computed &&
    !node.optional &&
    isNodeOfType(node.property, "Identifier") &&
    isNodeOfType(node.object, "Identifier")
  ) {
    const binding = scopes.symbolFor(node.object);
    const target = binding ? values.get(binding) : undefined;
    if (object(target) && Object.hasOwn(target, node.property.name)) {
      return Reflect.get(target, node.property.name);
    }
  }
  if (
    isNodeOfType(node, "CallExpression") &&
    !node.optional &&
    node.arguments.length === 1 &&
    isNodeOfType(node.callee, "MemberExpression") &&
    !node.callee.optional &&
    !node.callee.computed &&
    key(node.callee.property) === "join" &&
    isNodeOfType(node.callee.object, "ArrayExpression")
  ) {
    const list = staticValue(node.callee.object, scopes, values);
    const separator = string(node.arguments[0]);
    if (strings(list) && separator === "|") return list.join(separator);
  }
  return undefined;
};

const required = (expression: EsTreeNode, scopes: ScopeAnalysis): string | undefined =>
  isNodeOfType(expression, "CallExpression") &&
  !expression.optional &&
  expression.arguments.length === 1 &&
  isNodeOfType(expression.callee, "Identifier") &&
  expression.callee.name === "require" &&
  scopes.isGlobalReference(expression.callee)
    ? string(expression.arguments[0])
    : undefined;

const destructured = (
  node: EsTreeNode,
  name: string,
  scopes: ScopeAnalysis,
): Binding | undefined => {
  if (!isNodeOfType(node, "ObjectPattern") || node.properties.length !== 1) return undefined;
  const [property] = node.properties;
  if (
    !isNodeOfType(property, "Property") ||
    property.computed ||
    key(property.key) !== name ||
    !isNodeOfType(property.value, "Identifier")
  )
    return undefined;
  return scopes.symbolFor(property.value) ?? undefined;
};

const moduleExports = (node: EsTreeNode, scopes: ScopeAnalysis): EsTreeNode | null => {
  if (!isNodeOfType(node, "ExpressionStatement")) return null;
  const expression = node.expression;
  if (
    !isNodeOfType(expression, "AssignmentExpression") ||
    expression.operator !== "=" ||
    !isNodeOfType(expression.left, "MemberExpression") ||
    expression.left.computed ||
    expression.left.optional ||
    key(expression.left.property) !== "exports" ||
    !isNodeOfType(expression.left.object, "Identifier") ||
    expression.left.object.name !== "module" ||
    !scopes.isGlobalReference(expression.left.object)
  )
    return null;
  return expression.right;
};

const isPermissibleMapperTerm = (pattern: string, replacement: string): boolean => {
  if (
    !pattern.startsWith("^") ||
    pattern.length > 96 ||
    replacement.length > 180 ||
    !/^[a-zA-Z0-9_@./<>$-]+$/u.test(replacement)
  )
    return false;
  const stem = pattern
    .slice(1)
    .replace(/\(\/\(\.\*\)\|\$\)$/u, "")
    .replace(/\(\.\*\)\$$/u, "")
    .replace(/\$$/u, "");
  if (stem !== ".+\\.svg" && !/^(?:[a-zA-Z0-9_@/-]|\\\$)+$/u.test(stem)) return false;
  try {
    const matcher = new RegExp(pattern, "u");
    const protectedImports = [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "react-dom/client",
      "@testing-library/react",
      "@testing-library/dom",
      "ts-jest",
      "typescript",
      "jest",
    ];
    return protectedImports.every((item) => !matcher.test(item));
  } catch {
    return false;
  }
};

export const readDeclaredCommonJsJestProfile = (
  configText: string,
  compilerOptions: ProjectionObject,
): JestProfile | null => {
  if (configText.length > 65_536) return null;
  const program = parseSourceText({ filename: "jest.config.cjs", sourceText: configText });
  if (!isNodeOfType(program, "Program") || program.body.length > 6 || program.body.length < 2)
    return null;
  const scopes = analyzeScopes(program);
  const values = new Map<Binding, ProjectionValue>();
  let mapperBinding: Binding | undefined;
  for (const statement of program.body.slice(0, -1)) {
    if (
      !isNodeOfType(statement, "VariableDeclaration") ||
      statement.kind !== "const" ||
      statement.declarations.length !== 1
    )
      return null;
    const [declaration] = statement.declarations;
    if (!declaration.init) return null;
    const supplier = required(declaration.init, scopes);
    if (supplier === "./tsconfig.json") {
      const binding = destructured(declaration.id, "compilerOptions", scopes);
      if (!binding) return null;
      values.set(binding, compilerOptions);
    } else if (supplier === "ts-jest") {
      if (mapperBinding) return null;
      mapperBinding = destructured(declaration.id, "pathsToModuleNameMapper", scopes);
      if (!mapperBinding) return null;
    } else {
      if (!isNodeOfType(declaration.id, "Identifier")) return null;
      const binding = scopes.symbolFor(declaration.id);
      const value = staticValue(declaration.init, scopes, values);
      if (!binding || value === undefined) return null;
      values.set(binding, value);
    }
  }
  const exports = moduleExports(program.body.at(-1)!, scopes);
  const properties = exports ? ownStaticProperties(exports) : null;
  if (!properties || [...properties.keys()].some((name) => !CONFIG_KEYS.has(name))) return null;
  const read = (name: string) => {
    const field = properties.get(name);
    return field ? staticValue(field, scopes, values) : undefined;
  };
  const roots = read("roots");
  const testMatch = read("testMatch");
  const testPathIgnorePatterns = read("testPathIgnorePatterns");
  const modulePaths = read("modulePaths");
  const transformIgnorePatterns = read("transformIgnorePatterns");
  const transform = read("transform");
  if (
    read("preset") !== "ts-jest" ||
    read("testEnvironment") !== "jsdom" ||
    !strings(roots) ||
    roots.length !== 1 ||
    roots[0] !== "<rootDir>" ||
    !strings(testMatch) ||
    !testMatch.length ||
    !testMatch.every((match) => /^\*\*\/\*\.test\.[jt]sx?$/u.test(match)) ||
    !strings(testPathIgnorePatterns) ||
    !strings(modulePaths) ||
    modulePaths.length !== 1 ||
    compilerOptions.baseUrl !== "." ||
    modulePaths[0] !== compilerOptions.baseUrl ||
    !strings(transformIgnorePatterns) ||
    !object(transform) ||
    !Object.hasOwn(transform, "^.+\\.(j|t)sx?$")
  )
    return null;
  const transformer = transform["^.+\\.(j|t)sx?$"];
  const customTransform = Object.entries(transform).filter(([rule]) => rule !== "^.+\\.(j|t)sx?$");
  if (
    !Array.isArray(transformer) ||
    transformer.length !== 2 ||
    transformer[0] !== "ts-jest" ||
    !object(transformer[1]) ||
    Object.keys(transformer[1]).length !== 1 ||
    !object(transformer[1].tsconfig) ||
    Object.keys(transformer[1].tsconfig).length !== 2 ||
    transformer[1].tsconfig.esModuleInterop !== true ||
    transformer[1].tsconfig.allowSyntheticDefaultImports !== true ||
    customTransform.some(
      ([rule, provider]) =>
        provider !== "ts-jest" ||
        !/^\(\.\*\)\/node_modules\/[a-z0-9_-]+\/\.\+\\\.\(j\|t\)sx\?\$$/u.test(rule),
    )
  )
    return null;
  if ([...COVERAGE_KEYS].some((name) => properties.has(name) && read(name) === undefined))
    return null;
  const mapper = properties.get("moduleNameMapper");
  if (!mapper || !isNodeOfType(mapper, "ObjectExpression")) return null;
  const moduleNameMapper = new Map<string, string>();
  for (const entry of mapper.properties) {
    if (isNodeOfType(entry, "SpreadElement")) {
      const call = entry.argument;
      if (
        !mapperBinding ||
        !isNodeOfType(call, "CallExpression") ||
        call.optional ||
        !isNodeOfType(call.callee, "Identifier") ||
        scopes.symbolFor(call.callee) !== mapperBinding ||
        call.arguments.length !== 1 ||
        staticValue(call.arguments[0], scopes, values) !== compilerOptions.paths ||
        !object(compilerOptions.paths)
      )
        return null;
      for (const [alias, targets] of Object.entries(compilerOptions.paths)) {
        if (!strings(targets) || targets.length !== 1) return null;
        const target = targets[0];
        const wildcard = alias.endsWith("/*");
        const aliasPrefix = wildcard ? alias.slice(0, -1) : alias;
        if (
          !/^[a-zA-Z0-9_@$/-]+$/u.test(aliasPrefix) ||
          !/^[a-zA-Z0-9_./-]+\*?$/u.test(target) ||
          wildcard !== target.endsWith("/*")
        )
          return null;
        const pattern = "^" + aliasPrefix.replaceAll("$", "\\$") + (wildcard ? "(.*)$" : "$");
        const replacement = wildcard ? target.slice(0, -1) + "$1" : target;
        if (!isPermissibleMapperTerm(pattern, replacement)) return null;
        moduleNameMapper.set(pattern, replacement);
      }
      continue;
    }
    if (!isNodeOfType(entry, "Property") || entry.computed || entry.kind !== "init" || entry.method)
      return null;
    const name = key(entry.key);
    const replacement = string(entry.value);
    if (!name || !replacement || !isPermissibleMapperTerm(name, replacement)) return null;
    moduleNameMapper.set(name, replacement);
  }
  return {
    testMatch,
    testPathIgnorePatterns,
    modulePaths,
    moduleNameMapper: [...moduleNameMapper],
    transformIgnorePatterns,
  };
};

const selectsOrdinaryJest = (scripts: Record<string, unknown>): boolean => {
  if ("pretest" in scripts || "posttest" in scripts || typeof scripts.test !== "string")
    return false;
  const wrapper = /^pnpm run ([a-z0-9:-]+)$/u.exec(scripts.test);
  if (!wrapper) return /^jest(?: --coverage)?$/u.test(scripts.test);
  const script = wrapper[1];
  return (
    !(`pre${script}` in scripts) &&
    !(`post${script}` in scripts) &&
    typeof scripts[script] === "string" &&
    /^jest(?: --coverage)?$/u.test(scripts[script])
  );
};

export const readLiveCommonJsJestProfile = (
  directory: string,
  input: {
    probe: (kind: "exists" | "content" | "realpath", filename: string) => void;
  },
): JestProfile | null => {
  try {
    const configFiles = JEST_CONFIG_NAMES.map((name) => path.join(directory, name)).filter(
      (filename) => {
        input.probe("exists", filename);
        recordExistenceProbe(filename);
        return fs.existsSync(filename);
      },
    );
    if (configFiles.length !== 1 || path.basename(configFiles[0]) !== "jest.config.cjs")
      return null;
    const manifest = path.join(directory, "package.json");
    const tsconfig = path.join(directory, "tsconfig.json");
    for (const file of [manifest, tsconfig, ...configFiles]) {
      input.probe("content", file);
      recordExistenceProbe(file);
      recordContentProbe(file);
      recordRealpathProbe(file);
      input.probe("realpath", file);
      if (fs.realpathSync(file) !== file || !fs.lstatSync(file).isFile()) return null;
    }
    const packageJson: unknown = JSON.parse(fs.readFileSync(manifest, "utf8"));
    const selectedTsconfig: unknown = JSON.parse(fs.readFileSync(tsconfig, "utf8"));
    if (
      !object(packageJson) ||
      Object.hasOwn(packageJson, "jest") ||
      !object(packageJson.scripts) ||
      !selectsOrdinaryJest(packageJson.scripts) ||
      !object(selectedTsconfig) ||
      Object.hasOwn(selectedTsconfig, "extends") ||
      !object(selectedTsconfig.compilerOptions) ||
      !["react-jsx", "react-jsxdev"].includes(String(selectedTsconfig.compilerOptions.jsx)) ||
      "jsxImportSource" in selectedTsconfig.compilerOptions ||
      "jsxFactory" in selectedTsconfig.compilerOptions
    )
      return null;
    const { baseUrl, paths } = selectedTsconfig.compilerOptions;
    if (baseUrl !== "." || !object(paths)) return null;
    const compilerPaths: Record<string, ProjectionValue> = {};
    for (const [alias, mappings] of Object.entries(paths)) {
      if (!strings(mappings)) return null;
      Object.defineProperty(compilerPaths, alias, { value: mappings, enumerable: true });
    }
    return readDeclaredCommonJsJestProfile(fs.readFileSync(configFiles[0], "utf8"), {
      baseUrl,
      paths: compilerPaths,
    });
  } catch {
    return null;
  }
};
