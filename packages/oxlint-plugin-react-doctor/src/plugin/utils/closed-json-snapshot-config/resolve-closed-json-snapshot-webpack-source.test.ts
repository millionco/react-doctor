import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import type { SourceProjectModule } from "../build-source-project-index.js";
import { isNodeOfType } from "../is-node-of-type.js";
import type { ClosedJsonSnapshotProject } from "../get-closed-json-snapshot-project.js";
import { parseSourceText } from "../parse-source-file.js";
import { isClosedJsonSnapshotPublicEntry } from "../is-closed-json-snapshot-public-entry.js";
import { resolveClosedJsonSnapshotWebpackSource } from "./resolve-closed-json-snapshot-webpack-source.js";

const files = vi.hoisted(() => new Set<string>());

vi.mock("node:path", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:path")>();
  return { ...original.win32, default: original.win32 };
});

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return {
    ...original,
    existsSync: (filename: string) => files.has(filename.replaceAll("\\", "/")),
    statSync: (filename: string) =>
      files.has(filename.replaceAll("\\", "/")) ? { isFile: () => true, size: 0 } : undefined,
  };
});

const createModule = (filePath: string): SourceProjectModule => {
  const programNode = parseSourceText({
    filename: filePath,
    sourceText: "export const value = 1;",
  });
  if (!isNodeOfType(programNode, "Program")) throw new Error("Expected parsed source");
  return { filePath, programNode, scopes: analyzeScopes(programNode) };
};

beforeEach(() => files.clear());

describe("closed JSON source resolution with Windows paths", () => {
  it.each(["./receiver", "./receiver.js"])("looks up normalized module keys for %s", (source) => {
    const filePath = "C:/snapshot/receiver.js";
    files.add(filePath);
    expect(
      resolveClosedJsonSnapshotWebpackSource({
        fromFilePath: "C:\\snapshot\\owner.js",
        source,
        modules: new Map([[filePath, createModule(filePath)]]),
        resolutionPolicy: { rootDirectory: "C:\\snapshot", aliases: [], extensions: [".js"] },
      }),
    ).toBe(filePath);
  });

  it("looks up normalized index modules", () => {
    const filePath = "C:/snapshot/receiver/index.js";
    files.add(filePath);
    expect(
      resolveClosedJsonSnapshotWebpackSource({
        fromFilePath: "C:\\snapshot\\owner.js",
        source: "./receiver",
        modules: new Map([[filePath, createModule(filePath)]]),
        resolutionPolicy: { rootDirectory: "C:\\snapshot", aliases: [], extensions: [".js"] },
      }),
    ).toBe(filePath);
  });

  it("keeps configured aliases and normalized keys in the same source domain", () => {
    const filePath = "C:/snapshot/components/receiver.js";
    files.add(filePath);
    expect(
      resolveClosedJsonSnapshotWebpackSource({
        fromFilePath: "C:/snapshot/owner.js",
        source: "views/receiver",
        modules: new Map([[filePath, createModule(filePath)]]),
        resolutionPolicy: {
          rootDirectory: "C:\\snapshot",
          aliases: [
            { name: "views", exact: false, targetAbsolutePath: "C:\\snapshot\\components" },
          ],
          extensions: [".js"],
        },
      }),
    ).toBe(filePath);
  });

  it("retains the competing style-file veto", () => {
    const filePath = "C:/snapshot/receiver.js";
    files.add(filePath);
    files.add("C:/snapshot/receiver.css");
    expect(
      resolveClosedJsonSnapshotWebpackSource({
        fromFilePath: "C:\\snapshot\\owner.js",
        source: "./receiver",
        modules: new Map([[filePath, createModule(filePath)]]),
        resolutionPolicy: {
          rootDirectory: "C:\\snapshot",
          aliases: [],
          extensions: [".js", ".css"],
        },
      }),
    ).toBeNull();
  });

  it("does not promote an unindexed physical source to a proved module", () => {
    files.add("C:/snapshot/receiver.js");
    expect(
      resolveClosedJsonSnapshotWebpackSource({
        fromFilePath: "C:\\snapshot\\owner.js",
        source: "./receiver.js",
        modules: new Map(),
        resolutionPolicy: { rootDirectory: "C:\\snapshot", aliases: [], extensions: [".js"] },
      }),
    ).toBeNull();
  });
});

it.each(["./components/*.js", "./components/receiver.js", "./components"])(
  "retains the public-entry veto for Windows target %s",
  (target) => {
    const filePath =
      target === "./components"
        ? "C:/snapshot/components/index.js"
        : "C:/snapshot/components/receiver.js";
    const module = createModule(filePath);
    const sourceResolutionPolicy = {
      rootDirectory: "C:\\snapshot",
      aliases: [],
      extensions: [".js"],
    };
    const modulesByFilePath = new Map([[filePath, module]]);
    const project: ClosedJsonSnapshotProject = {
      rootDirectory: sourceResolutionPolicy.rootDirectory,
      modules: new Map([
        [
          filePath,
          { filePath, sourceText: "", program: module.programNode, scopes: module.scopes },
        ],
      ]),
      knownPublicEntryTargets: [target],
      index: {
        modulesByFilePath,
        htmlFilePaths: [],
        consumerModulesByFilePath: new Map(),
        resolvedSourcePathByNode: new WeakMap(),
        unresolvedRuntimeSources: new Set<string>(),
        unresolvedRuntimeSourcesByFilePath: new Map(),
        hasOpaqueMdxConsumerSurface: false,
      },
      sourceResolutionPolicy,
      resolveImport: () => null,
    };
    expect(isClosedJsonSnapshotPublicEntry({ project, filePath })).toBe(true);
  },
);
