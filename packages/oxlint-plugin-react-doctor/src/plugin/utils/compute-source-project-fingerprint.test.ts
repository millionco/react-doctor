import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as scopeAnalysis from "../semantic/scope-analysis.js";
import * as projectIndex from "./build-source-project-index.js";
import { buildSourceProjectIndex } from "./build-source-project-index.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceFile } from "./parse-source-file.js";
import { computeSourceProjectFingerprint } from "./compute-source-project-fingerprint.js";
import {
  captureCrossFileProbes,
  recordContentProbe,
  replayCrossFileProbes,
} from "./cross-file-probe-recorder.js";
import { SOURCE_PROJECT_FINGERPRINT_MAX_FILE_SIZE_BYTES } from "./constants.js";
import type {
  SourceProjectFingerprintCache,
  SourceProjectProbeSnapshot,
} from "./read-source-project-fingerprint-snapshot.js";

let temporaryDirectory: string;
let projectDirectory: string;

const writeProjectFile = (relativePath: string, contents: string): string => {
  const filePath = path.join(projectDirectory, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
  return filePath;
};

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "source-fingerprint-"));
  projectDirectory = path.join(temporaryDirectory, "project");
  fs.mkdirSync(projectDirectory);
  writeProjectFile("entry.js", "export const source = 1;");
});

afterEach(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

describe("source project fingerprint", () => {
  it("recaptures a retained proof whose resolver trace or probe was removed", () => {
    writeProjectFile("entry.js", "import { value } from '@local/value'; export { value };");
    const configPath = fs.realpathSync(
      writeProjectFile("tsconfig.json", JSON.stringify({ compilerOptions: { baseUrl: "." } })),
    );
    const cache: SourceProjectFingerprintCache = {};
    const build = vi.spyOn(projectIndex, "buildSourceProjectIndex");
    try {
      const initial = captureCrossFileProbes(() =>
        computeSourceProjectFingerprint(projectDirectory, cache),
      );
      expect(initial.trace.contentPaths.has(configPath)).toBe(true);
      if (!cache.snapshot) throw new Error("Expected a complete fingerprint snapshot");
      const snapshot = JSON.parse(cache.snapshot);
      const shortenedTrace = {
        ...snapshot.trace,
        contentPaths: snapshot.trace.contentPaths.filter(
          (filename: string) => filename !== configPath,
        ),
      };
      const shortenedBody = {
        version: snapshot.version,
        rootDirectory: snapshot.rootDirectory,
        membership: snapshot.membership,
        probes: snapshot.probes,
        trace: shortenedTrace,
      };
      const variants = [
        { ...snapshot, trace: shortenedTrace },
        {
          ...snapshot,
          trace: shortenedTrace,
          probes: snapshot.probes.filter(
            (probe: SourceProjectProbeSnapshot) =>
              probe.absolutePath !== configPath || probe.kind !== "content",
          ),
        },
        {
          ...shortenedBody,
          checksum: crypto.createHash("sha256").update(JSON.stringify(shortenedBody)).digest("hex"),
        },
      ];
      for (const [index, variant] of variants.entries()) {
        cache.snapshot = JSON.stringify(variant);
        const repeated = captureCrossFileProbes(() =>
          computeSourceProjectFingerprint(projectDirectory, cache),
        );
        expect(repeated.value).toBe(initial.value);
        expect(repeated.trace).toEqual(initial.trace);
        expect(build).toHaveBeenCalledTimes(index + 2);
      }
    } finally {
      build.mockRestore();
    }
  });

  it("revalidates a retained proof without rebuilding the project graph", () => {
    writeProjectFile("entry.js", "import { value } from './child.js'; export { value };");
    writeProjectFile("child.js", "export const value = 1;");
    const cache: SourceProjectFingerprintCache = {};
    const build = vi.spyOn(projectIndex, "buildSourceProjectIndex");
    try {
      const initial = captureCrossFileProbes(() =>
        computeSourceProjectFingerprint(projectDirectory, cache),
      );
      const repeated = captureCrossFileProbes(() =>
        computeSourceProjectFingerprint(projectDirectory, cache),
      );
      expect(repeated.value).toBe(initial.value);
      expect(repeated.value).not.toBeNull();
      expect(repeated.trace).toEqual(initial.trace);
      expect(build).toHaveBeenCalledTimes(1);
    } finally {
      build.mockRestore();
    }
  });

  it("recaptures retained proofs for same-size source and negative external changes", () => {
    writeProjectFile("entry.js", "import { value } from '@local/value'; export { value };");
    writeProjectFile("tsconfig.json", JSON.stringify({ extends: "../shared.json" }));
    const cache: SourceProjectFingerprintCache = {};
    const absent = computeSourceProjectFingerprint(projectDirectory, cache);
    expect(absent).not.toBeNull();
    const shared = path.join(temporaryDirectory, "shared.json");
    fs.writeFileSync(
      shared,
      JSON.stringify({ compilerOptions: { baseUrl: "./external", paths: { "@local/*": ["*"] } } }),
    );
    const configured = computeSourceProjectFingerprint(projectDirectory, cache);
    expect(configured).not.toBeNull();
    expect(configured).not.toBe(absent);
    fs.mkdirSync(path.join(temporaryDirectory, "external"));
    const external = path.join(temporaryDirectory, "external/value.js");
    fs.writeFileSync(external, "export const value = 1;");
    const present = computeSourceProjectFingerprint(projectDirectory, cache);
    expect(present).not.toBeNull();
    expect(present).not.toBe(configured);
    const initialStat = fs.statSync(external);
    fs.writeFileSync(external, "export const value = 2;");
    fs.utimesSync(external, initialStat.atime, initialStat.mtime);
    const changed = computeSourceProjectFingerprint(projectDirectory, cache);
    expect(changed).toBe(present);
    const entry = path.join(projectDirectory, "entry.js");
    const entryStat = fs.statSync(entry);
    fs.writeFileSync(entry, "import { value } from '@local/vxlue'; export { value };");
    fs.utimesSync(entry, entryStat.atime, entryStat.mtime);
    expect(fs.statSync(entry).size).toBe(entryStat.size);
    expect(computeSourceProjectFingerprint(projectDirectory, cache)).not.toBe(changed);
    expect(computeSourceProjectFingerprint(projectDirectory, cache)).toBe(
      computeSourceProjectFingerprint(projectDirectory),
    );
  });

  it("recaptures malformed and incomplete retained proofs", () => {
    const cache: SourceProjectFingerprintCache = {};
    const expected = computeSourceProjectFingerprint(projectDirectory, cache);
    const serialized = cache.snapshot;
    if (!serialized) throw new Error("Expected a complete fingerprint snapshot");
    const snapshot = JSON.parse(serialized);
    for (const invalid of [
      "invalid",
      JSON.stringify({ ...snapshot, version: -1 }),
      JSON.stringify({ ...snapshot, rootDirectory: temporaryDirectory }),
      JSON.stringify({ ...snapshot, probes: [] }),
      JSON.stringify({ ...snapshot, trace: { contentPaths: ["relative"], existencePaths: [] } }),
    ]) {
      cache.snapshot = invalid;
      expect(computeSourceProjectFingerprint(projectDirectory, cache)).toBe(expected);
      expect(cache.snapshot).toBe(serialized);
    }
  });

  it("declines a retained proof when a replay observer changes an input", () => {
    const entry = fs.realpathSync(writeProjectFile("entry.js", "export const source = 1;"));
    const cache: SourceProjectFingerprintCache = {};
    expect(computeSourceProjectFingerprint(projectDirectory, cache)).not.toBeNull();
    const captured = captureCrossFileProbes(
      () => computeSourceProjectFingerprint(projectDirectory, cache),
      {
        beforeProbe: (filename) => {
          if (filename === entry) fs.writeFileSync(entry, "export const source = 2;");
        },
      },
    );
    expect(captured.value).toBeNull();
  });

  it("fingerprints dependency contents without constructing unused scope analyses", () => {
    writeProjectFile("entry.js", "import { value } from './child.js'; export { value };");
    writeProjectFile("child.js", "export const value = 1;");
    const analysis = vi.spyOn(scopeAnalysis, "analyzeScopes");
    try {
      expect(computeSourceProjectFingerprint(projectDirectory)).not.toBeNull();
      expect(analysis).not.toHaveBeenCalled();
    } finally {
      analysis.mockRestore();
    }
  });

  it("builds module scopes on demand and preserves their identity", () => {
    const filename = writeProjectFile(
      "entry.js",
      "import { value } from './child.js'; export { value };",
    );
    const childFilename = writeProjectFile("child.js", "export const value = 1;");
    const program = parseSourceFile(filename);
    if (!program || !isNodeOfType(program, "Program"))
      throw new Error("Expected the entry program");
    const analysis = vi.spyOn(scopeAnalysis, "analyzeScopes");
    try {
      const index = buildSourceProjectIndex({
        rootDirectory: projectDirectory,
        currentFilePath: filename,
        currentProgramNode: program,
      });
      expect(index).not.toBeNull();
      expect(analysis).not.toHaveBeenCalled();
      const entryModule = index?.modulesByFilePath.get(filename);
      const childModule = index?.modulesByFilePath.get(childFilename);
      if (!entryModule || !childModule) throw new Error("Expected both indexed modules");
      const entryScopes = entryModule.scopes;
      expect(analysis).toHaveBeenCalledTimes(1);
      expect(entryModule.scopes).toBe(entryScopes);
      expect(analysis).toHaveBeenCalledTimes(1);
      const childScopes = childModule.scopes;
      expect(analysis).toHaveBeenCalledTimes(2);
      expect(childModule.scopes).toBe(childScopes);
      expect(analysis).toHaveBeenCalledTimes(2);
      const suppliedIndex = buildSourceProjectIndex({
        rootDirectory: projectDirectory,
        currentFilePath: filename,
        currentProgramNode: program,
        currentScopes: entryScopes,
      });
      expect(suppliedIndex?.modulesByFilePath.get(filename)?.scopes).toBe(entryScopes);
      expect(analysis).toHaveBeenCalledTimes(2);
    } finally {
      analysis.mockRestore();
    }
  });

  it("freshly hashes ignored appearance, same-size restored-mtime edits, and deletion", () => {
    writeProjectFile(".gitignore", "private/\n");
    const initial = computeSourceProjectFingerprint(projectDirectory);
    expect(initial).not.toBeNull();
    expect(computeSourceProjectFingerprint(projectDirectory)).toBe(initial);
    const caller = writeProjectFile("private/caller.js", "export const value = 1;");
    const present = computeSourceProjectFingerprint(projectDirectory);
    expect(present).not.toBeNull();
    expect(present).not.toBe(initial);
    const previousStat = fs.statSync(caller);
    fs.writeFileSync(caller, "export const value = 2;");
    fs.utimesSync(caller, previousStat.atime, previousStat.mtime);
    const changed = computeSourceProjectFingerprint(projectDirectory);
    expect(changed).not.toBeNull();
    expect(changed).not.toBe(present);
    fs.unlinkSync(caller);
    expect(computeSourceProjectFingerprint(projectDirectory)).toBe(initial);
  });

  it("captures nested ignored config and external extends content without mtime trust", () => {
    writeProjectFile("source/entry.js", "import { value } from '@local/value'; export { value };");
    writeProjectFile(".gitignore", "source/tsconfig.json\n");
    writeProjectFile("source/tsconfig.json", JSON.stringify({ extends: "../../shared.json" }));
    writeProjectFile("left/value.js", "export const value = 1;");
    writeProjectFile("rght/value.js", "export const value = 2;");
    const shared = path.join(temporaryDirectory, "shared.json");
    const config = (target: string): string =>
      JSON.stringify({
        compilerOptions: { baseUrl: "./project", paths: { "@local/*": [`${target}/*`] } },
      });
    fs.writeFileSync(shared, config("left"));
    const first = computeSourceProjectFingerprint(projectDirectory);
    expect(first).not.toBeNull();
    const previousStat = fs.statSync(shared);
    fs.writeFileSync(shared, config("rght"));
    fs.utimesSync(shared, previousStat.atime, previousStat.mtime);
    const second = computeSourceProjectFingerprint(projectDirectory);
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
  });

  it("captures negative external extends and module candidate appearance", () => {
    writeProjectFile("entry.js", "import { value } from '@local/value'; export { value };");
    writeProjectFile("tsconfig.json", JSON.stringify({ extends: "../shared.json" }));
    const absent = computeSourceProjectFingerprint(projectDirectory);
    expect(absent).not.toBeNull();
    fs.writeFileSync(
      path.join(temporaryDirectory, "shared.json"),
      JSON.stringify({
        compilerOptions: { baseUrl: "./external", paths: { "@local/*": ["*"] } },
      }),
    );
    const configured = computeSourceProjectFingerprint(projectDirectory);
    expect(configured).not.toBeNull();
    expect(configured).not.toBe(absent);
    fs.mkdirSync(path.join(temporaryDirectory, "external"));
    fs.writeFileSync(path.join(temporaryDirectory, "external/value.js"), "export const value = 1;");
    const resolved = computeSourceProjectFingerprint(projectDirectory);
    expect(resolved).not.toBeNull();
    expect(resolved).not.toBe(configured);
  });

  it.skipIf(process.platform === "win32")("declines source links", () => {
    fs.symlinkSync(
      path.join(projectDirectory, "entry.js"),
      path.join(projectDirectory, "linked.js"),
    );
    expect(computeSourceProjectFingerprint(projectDirectory)).toBeNull();
  });

  it("declines unparseable modules and over-budget source content", () => {
    writeProjectFile("broken.js", "export const = ;");
    expect(computeSourceProjectFingerprint(projectDirectory)).toBeNull();
    fs.unlinkSync(path.join(projectDirectory, "broken.js"));
    writeProjectFile("huge.js", " ".repeat(SOURCE_PROJECT_FINGERPRINT_MAX_FILE_SIZE_BYTES + 1));
    expect(computeSourceProjectFingerprint(projectDirectory)).toBeNull();
  });

  it("remembers a config budget refusal even when the existing resolver catches it", () => {
    writeProjectFile("entry.js", "import { value } from '@local/value'; export { value };");
    writeProjectFile(
      "tsconfig.json",
      " ".repeat(SOURCE_PROJECT_FINGERPRINT_MAX_FILE_SIZE_BYTES + 1),
    );
    expect(computeSourceProjectFingerprint(projectDirectory)).toBeNull();
  });

  it("preserves nested probe capture and restores the default observer after refusal", () => {
    const observed: string[] = [];
    const captured = captureCrossFileProbes(
      () => {
        recordContentProbe("outer");
        return captureCrossFileProbes(() => recordContentProbe("inner"));
      },
      {
        beforeProbe: (filePath) => {
          observed.push(filePath);
        },
      },
    );
    expect(observed).toEqual(["outer", "inner"]);
    expect([...captured.trace.contentPaths]).toEqual(["outer", "inner"]);
    expect([...captured.value.trace.contentPaths]).toEqual(["inner"]);
    const replayed: string[] = [];
    const replay = captureCrossFileProbes(() => replayCrossFileProbes(captured.trace), {
      beforeProbe: (filePath) => {
        replayed.push(filePath);
      },
    });
    expect(replayed).toEqual(["outer", "inner"]);
    expect([...replay.trace.contentPaths]).toEqual(["outer", "inner"]);
    expect(() =>
      captureCrossFileProbes(() => replayCrossFileProbes(captured.trace), {
        beforeProbe: () => {
          throw new Error("replay budget");
        },
      }),
    ).toThrow("replay budget");
    expect(() =>
      captureCrossFileProbes(() => recordContentProbe("rejected"), {
        beforeProbe: () => {
          throw new Error("budget");
        },
      }),
    ).toThrow("budget");
    expect(() => recordContentProbe("default")).not.toThrow();
    expect(observed).toEqual(["outer", "inner"]);
  });
});
