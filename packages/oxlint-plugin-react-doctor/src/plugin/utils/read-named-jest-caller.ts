import * as fs from "node:fs";
import * as path from "node:path";
import { analyzeScopes, type ScopeAnalysis } from "../semantic/scope-analysis.js";
import { isTruthyJsxProperty } from "../rules/state-and-effects/truthy-jsx-property.js";
import {
  recordContentProbe,
  recordDirectoryProbe,
  recordExistenceProbe,
  recordRealpathProbe,
} from "./cross-file-probe-recorder.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findExportedValue } from "./find-exported-value.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getNodeStartIndex } from "./get-node-start-index.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isTypeOnlyImport } from "./is-type-only-import.js";
import { parseSourceText } from "./parse-source-file.js";
import {
  haveNoPhysicalPackageCandidates,
  resolveStockPhysicalEntry,
  type StockPhysicalEntry,
} from "./stock-vite-providers/resolve-stock-physical-entry.js";
import { stockReactI18nextJestContract } from "./stock-react-i18next-jest-contract.js";
import { walkAst } from "./walk-ast.js";

export interface NamedJestCallerProfile {
  readonly testMatch: readonly string[];
  readonly testPathIgnorePatterns: readonly string[];
  readonly modulePaths: readonly string[];
  readonly moduleNameMapper: ReadonlyArray<readonly [string, string]>;
}

export interface NamedJestCallerInput {
  readonly projectRoot: string;
  readonly testFile: string;
  readonly focalFile: string;
  readonly exportedName: string;
  readonly property: string;
  readonly profile: NamedJestCallerProfile;
}

interface NamedJestOpening {
  readonly title: string;
  readonly line: number;
}

interface LocalJestMock {
  readonly registration: string;
  readonly focalImport: string;
  readonly resolvedFile: string;
}

interface BareJestMock {
  readonly registration: "react-i18next";
  readonly focalImport: "react-i18next";
  readonly provider: StockPhysicalEntry;
}

export interface NamedJestCaller {
  readonly specifier: string;
  readonly localName: string;
  readonly openings: readonly NamedJestOpening[];
  readonly localMocks: readonly LocalJestMock[];
  readonly bareMocks: readonly BareJestMock[];
}

type Program = EsTreeNodeOfType<"Program">;
type Import = EsTreeNodeOfType<"ImportDeclaration">;
type Mapping = readonly [RegExp, string];
type ResolvedModule =
  | { readonly kind: "local"; readonly filename: string; readonly mapped: boolean }
  | { readonly kind: "bare"; readonly specifier: string };

const JEST_DEFAULT_EXTENSIONS = [".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".json", ".node"];
const PROTECTED_TEST_IMPORTS = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-dom/client",
  "react-dom/test-utils",
  "@testing-library/react",
  "@testing-library/dom",
  "@jest/globals",
];
const AMBIENT_LOOKUP_OR_MUTATION = new Set([
  "globalThis",
  "window",
  "global",
  "eval",
  "Function",
  "require",
  "module",
  "exports",
  "Reflect",
  "Proxy",
]);

const literalText = (node: EsTreeNode): string | undefined =>
  isNodeOfType(node, "Literal") && typeof node.value === "string" ? node.value : undefined;

const relativeInside = (root: string, filename: string): string | null => {
  if (!path.isAbsolute(filename) || path.normalize(filename) !== filename) return null;
  const relative = path.relative(root, filename);
  return relative &&
    relative !== ".." &&
    !relative.startsWith(".." + path.sep) &&
    !path.isAbsolute(relative)
    ? relative
    : null;
};

const selected = (filename: string): fs.Stats | undefined => {
  recordExistenceProbe(filename);
  const info = fs.lstatSync(filename, { throwIfNoEntry: false });
  if (info?.isSymbolicLink()) throw new Error("Symbolic link in a selected local Jest route");
  if (info) {
    recordRealpathProbe(filename);
    if (fs.realpathSync(filename) !== filename) throw new Error("Unqualified local Jest path");
  }
  return info;
};

const readLiteralSource = (filename: string): string | null => {
  if (!selected(filename)?.isFile()) return null;
  recordContentProbe(filename);
  const text = fs.readFileSync(filename, "utf8");
  return /@jsx(?:Runtime|ImportSource|Frag)?\b|@jest-environment\b/u.test(text) ? null : text;
};

const readLocalModule = (root: string, candidate: string): string | null => {
  if (!relativeInside(root, candidate)) return null;
  const direct = selected(candidate);
  if (direct?.isFile()) return candidate;
  for (const extension of JEST_DEFAULT_EXTENSIONS) {
    const byExtension = candidate + extension;
    if (selected(byExtension)?.isFile()) return byExtension;
  }
  if (!direct?.isDirectory() || selected(path.join(candidate, "package.json"))) return null;
  for (const extension of JEST_DEFAULT_EXTENSIONS) {
    const byIndex = path.join(candidate, "index" + extension);
    if (selected(byIndex)?.isFile()) return byIndex;
  }
  return null;
};

const resolveModule = (
  root: string,
  issuer: string,
  specifier: string,
  mappings: readonly Mapping[],
): ResolvedModule | null => {
  if (!/^[A-Za-z0-9_@$./-]+$/u.test(specifier)) return null;
  const mapping = mappings.find(([matcher]) => matcher.test(specifier));
  let candidate: string;
  if (mapping) {
    const [matcher, replacement] = mapping;
    const mapped = specifier.replace(matcher, replacement);
    if (mapped.startsWith("<rootDir>/")) {
      candidate = path.resolve(root, mapped.slice("<rootDir>/".length));
    } else {
      // ts-jest's unprefixed paths mapper searches modulePaths after nearer
      // packages. Refuse an ordinary alternate package before using '.'.
      const [stem] = mapped.split("/");
      if (
        !/^[A-Za-z0-9_-]+\/[A-Za-z0-9_@$./-]+$/u.test(mapped) ||
        !haveNoPhysicalPackageCandidates([path.dirname(issuer)], stem)
      )
        return null;
      candidate = path.resolve(root, mapped);
    }
  } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
    candidate = path.resolve(path.dirname(issuer), specifier);
  } else {
    return /^(?:@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/u.test(specifier)
      ? { kind: "bare", specifier }
      : null;
  }
  const filename = readLocalModule(root, candidate);
  return filename ? { kind: "local", filename, mapped: mapping !== undefined } : null;
};

const namedImport = (
  node: EsTreeNode,
  specifier: string,
  exported: string,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(node, "Identifier")) return false;
  const symbol = scopes.symbolFor(node);
  const binding = symbol?.declarationNode;
  const source = symbol && getImportDeclarationForSymbol(symbol);
  return (
    source?.source.value === specifier &&
    source.importKind !== "type" &&
    isNodeOfType(binding, "ImportSpecifier") &&
    binding.importKind !== "type" &&
    isNodeOfType(binding.imported, "Identifier") &&
    binding.imported.name === exported
  );
};

const stockJestGlobal = (node: EsTreeNode, name: string, scopes: ScopeAnalysis): boolean =>
  (isNodeOfType(node, "Identifier") && node.name === name && scopes.isGlobalReference(node)) ||
  namedImport(node, "@jest/globals", name, scopes);

const isCallback = (
  node: EsTreeNode | null | undefined,
): node is EsTreeNodeOfType<"FunctionExpression" | "ArrowFunctionExpression"> =>
  (isNodeOfType(node, "FunctionExpression") && !node.generator) ||
  isNodeOfType(node, "ArrowFunctionExpression");

const getJestCallFromBody = (
  block: EsTreeNode,
  scopes: ScopeAnalysis,
  names: readonly string[],
) => {
  const callback = block.parent;
  const call = callback?.parent;
  if (
    !isCallback(callback) ||
    callback.params.length !== 0 ||
    callback.body !== block ||
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== 2 ||
    call.arguments[1] !== callback ||
    !names.some((name) => stockJestGlobal(call.callee, name, scopes)) ||
    !literalText(call.arguments[0])
  )
    return null;
  return call;
};

const testTitleForRender = (
  render: EsTreeNode,
  program: Program,
  scopes: ScopeAnalysis,
): string | null => {
  const statement = render.parent;
  const block = statement?.parent;
  if (!isNodeOfType(statement, "ExpressionStatement") || !isNodeOfType(block, "BlockStatement"))
    return null;
  const test = getJestCallFromBody(block, scopes, ["it", "test"]);
  if (!test) return null;
  let registration: EsTreeNode = test;
  while (true) {
    const parent = registration.parent;
    const owner = parent?.parent;
    if (!isNodeOfType(parent, "ExpressionStatement")) return null;
    if (owner === program) return literalText(test.arguments[0]) ?? null;
    if (!isNodeOfType(owner, "BlockStatement")) return null;
    const describe = getJestCallFromBody(owner, scopes, ["describe"]);
    if (!describe || !isCallback(describe.arguments[1]) || describe.arguments[1].async) return null;
    registration = describe;
  }
};

const runtimeImports = (program: Program): Import[] => {
  const imports: Import[] = [];
  for (const statement of program.body) {
    if (isNodeOfType(statement, "ImportDeclaration") && !isTypeOnlyImport(statement))
      imports.push(statement);
  }
  return imports;
};

const mayExposeRendererObject = ({ source, specifiers }: Import): boolean => {
  const name = literalText(source);
  if (!name) return true;
  // Stock built-in module identity does not make a directly imported runtime
  // object immutable in Jest's CommonJS test environment.
  if (
    ["react", "react-dom", "@testing-library/dom"].some(
      (module) => name === module || name.startsWith(module + "/"),
    )
  )
    return true;
  if (name.startsWith("@testing-library/react/")) return true;
  return (
    (name === "@testing-library/react" || name === "@jest/globals") &&
    (!specifiers.length ||
      specifiers.some((specifier) => !isNodeOfType(specifier, "ImportSpecifier")))
  );
};

const findNamedFocalImport = (
  root: string,
  testFile: string,
  focalFile: string,
  exportedName: string,
  imports: readonly Import[],
  mappings: readonly Mapping[],
) => {
  const resolved = imports.filter((node) => {
    const specifier = literalText(node.source);
    if (!specifier) return false;
    const result = resolveModule(root, testFile, specifier, mappings);
    return result?.kind === "local" && result.filename === focalFile;
  });
  if (resolved.length !== 1) return null;
  const [declaration] = resolved;
  const [binding] = declaration.specifiers;
  const specifier = literalText(declaration.source);
  if (
    !specifier ||
    declaration.specifiers.length !== 1 ||
    !isNodeOfType(binding, "ImportSpecifier") ||
    binding.importKind === "type" ||
    !isNodeOfType(binding.imported, "Identifier") ||
    binding.imported.name !== exportedName ||
    /^[a-z]/u.test(binding.local.name)
  )
    return null;
  return { specifier, local: binding.local };
};

const readJestOpenings = (
  program: Program,
  local: EsTreeNode,
  text: string,
  property: string,
  scopes: ScopeAnalysis,
): NamedJestOpening[] | null => {
  const symbol = scopes.symbolFor(local);
  if (!symbol || !hasCompleteSymbolReferences(symbol, program, scopes)) return null;
  const openings: NamedJestOpening[] = [];
  for (const { flag, identifier } of symbol.references) {
    const parent = identifier.parent;
    if (flag !== "read" || !isNodeOfType(identifier, "JSXIdentifier")) return null;
    if (isNodeOfType(parent, "JSXClosingElement") && parent.name === identifier) continue;
    if (
      !isNodeOfType(parent, "JSXOpeningElement") ||
      parent.name !== identifier ||
      !isNodeOfType(parent.parent, "JSXElement") ||
      !isTruthyJsxProperty(parent, property, program, scopes) ||
      parent.attributes.some(
        (attribute) =>
          !isNodeOfType(attribute, "JSXAttribute") ||
          !isNodeOfType(attribute.name, "JSXIdentifier") ||
          attribute.name.name === "ref",
      )
    )
      return null;
    const element = parent.parent;
    const render = element.parent;
    if (
      !isNodeOfType(render, "CallExpression") ||
      render.optional ||
      render.arguments.length !== 1 ||
      render.arguments[0] !== element ||
      !namedImport(render.callee, "@testing-library/react", "render", scopes)
    )
      return null;
    const title = testTitleForRender(render, program, scopes);
    if (!title) return null;
    const position = getNodeStartIndex(element);
    openings.push({ title, line: text.slice(0, position).split("\n").length });
  }
  return openings.length ? openings : null;
};

const readMockRegistrations = (program: Program, scopes: ScopeAnalysis): string[] | null => {
  const registered = new Set<string>();
  let opaque = false;
  walkAst(program, (node) => {
    if (opaque) return;
    if (
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "WithStatement") ||
      (isNodeOfType(node, "Identifier") &&
        AMBIENT_LOOKUP_OR_MUTATION.has(node.name) &&
        scopes.isGlobalReference(node))
    ) {
      opaque = true;
      return;
    }
    if (!isNodeOfType(node, "Identifier")) return;
    const isJest = stockJestGlobal(node, "jest", scopes);
    const access = node.parent;
    if (!isJest) {
      if (
        node.name === "jest" &&
        isNodeOfType(access, "MemberExpression") &&
        access.object === node
      )
        opaque = true;
      return;
    }
    // The lexical declaration of `import { jest }` is not a runtime escape.
    if (isNodeOfType(access, "ImportSpecifier")) return;
    const call = access?.parent;
    if (
      !isNodeOfType(access, "MemberExpression") ||
      access.object !== node ||
      access.computed ||
      access.optional ||
      !isNodeOfType(access.property, "Identifier") ||
      !isNodeOfType(call, "CallExpression") ||
      call.optional ||
      call.callee !== access ||
      !["fn", "mock", "clearAllMocks"].includes(access.property.name)
    ) {
      opaque = true;
      return;
    }
    if (access.property.name !== "mock") return;
    const [target, factory] = call.arguments;
    const name = call.arguments.length === 2 ? literalText(target) : undefined;
    const statement = call.parent;
    if (
      !name ||
      registered.has(name) ||
      !isCallback(factory) ||
      factory.async ||
      factory.params.length !== 0 ||
      !isNodeOfType(statement, "ExpressionStatement") ||
      statement.parent !== program
    ) {
      opaque = true;
      return;
    }
    registered.add(name);
  });
  return opaque ? null : [...registered];
};

// A manual mock can change module-ID even when registration and focal
// imports have the same resolved path, because Jest includes the mock path.
const hasRelevantManualMock = (root: string, names: ReadonlySet<string>): boolean => {
  const pending = [{ directory: root, mockBase: null as string | null }];
  while (pending.length) {
    const current = pending.pop()!;
    recordDirectoryProbe(current.directory);
    for (const entry of fs.readdirSync(current.directory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      if (entry.isSymbolicLink()) return true;
      const filename = path.join(current.directory, entry.name);
      if (entry.isDirectory()) {
        pending.push({
          directory: filename,
          mockBase: entry.name === "__mocks__" ? filename : current.mockBase,
        });
        continue;
      }
      if (!current.mockBase || !entry.isFile()) continue;
      const relative = path.relative(current.mockBase, filename).split(path.sep).join("/");
      const extension = path.extname(relative);
      if (!extension || !JEST_DEFAULT_EXTENSIONS.includes(extension)) continue;
      const name = relative.slice(0, -extension.length);
      if (
        names.has(name) ||
        (name.endsWith("/index") && names.has(name.slice(0, -"/index".length)))
      )
        return true;
    }
  }
  return false;
};

const readScopedMocks = (
  root: string,
  testFile: string,
  focalFile: string,
  registrations: readonly string[],
  focal: Program,
  mappings: readonly Mapping[],
): Pick<NamedJestCaller, "localMocks" | "bareMocks"> | null => {
  const localMocks: LocalJestMock[] = [];
  const bareMocks: BareJestMock[] = [];
  if (!registrations.length) return { localMocks, bareMocks };
  const imports = runtimeImports(focal)
    .map((node) => literalText(node.source))
    .filter((specifier) => specifier !== undefined);
  const relevantNames = new Set<string>([...PROTECTED_TEST_IMPORTS, ...registrations]);
  const localTargets = new Set<string>();
  for (const registration of registrations) {
    const declared = resolveModule(root, testFile, registration, mappings);
    if (!declared) return null;
    if (declared.kind === "bare") {
      if (declared.specifier !== "react-i18next" || !imports.includes(declared.specifier))
        return null;
      const lookup = (issuer: string) =>
        resolveStockPhysicalEntry({
          projectRoot: root,
          importerDirectory: path.dirname(issuer),
          specifier: declared.specifier,
          profile: "jest-browser",
          contract: stockReactI18nextJestContract,
        });
      const provider = lookup(testFile);
      const consumer = lookup(focalFile);
      if (
        !provider ||
        consumer?.packageDirectory !== provider.packageDirectory ||
        consumer.entry !== provider.entry
      )
        return null;
      bareMocks.push({ registration: "react-i18next", focalImport: "react-i18next", provider });
      continue;
    }
    if (declared.filename === focalFile || localTargets.has(declared.filename)) return null;
    localTargets.add(declared.filename);
    const importSpecifier = imports.find((specifier) => {
      const resolved = resolveModule(root, focalFile, specifier, mappings);
      // Mapped specifiers contribute the stub path to the stock Jest module
      // ID. Equal absolute files alone do not prove mixed mapped/unmapped IDs.
      return (
        resolved?.kind === "local" &&
        resolved.filename === declared.filename &&
        resolved.mapped === declared.mapped
      );
    });
    if (!importSpecifier) return null;
    relevantNames.add(importSpecifier);
    localMocks.push({
      registration,
      focalImport: importSpecifier,
      resolvedFile: declared.filename,
    });
  }
  return hasRelevantManualMock(root, relevantNames) ? null : { localMocks, bareMocks };
};

/** Source-side route within a separately qualified stock Jest CJS+jsdom renderer.
 * The outer caller owns project import closure, compiler and renderer admission.
 */
export const readNamedJestCaller = ({
  projectRoot,
  testFile,
  focalFile,
  exportedName,
  property,
  profile,
}: NamedJestCallerInput): NamedJestCaller | null => {
  try {
    if (
      ["__self", "__source", "__proto__"].includes(property) ||
      !path.isAbsolute(projectRoot) ||
      !relativeInside(projectRoot, testFile) ||
      !relativeInside(projectRoot, focalFile) ||
      testFile === focalFile ||
      !selected(projectRoot)?.isDirectory() ||
      profile.modulePaths.length !== 1 ||
      profile.modulePaths[0] !== "."
    )
      return null;
    const testSuffix = path.extname(testFile);
    if (
      ![".tsx", ".jsx"].includes(testSuffix) ||
      !testFile.endsWith(".test" + testSuffix) ||
      !profile.testMatch.includes("**/*.test" + testSuffix) ||
      profile.testPathIgnorePatterns.some((pattern) => new RegExp(pattern, "u").test(testFile))
    )
      return null;
    const mappings: readonly Mapping[] = profile.moduleNameMapper.map(([pattern, replacement]) => [
      new RegExp(pattern, "u"),
      replacement,
    ]);
    if (
      mappings.some(([regexp]) =>
        PROTECTED_TEST_IMPORTS.some((specifier) => regexp.test(specifier)),
      )
    )
      return null;
    const text = readLiteralSource(testFile);
    const focalText = readLiteralSource(focalFile);
    if (!text || !focalText) return null;
    const program = parseSourceText({ filename: testFile, sourceText: text });
    const focal = parseSourceText({ filename: focalFile, sourceText: focalText });
    if (
      !isNodeOfType(program, "Program") ||
      !isNodeOfType(focal, "Program") ||
      !findExportedValue(focal, exportedName)
    )
      return null;
    const imports = runtimeImports(program);
    if (imports.some(mayExposeRendererObject)) return null;
    const imported = findNamedFocalImport(
      projectRoot,
      testFile,
      focalFile,
      exportedName,
      imports,
      mappings,
    );
    if (!imported) return null;
    const scopes = analyzeScopes(program);
    const openings = readJestOpenings(program, imported.local, text, property, scopes);
    if (!openings) return null;
    const registrations = readMockRegistrations(program, scopes);
    if (!registrations) return null;
    const mocks = readScopedMocks(projectRoot, testFile, focalFile, registrations, focal, mappings);
    return mocks
      ? { specifier: imported.specifier, localName: imported.local.name, openings, ...mocks }
      : null;
  } catch {
    return null;
  }
};
