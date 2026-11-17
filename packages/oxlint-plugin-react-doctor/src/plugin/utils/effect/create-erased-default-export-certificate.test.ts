import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import { isNodeOfType } from "../is-node-of-type.js";
import { walkAst } from "../walk-ast.js";
import type { EsTreeNode } from "../es-tree-node.js";
import { buildSourceProjectIndex } from "../build-source-project-index.js";
import type { SourceProjectIndex, SourceProjectModule } from "../build-source-project-index.js";
import { captureCrossFileProbes } from "../cross-file-probe-recorder.js";
import { normalizeFilename } from "../normalize-filename.js";
import { resetFilesystemCaches } from "../reset-filesystem-caches.js";
import { createErasedDefaultExportCertificate } from "./create-erased-default-export-certificate.js";
import { hasClosedNativeDelayGlobals } from "./certify-native-signal-delay.js";
import { createPrivatePrimitiveArrayReadCertificate } from "./create-private-primitive-array-read-certificate.js";
import { isSupportedRuntimeScopeNode } from "./is-supported-runtime-scope-node.js";

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "type-export-emission-"));
let fixtureNumber = 0;
afterAll(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

const createModule = (
  source: string,
  nextVersion = "16.3.6",
  babel = false,
  configuration = "{}",
): SourceProjectModule => {
  fixtureNumber += 1;
  const directory = path.join(temporaryDirectory, String(fixtureNumber));
  fs.mkdirSync(directory);
  fs.writeFileSync(
    path.join(directory, "package.json"),
    JSON.stringify({
      dependencies: { next: nextVersion, react: "19.0.0", "react-dom": "19.0.0" },
      ...(babel ? { babel: {} } : {}),
    }),
  );
  fs.writeFileSync(path.join(directory, "tsconfig.json"), configuration);
  const filePath = path.join(directory, "model.ts");
  fs.writeFileSync(filePath, source);
  const parsed = parseFixture(source);
  expect(parsed.errors).toEqual([]);
  if (!isNodeOfType(parsed.program, "Program")) throw new Error("Expected Program");
  attachParentReferences(parsed.program);
  resetFilesystemCaches();
  return { filePath, programNode: parsed.program, scopes: analyzeScopes(parsed.program) };
};

describe("erased default export certificate", () => {
  it.each([
    "type Model = { value: string }; export default Model;",
    "interface Model { value: string } export default Model;",
  ])("certifies only the exact default reference: %s", (source) => {
    const module = createModule(source);
    const references = createErasedDefaultExportCertificate(module, path.dirname(module.filePath));
    expect(references.size).toBe(1);
    for (const identifier of references) {
      expect(isSupportedRuntimeScopeNode(identifier, module.scopes)).toBe(false);
      expect(isSupportedRuntimeScopeNode(identifier, module.scopes, references)).toBe(true);
    }
  });

  it.each([
    "type Model = {}; const Model = {}; export default Model;",
    "const Model = {}; type Model = {}; export default Model;",
    "interface Model {} class Model {} export default Model;",
    "declare interface Model {} export default Model;",
    "namespace Model {} export default Model;",
    "import type Model from './model'; export default Model;",
    "type Model = {}; export default (Model as unknown);",
    "type Model = {}; export default (effect(), Model);",
    "export default missing;",
  ])("refuses a runtime merge or unsupported binding: %s", (source) => {
    const module = createModule(source);
    expect(createErasedDefaultExportCertificate(module, path.dirname(module.filePath)).size).toBe(
      0,
    );
  });

  it.each(["^16.3.6", "~16.3.6", "16.3.5", "16.3.7", "17.0.0", "16.3.6-canary.1"])(
    "refuses an unproved emitter version %s",
    (version) => {
      const module = createModule("type Model = {}; export default Model;", version);
      expect(createErasedDefaultExportCertificate(module, path.dirname(module.filePath)).size).toBe(
        0,
      );
    },
  );

  it.each([false, true])(
    "threads the certificate through native and private-array inventories: %s",
    (verbatim) => {
      const module = createModule(
        "type Model = {}; export default Model; const values = ['value']; const selected = values[0];",
        "16.3.6",
        false,
        JSON.stringify({ compilerOptions: { verbatimModuleSyntax: verbatim } }),
      );
      const project: SourceProjectIndex = {
        rootDirectory: path.dirname(module.filePath),
        modulesByFilePath: new Map([[module.filePath, module]]),
        htmlFilePaths: [],
        consumerModulesByFilePath: new Map(),
        resolvedSourcePathByNode: new WeakMap(),
        unresolvedRuntimeSources: new Set(),
        hasOpaqueMdxConsumerSurface: false,
      };
      let member: EsTreeNode | null = null;
      walkAst(module.programNode, (node) => {
        if (isNodeOfType(node, "MemberExpression")) member = node;
      });
      if (!member) throw new Error("Expected array member");
      expect(hasClosedNativeDelayGlobals(module.scopes, project)).toBe(!verbatim);
      expect(createPrivatePrimitiveArrayReadCertificate(module.scopes, project)(member)).toBe(
        !verbatim,
      );
      expect(hasClosedNativeDelayGlobals(module.scopes)).toBe(false);
    },
  );

  it("refuses a missing emitter and missing configuration", () => {
    const source = "type Model = {}; export default Model;";
    const noEmitter = createModule(source);
    fs.writeFileSync(path.join(path.dirname(noEmitter.filePath), "package.json"), "{}");
    resetFilesystemCaches();
    expect(
      createErasedDefaultExportCertificate(noEmitter, path.dirname(noEmitter.filePath)).size,
    ).toBe(0);
    const noConfiguration = createModule(source);
    fs.unlinkSync(path.join(path.dirname(noConfiguration.filePath), "tsconfig.json"));
    resetFilesystemCaches();
    expect(
      createErasedDefaultExportCertificate(noConfiguration, path.dirname(noConfiguration.filePath))
        .size,
    ).toBe(0);
  });

  it("refuses Babel and verbatim preservation", () => {
    const source = "type Model = {}; export default Model;";
    const babelModule = createModule(source, "16.3.6", true);
    expect(
      createErasedDefaultExportCertificate(babelModule, path.dirname(babelModule.filePath)).size,
    ).toBe(0);
    const verbatimModule = createModule(
      source,
      "16.3.6",
      false,
      '{"compilerOptions":{"verbatimModuleSyntax":true}}',
    );
    expect(
      createErasedDefaultExportCertificate(verbatimModule, path.dirname(verbatimModule.filePath))
        .size,
    ).toBe(0);
  });

  it.each([
    "type Model = {}; export default (Model);",
    "type Model = {}; export default /* direct-looking */ Model;",
    "type Model = {}; export /* direct-looking */ default Model;",
    "const label = 'é'; type Model = {}; export default Model;",
    "const label = '😀'; type Model = {}; export default Model;",
  ])("refuses collapsed wrappers, comments and unproved Unicode coordinates: %s", (source) => {
    const module = createModule(source);
    expect(createErasedDefaultExportCertificate(module, path.dirname(module.filePath)).size).toBe(
      0,
    );
  });

  it("requires the actual project root and matching module/scopes identity", () => {
    const module = createModule("type Model = {}; export default Model;");
    const directory = path.dirname(module.filePath);
    expect(createErasedDefaultExportCertificate(module).size).toBe(0);
    expect(createErasedDefaultExportCertificate(module, temporaryDirectory).size).toBe(0);
    const other = createModule("type Other = {}; export default Other;");
    expect(
      createErasedDefaultExportCertificate({ ...module, scopes: other.scopes }, directory).size,
    ).toBe(0);
    const nestedDirectory = path.join(directory, "nested");
    fs.mkdirSync(nestedDirectory);
    fs.writeFileSync(
      path.join(directory, "tsconfig.json"),
      '{"compilerOptions":{"verbatimModuleSyntax":true}}',
    );
    fs.writeFileSync(path.join(nestedDirectory, "tsconfig.json"), "{}");
    const nestedPath = path.join(nestedDirectory, "model.ts");
    fs.writeFileSync(nestedPath, "type Model = {}; export default Model;");
    resetFilesystemCaches();
    const nestedModule = { ...module, filePath: nestedPath };
    expect(createErasedDefaultExportCertificate(nestedModule, directory).size).toBe(0);
    fs.writeFileSync(path.join(directory, "tsconfig.json"), "{}");
    fs.writeFileSync(
      path.join(nestedDirectory, "package.json"),
      JSON.stringify({ dependencies: { next: "16.3.6", react: "19.0.0", "react-dom": "19.0.0" } }),
    );
    resetFilesystemCaches();
    expect(createErasedDefaultExportCertificate(nestedModule, directory).size).toBe(0);
  });

  it("retains the root in a real index and skips policy reads without eligible exports", () => {
    const module = createModule("type Model = {}; export default Model;");
    const directory = path.dirname(module.filePath);
    const project = buildSourceProjectIndex({
      rootDirectory: directory,
      currentFilePath: module.filePath,
      currentProgramNode: module.programNode,
      currentScopes: module.scopes,
    });
    expect(project?.rootDirectory).toBe(normalizeFilename(path.resolve(directory)));
    expect(createErasedDefaultExportCertificate(module, project?.rootDirectory).size).toBe(1);
    const noDefault = createModule("export const value = 1;");
    fs.unlinkSync(noDefault.filePath);
    const observation = captureCrossFileProbes(() =>
      createErasedDefaultExportCertificate(noDefault, path.dirname(noDefault.filePath)),
    );
    expect(observation.value.size).toBe(0);
    expect([...observation.trace.existencePaths]).toEqual([]);
    expect([...observation.trace.contentPaths]).toEqual([]);
  });
});

describe("erased default certificate export spelling", () => {
  it("refuses changed export spelling with a retained AST", () => {
    const source = "type Model = {}; export default Model;";
    const module = createModule(source);
    const directory = path.dirname(module.filePath);
    expect(createErasedDefaultExportCertificate(module, directory).size).toBe(1);
    fs.writeFileSync(module.filePath, "type Model = {}; export default /* changed */ Model;");
    resetFilesystemCaches();
    expect(createErasedDefaultExportCertificate(module, directory).size).toBe(0);
    fs.writeFileSync(module.filePath, source);
    resetFilesystemCaches();
    expect(createErasedDefaultExportCertificate(module, directory).size).toBe(1);
  });
});
