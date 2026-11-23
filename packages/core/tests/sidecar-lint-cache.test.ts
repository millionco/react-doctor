import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { Diagnostic } from "../src/types/index.js";
import {
  SIDECAR_LINT_CACHE_FILENAME,
  SIDECAR_LINT_CACHE_SCHEMA_VERSION,
} from "../src/constants.js";
import { createSidecarProbeAnswerResolver } from "../src/runners/oxlint/resolve-sidecar-probe-answer.js";
import { createSidecarLintCache } from "../src/runners/oxlint/sidecar-lint-cache.js";
import type {
  SidecarDependencyProbe,
  SidecarFileEntry,
  SidecarLintCache,
} from "../src/runners/oxlint/sidecar-lint-cache.js";

const tempRoots: string[] = [];
const makeCacheDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-sidecar-lint-cache-"));
  tempRoots.push(dir);
  return dir;
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const diagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  filePath: "src/app.tsx",
  plugin: "react-doctor",
  rule: "no-barrel-import",
  severity: "warning",
  message: "Import from a barrel file",
  help: "Import directly",
  line: 1,
  column: 1,
  category: "Bundle Size",
  ...overrides,
});

const PROBES: ReadonlyArray<SidecarDependencyProbe> = [
  { kind: "content", path: "src/components/index.ts", answer: "hash-index" },
  { kind: "exists", path: "src/components.tsx", answer: "none" },
];

const internProbes = (
  cache: SidecarLintCache,
  probes: ReadonlyArray<SidecarDependencyProbe> = PROBES,
): number[] => probes.map((probe) => cache.internProbe(probe.kind, probe.path, probe.answer));

const entry = (
  cache: SidecarLintCache,
  overrides: Partial<SidecarFileEntry> = {},
): SidecarFileEntry => ({
  probeIds: internProbes(cache),
  diagnostics: [diagnostic()],
  ...overrides,
});

const probesOf = (cache: SidecarLintCache, cached: SidecarFileEntry | null) =>
  cached?.probeIds.map((probeId) => cache.probeAt(probeId));

const answerFromProbes =
  (probes: ReadonlyArray<SidecarDependencyProbe>) =>
  (kind: SidecarDependencyProbe["kind"], probePath: string): string =>
    probes.find((probe) => probe.kind === kind && probe.path === probePath)?.answer ?? "absent";

describe("createSidecarLintCache", () => {
  it("invalidates a persisted entry when a provider link moves between identical packages", () => {
    const project = makeCacheDir();
    const cacheDirectory = makeCacheDir();
    const original = path.join(project, "original");
    const alternate = path.join(project, "alternate");
    const link = path.join(project, "provider");
    for (const directory of [original, alternate]) {
      fs.mkdirSync(directory);
      fs.writeFileSync(path.join(directory, "package.json"), '{"name":"provider"}');
    }
    fs.symlinkSync(original, link, "junction");
    const readAnswers = () =>
      createSidecarProbeAnswerResolver({
        rootDirectory: project,
        contentHashByRelativePath: new Map(),
      });
    const initialAnswers = readAnswers();
    const manifest = "provider/package.json";
    const initialExistence = initialAnswers.answerFor("exists", "provider");
    const initialContent = initialAnswers.answerFor("content", manifest);
    const writer = createSidecarLintCache(cacheDirectory, "realpath");
    const providerProbeId = writer.internProbe(
      "realpath",
      "provider",
      initialAnswers.answerFor("realpath", "provider"),
    );
    writer.store("src/app.tsx hash", {
      probeIds: [providerProbeId],
      diagnostics: [diagnostic()],
    });
    writer.persist();
    const isReplayable = () => {
      const reader = createSidecarLintCache(cacheDirectory, "realpath");
      const cached = reader.lookup("src/app.tsx hash");
      expect(cached?.diagnostics).toEqual([diagnostic()]);
      return cached !== null && reader.isReplayable(cached, readAnswers().answerFor);
    };
    expect(isReplayable()).toBe(true);
    fs.unlinkSync(link);
    fs.symlinkSync(alternate, link, "junction");
    const afterRetarget = readAnswers();
    expect(afterRetarget.answerFor("exists", "provider")).toBe(initialExistence);
    expect(afterRetarget.answerFor("content", manifest)).toBe(initialContent);
    expect(isReplayable()).toBe(false);
    fs.unlinkSync(link);
    fs.symlinkSync(original, link, "junction");
    expect(isReplayable()).toBe(true);
  });
  it.skipIf(process.platform === "win32")(
    "invalidates a cached launcher after an executable-only mode change",
    () => {
      const project = makeCacheDir();
      const launcher = path.join(project, "launcher");
      const link = path.join(project, "provider");
      fs.writeFileSync(launcher, "fixture launcher", { mode: 0o755 });
      fs.symlinkSync(launcher, link);
      const readAnswers = () =>
        createSidecarProbeAnswerResolver({
          rootDirectory: project,
          contentHashByRelativePath: new Map(),
        });
      const initial = readAnswers();
      const initialBytes = initial.answerFor("content", "provider");
      const cacheDirectory = makeCacheDir();
      const writer = createSidecarLintCache(cacheDirectory, "launcher-mode");
      writer.store(
        "src/app.tsx hash",
        entry(writer, {
          probeIds: [
            writer.internProbe("realpath", "provider", initial.answerFor("realpath", "provider")),
          ],
        }),
      );
      writer.persist();
      const isReplayable = () => {
        const reader = createSidecarLintCache(cacheDirectory, "launcher-mode");
        const stored = reader.lookup("src/app.tsx hash");
        return stored !== null && reader.isReplayable(stored, readAnswers().answerFor);
      };
      expect(isReplayable()).toBe(true);

      fs.chmodSync(launcher, 0o644);
      expect(readAnswers().answerFor("content", "provider")).toBe(initialBytes);
      expect(isReplayable()).toBe(false);

      fs.chmodSync(launcher, 0o755);
      expect(isReplayable()).toBe(true);
    },
  );

  it("preserves explicit ownership through disk replay", () => {
    const cacheDirectory = makeCacheDir();
    const expected = diagnostic({ contextRanges: [{ offset: 12, length: 34 }] });
    const writer = createSidecarLintCache(cacheDirectory, "ownership");
    writer.store("app hash", { probeIds: [], diagnostics: [expected] });
    writer.persist();
    expect(
      createSidecarLintCache(cacheDirectory, "ownership").lookup("app hash")?.diagnostics[0],
    ).toMatchObject(expected);
  });
  it("round-trips probes + diagnostics across a persist + reload", () => {
    const cacheDir = makeCacheDir();
    const writer = createSidecarLintCache(cacheDir, "ruleset-1");
    writer.store("src/app.tsx hashA", entry(writer));
    writer.store("src/clean.tsx hashB", entry(writer, { diagnostics: [] }));
    writer.persist();

    const reader = createSidecarLintCache(cacheDir, "ruleset-1");
    const replayed = reader.lookup("src/app.tsx hashA");
    expect(replayed).not.toBeNull();
    expect(probesOf(reader, replayed)).toEqual(PROBES);
    expect(replayed?.diagnostics).toHaveLength(1);
    expect(reader.lookup("src/clean.tsx hashB")?.diagnostics).toEqual([]);
    expect(reader.lookup("src/never-seen.tsx hashZ")).toBeNull();
  });

  it("interns one record per distinct (kind, path, answer) across entries", () => {
    const cacheDir = makeCacheDir();
    const writer = createSidecarLintCache(cacheDir, "ruleset-1");
    writer.store("src/app.tsx hashA", entry(writer));
    writer.store("src/other.tsx hashB", entry(writer));
    const staleProbes = [{ ...PROBES[0], answer: "hash-index-old" }];
    writer.store("src/stale.tsx hashC", {
      probeIds: internProbes(writer, staleProbes),
      diagnostics: [],
    });
    writer.persist();

    const persisted = JSON.parse(
      fs.readFileSync(path.join(cacheDir, SIDECAR_LINT_CACHE_FILENAME), "utf8"),
    );
    const bucket = persisted.rulesets["ruleset-1"];
    expect(bucket.probes).toHaveLength(3);
    expect(bucket.files["src/app.tsx hashA"].probeIds).toEqual(
      bucket.files["src/other.tsx hashB"].probeIds,
    );

    const reader = createSidecarLintCache(cacheDir, "ruleset-1");
    const answerFor = answerFromProbes(PROBES);
    expect(reader.isReplayable(reader.lookup("src/app.tsx hashA")!, answerFor)).toBe(true);
    expect(reader.isReplayable(reader.lookup("src/stale.tsx hashC")!, answerFor)).toBe(false);
  });

  it("answers each distinct probe once per cache instance while verifying", () => {
    const cacheDir = makeCacheDir();
    const cache = createSidecarLintCache(cacheDir, "ruleset-1");
    const first = entry(cache);
    const second = entry(cache);
    let answerCount = 0;
    const answerFor = (kind: SidecarDependencyProbe["kind"], probePath: string): string => {
      answerCount += 1;
      return answerFromProbes(PROBES)(kind, probePath);
    };
    expect(cache.isReplayable(first, answerFor)).toBe(true);
    expect(cache.isReplayable(second, answerFor)).toBe(true);
    expect(answerCount).toBe(PROBES.length);
  });

  it("keeps sibling entries (re-interned) when persisting over a bucket another run wrote", () => {
    const cacheDir = makeCacheDir();
    const sibling = createSidecarLintCache(cacheDir, "ruleset-1");
    sibling.store("src/sibling.tsx hashS", entry(sibling));
    const ours = createSidecarLintCache(cacheDir, "ruleset-1");
    sibling.persist();
    ours.store("src/app.tsx hashA", entry(ours, { diagnostics: [] }));
    ours.persist();

    const reader = createSidecarLintCache(cacheDir, "ruleset-1");
    expect(probesOf(reader, reader.lookup("src/sibling.tsx hashS"))).toEqual(PROBES);
    expect(reader.lookup("src/app.tsx hashA")?.diagnostics).toEqual([]);
  });

  it("isolates entries by ruleset hash (a toolchain/config change is a clean miss)", () => {
    const cacheDir = makeCacheDir();
    const writer = createSidecarLintCache(cacheDir, "ruleset-1");
    writer.store("src/app.tsx hashA", entry(writer));
    writer.persist();

    expect(createSidecarLintCache(cacheDir, "ruleset-2").lookup("src/app.tsx hashA")).toBeNull();
  });

  it("degrades an entry with a malformed probe to a miss (never a partial guard)", () => {
    const cacheDir = makeCacheDir();
    fs.writeFileSync(
      path.join(cacheDir, SIDECAR_LINT_CACHE_FILENAME),
      JSON.stringify({
        version: SIDECAR_LINT_CACHE_SCHEMA_VERSION,
        rulesets: {
          "ruleset-1": {
            updatedAtMs: Date.now(),
            // A probe record missing its answer — replaying diagnostics
            // guarded by a truncated probe set could serve a stale verdict.
            probes: [["content", "src/components/index.ts"]],
            files: {
              "src/app.tsx hashA": {
                probeIds: [0],
                diagnostics: [diagnostic()],
              },
            },
          },
        },
      }),
    );
    expect(createSidecarLintCache(cacheDir, "ruleset-1").lookup("src/app.tsx hashA")).toBeNull();
  });

  it("degrades an entry referencing a probe id outside the table to a miss", () => {
    const cacheDir = makeCacheDir();
    fs.writeFileSync(
      path.join(cacheDir, SIDECAR_LINT_CACHE_FILENAME),
      JSON.stringify({
        version: SIDECAR_LINT_CACHE_SCHEMA_VERSION,
        rulesets: {
          "ruleset-1": {
            updatedAtMs: Date.now(),
            probes: [["content", "src/components/index.ts", "hash-index"]],
            files: {
              "src/app.tsx hashA": { probeIds: [0, 1], diagnostics: [diagnostic()] },
              "src/ok.tsx hashB": { probeIds: [0], diagnostics: [] },
            },
          },
        },
      }),
    );
    const cache = createSidecarLintCache(cacheDir, "ruleset-1");
    expect(cache.lookup("src/app.tsx hashA")).toBeNull();
    expect(cache.lookup("src/ok.tsx hashB")).not.toBeNull();
  });

  it("degrades an entry with a malformed diagnostic to a miss", () => {
    const cacheDir = makeCacheDir();
    fs.writeFileSync(
      path.join(cacheDir, SIDECAR_LINT_CACHE_FILENAME),
      JSON.stringify({
        version: SIDECAR_LINT_CACHE_SCHEMA_VERSION,
        rulesets: {
          "ruleset-1": {
            updatedAtMs: Date.now(),
            probes: [],
            files: {
              "src/app.tsx hashA": {
                probeIds: [],
                diagnostics: [{ notADiagnostic: true }],
              },
            },
          },
        },
      }),
    );
    expect(createSidecarLintCache(cacheDir, "ruleset-1").lookup("src/app.tsx hashA")).toBeNull();
  });

  it("fails open on a corrupt cache file (no throw, treated as empty)", () => {
    const cacheDir = makeCacheDir();
    fs.writeFileSync(path.join(cacheDir, SIDECAR_LINT_CACHE_FILENAME), "{ not json !!");
    const cache = createSidecarLintCache(cacheDir, "ruleset-1");
    expect(cache.lookup("src/app.tsx hashA")).toBeNull();
    cache.store("src/app.tsx hashA", entry(cache));
    expect(() => cache.persist()).not.toThrow();
    expect(
      createSidecarLintCache(cacheDir, "ruleset-1").lookup("src/app.tsx hashA"),
    ).not.toBeNull();
  });

  it("preserves sibling ruleset buckets when a different ruleset persists", () => {
    const cacheDir = makeCacheDir();
    const first = createSidecarLintCache(cacheDir, "ruleset-1");
    first.store("src/app.tsx hashA", entry(first));
    first.persist();

    const second = createSidecarLintCache(cacheDir, "ruleset-2");
    second.store("src/other.tsx hashB", entry(second, { diagnostics: [] }));
    second.persist();

    expect(
      createSidecarLintCache(cacheDir, "ruleset-1").lookup("src/app.tsx hashA"),
    ).not.toBeNull();
    expect(
      createSidecarLintCache(cacheDir, "ruleset-2").lookup("src/other.tsx hashB"),
    ).not.toBeNull();
  });
});
