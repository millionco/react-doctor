import * as path from "node:path";
import {
  readSelectedTypedSourceClosure,
  type SourceProjectModule,
} from "../../utils/build-source-project-index.js";
import {
  recordContentProbe,
  recordExistenceProbe,
  recordRealpathProbe,
} from "../../utils/cross-file-probe-recorder.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { hasClosedStockReactObjectReferences } from "../../utils/has-closed-stock-react-object-references.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { isEverySpecifierInlineType, isTypeOnlyImport } from "../../utils/is-type-only-import.js";
import { readLiveCommonJsJestProfile } from "../../utils/read-declared-commonjs-jest-profile.js";
import {
  createSelectedJestModuleResolver,
  hasNoJestRuntimeRegistryReferences,
  readJestExplicitSourceMockScope,
  type JestExplicitSourceSubstitution,
} from "../../utils/read-named-jest-caller.js";
import type { VerifiedStockViteBrowserProject } from "../../utils/read-verified-stock-vite-browser-project.js";
import { readStockJestNamedRenderer } from "../../utils/stock-vite-providers/read-stock-jest-named-renderer.js";
import { walkAst } from "../../utils/walk-ast.js";

type Resolver = ReturnType<typeof createSelectedJestModuleResolver>;
type Identity = Extract<ReturnType<Resolver["resolve"]>, { kind: "local" }>;

export interface LoadingJestRoutesInput {
  readonly project: VerifiedStockViteBrowserProject;
  readonly projectRoot: string;
  readonly focalFile: string;
  readonly namedTestFile: string;
}

export type LoadingJestModuleEdge = {
  readonly issuer: string;
  readonly target: string;
  readonly specifier: string;
  readonly site: EsTreeNode | null;
};

type Edge = LoadingJestModuleEdge;

export interface LoadingJestTestRoute {
  readonly testFile: string;
  readonly uncutPath: readonly Edge[];
  readonly substitutions: ReadonlyMap<string, JestExplicitSourceSubstitution>;
  readonly usesActualImports: readonly string[];
  readonly effectiveEdges: readonly Edge[];
  readonly integritySources: ReadonlySet<string>;
  readonly resolve: Resolver["resolve"];
}

const NON_EXECUTABLE_TYPED_TARGETS = new Set([".css", ".json", ".png", ".scss", ".svg"]);

const observeProfile = (kind: "exists" | "content" | "realpath", filename: string): void => {
  if (kind === "exists") recordExistenceProbe(filename);
  if (kind === "content") recordContentProbe(filename);
  if (kind === "realpath") recordRealpathProbe(filename);
};

export const getJestLocalModuleId = ({ filename, mapped }: Identity): string =>
  JSON.stringify([filename, mapped]);

const sourceSpecifier = (node: EsTreeNode): string | null => {
  const value =
    isNodeOfType(node, "ImportDeclaration") ||
    isNodeOfType(node, "ExportNamedDeclaration") ||
    isNodeOfType(node, "ExportAllDeclaration") ||
    isNodeOfType(node, "ImportExpression")
      ? node.source
      : isNodeOfType(node, "CallExpression") &&
          isNodeOfType(node.callee, "Identifier") &&
          node.callee.name === "require" &&
          node.arguments.length === 1
        ? node.arguments[0]
        : null;
  return isNodeOfType(value, "Literal") && typeof value.value === "string" ? value.value : null;
};

const ancestry = (
  project: VerifiedStockViteBrowserProject,
  focalFile: string,
): ReadonlySet<string> => {
  const files = new Set([focalFile]);
  for (const target of files) {
    for (const importer of project.index.consumerModulesByFilePath.get(target) ?? [])
      files.add(importer.filePath);
  }
  return files;
};

/** Check static alternate Jest resolution even for files that Vite placed
 * outside the focal's reverse graph. Otherwise a different Jest extension or
 * mapper hit can create a new entry that the module-cut pass never visits. */
const readJestSourceTargets = (
  project: VerifiedStockViteBrowserProject,
  relevant: ReadonlySet<string>,
  resolver: Resolver,
  selectedTest: (filename: string) => boolean,
): ReadonlyMap<string, ReadonlySet<string>> | null => {
  const jestTargets = new Map<string, ReadonlySet<string>>();
  for (const module of project.index.modulesByFilePath.values()) {
    const targets = new Set<string>();
    let alternate = false;
    const isTest = selectedTest(module.filePath);
    walkAst(module.programNode, (node) => {
      if (alternate) return false;
      if (
        (isNodeOfType(node, "ImportDeclaration") && isTypeOnlyImport(node)) ||
        (isNodeOfType(node, "ExportAllDeclaration") && node.exportKind === "type") ||
        (isNodeOfType(node, "ExportNamedDeclaration") &&
          (node.exportKind === "type" ||
            isEverySpecifierInlineType(node.specifiers, "ExportSpecifier", "exportKind")))
      )
        return;
      const candidate = sourceSpecifier(node);
      if (
        isTest &&
        !candidate &&
        (isNodeOfType(node, "ImportExpression") ||
          (isNodeOfType(node, "CallExpression") &&
            isNodeOfType(node.callee, "Identifier") &&
            node.callee.name === "require" &&
            module.scopes.isGlobalReference(node.callee)))
      ) {
        alternate = true;
        return false;
      }
      if (candidate) {
        const selected = resolver.resolve(module.filePath, candidate);
        if (selected?.kind === "local") {
          targets.add(selected.filename);
          if (
            relevant.has(selected.filename) &&
            project.index.resolvedSourcePathByNode.get(node) !== selected.filename
          )
            alternate = true;
        }
      }
      if (
        !isTest ||
        relevant.has(module.filePath) ||
        !isNodeOfType(node, "CallExpression") ||
        !isNodeOfType(node.callee, "MemberExpression") ||
        getStaticPropertyKeyName(node.callee) !== "requireActual"
      )
        return;
      const arg = node.arguments[0];
      if (!isNodeOfType(arg, "Literal") || typeof arg.value !== "string") {
        alternate = true;
        return;
      }
      const selected = resolver.resolve(module.filePath, arg.value);
      if (selected?.kind === "local" && relevant.has(selected.filename)) alternate = true;
    });
    if (alternate) return null;
    if (targets.size) jestTargets.set(module.filePath, targets);
  }
  return jestTargets;
};

const relevantEdges = (
  project: VerifiedStockViteBrowserProject,
  relevant: ReadonlySet<string>,
  module: SourceProjectModule,
): readonly Edge[] | null => {
  const out: Edge[] = [];
  let opaque = false;
  walkAst(module.programNode, (node) => {
    const file = project.index.resolvedSourcePathByNode.get(node);
    if (!file || !relevant.has(file)) return;
    const specifier = sourceSpecifier(node);
    if (!specifier) opaque = true;
    else out.push({ issuer: module.filePath, target: file, specifier, site: node });
  });
  return opaque ? null : out;
};

const shortest = (
  incoming: ReadonlyMap<string, Edge>,
  test: string,
  focal: string,
): readonly Edge[] => {
  const path: Edge[] = [];
  for (let edge = incoming.get(focal); edge && edge.issuer !== test; ) {
    path.unshift(edge);
    edge = incoming.get(edge.issuer);
    if (edge?.issuer === test) path.unshift(edge);
  }
  const direct = incoming.get(focal);
  return direct?.issuer === test ? [direct] : path;
};

/**
 * Compute effective explicit mock-ID cuts and residual import corridors using
 * the licensed stock Vite graph plus an independently verified Jest profile.
 * Nonempty uncutPath means render reachability still needs a separate proof.
 */
export const readLoadingJestModuleCuts = (
  input: LoadingJestRoutesInput,
): readonly LoadingJestTestRoute[] | null => {
  try {
    const { project, projectRoot, focalFile, namedTestFile } = input;
    const profile = readLiveCommonJsJestProfile(projectRoot, { probe: observeProfile });
    if (!profile || !project.index.typedEdges) return null;
    const resolver = createSelectedJestModuleResolver(projectRoot, profile);
    const inner = ancestry(project, focalFile);
    if (!inner.has(namedTestFile)) return null;
    const allowedTest = (file: string): boolean =>
      profile.testMatch.some((pattern) => file.endsWith(pattern.slice(4))) &&
      !profile.testPathIgnorePatterns.some((pattern) => new RegExp(pattern, "u").test(file));
    const jestTargets = readJestSourceTargets(project, inner, resolver, allowedTest);
    if (!jestTargets) return null;
    const filenames = [...inner].filter((file) => file !== namedTestFile && allowedTest(file));
    const names = new Set<string>();
    const results: LoadingJestTestRoute[] = [];
    const cachedEdges = new Map<string, readonly Edge[]>();
    const closedReactSources = new Set<string>();
    const closedRegistrySources = new Set<string>();
    for (const testFile of filenames) {
      const test = project.index.modulesByFilePath.get(testFile);
      if (!test) return null;
      const scope = readJestExplicitSourceMockScope(test.programNode, test.scopes);
      if (!scope) return null;
      const renderer = readStockJestNamedRenderer({
        projectRoot,
        configFile: path.join(projectRoot, "jest.config.cjs"),
        tsconfigFile: path.join(projectRoot, "tsconfig.json"),
        testFile,
        reactImporterFiles: [testFile],
        jsxImporterFiles: [testFile],
        jsxRuntimeSpecifier: "react/jsx-runtime",
      });
      if (
        !renderer ||
        renderer.react.entry !== project.browser.react.entry ||
        renderer.client.entry !== project.browser.renderer.entry
      )
        return null;
      const substitutions = new Map<string, JestExplicitSourceSubstitution>();
      const forbiddenMocks = /^(?:react(?:-dom)?(?:\/|$)|@testing-library\/|@jest\/)/u;
      if (scope.registeredMocks.some((specifier) => forbiddenMocks.test(specifier))) return null;
      for (const mock of scope.substitutions) {
        const id = resolver.resolve(testFile, mock.specifier);
        // Only solicit local cuts from this scope. Unresolved or bare
        // registrations cannot sever an unproved module dependency.
        if (id?.kind !== "local") continue;
        const key = getJestLocalModuleId(id);
        if (substitutions.has(key)) return null;
        substitutions.set(key, mock);
      }
      const actualFiles: string[] = [];
      for (const actual of scope.actualImports) {
        const id = resolver.resolve(testFile, actual);
        if (id?.kind === "bare" && id.specifier === "react") continue;
        if (!id || id.kind !== "local" || !project.index.modulesByFilePath.has(id.filename))
          return null;
        actualFiles.push(id.filename);
      }
      const selectedTestClosure = readSelectedTypedSourceClosure(project.index, [
        testFile,
        ...actualFiles,
      ]);
      if (
        !selectedTestClosure ||
        [...selectedTestClosure.opaqueIssuers].some((issuer) => issuer !== testFile)
      )
        return null;
      const integritySources = new Set(selectedTestClosure.reachable);
      for (const file of integritySources) {
        // Jest can substitute a local module for a Vite data edge. Include all
        // such siblings before deciding that shared React/registry state stays
        // closed. This is deliberately independent of each render cut.
        for (const target of jestTargets.get(file) ?? []) integritySources.add(target);
        if (file !== testFile && project.index.typedEdges.opaqueIssuers.has(file)) return null;
        if (closedReactSources.has(file) && (file === testFile || closedRegistrySources.has(file)))
          continue;
        const unit = project.index.modulesByFilePath.get(file);
        if (!unit) {
          // The typed index also records stylesheet/asset content paths. The
          // selected CommonJS profile has no arbitrary data transformer.
          if (!NON_EXECUTABLE_TYPED_TARGETS.has(path.extname(file))) return null;
          continue;
        }
        if (!closedReactSources.has(file)) {
          if (!hasClosedStockReactObjectReferences(unit.programNode, unit.scopes)) return null;
          closedReactSources.add(file);
        }
        if (file !== testFile) {
          if (!hasNoJestRuntimeRegistryReferences(unit.programNode, unit.scopes)) return null;
          closedRegistrySources.add(file);
        }
      }
      const pending = new Set([testFile]);
      const incoming = new Map<string, Edge>();
      const effectiveEdges: Edge[] = [];
      const enqueue = (edge: Edge) => {
        effectiveEdges.push(edge);
        if (pending.has(edge.target)) return;
        pending.add(edge.target);
        incoming.set(edge.target, edge);
      };
      for (const target of actualFiles) {
        if (inner.has(target)) enqueue({ issuer: testFile, target, specifier: target, site: null });
      }
      for (const issuer of pending) {
        if (issuer === focalFile) continue;
        let edges = cachedEdges.get(issuer);
        if (!edges) {
          const unit = project.index.modulesByFilePath.get(issuer);
          const indexed = unit && relevantEdges(project, inner, unit);
          if (!indexed) return null;
          edges = indexed;
          cachedEdges.set(issuer, edges);
        }
        for (const edge of edges) {
          const resolved = resolver.resolve(issuer, edge.specifier);
          if (resolved?.kind !== "local" || resolved.filename !== edge.target) return null;
          names.add(edge.specifier);
          names.add(path.parse(resolved.filename).name);
          const substitution = substitutions.get(getJestLocalModuleId(resolved));
          if (substitution) {
            names.add(substitution.specifier);
            continue;
          }
          enqueue(edge);
        }
      }
      results.push({
        testFile,
        uncutPath: shortest(incoming, testFile, focalFile),
        substitutions,
        usesActualImports: scope.actualImports,
        effectiveEdges,
        integritySources,
        resolve: resolver.resolve,
      });
    }
    return !resolver.admitsNoManualMock(names) ? null : results;
  } catch {
    return null;
  }
};
