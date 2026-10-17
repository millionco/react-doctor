import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { collectCrossFileDependencyProbes } from "../../oxlint-plugin-react-doctor/src/plugin/cross-file-dependencies.js";
import { resetCrossFileExportCaches } from "../../oxlint-plugin-react-doctor/src/plugin/utils/resolve-cross-file-function-export.js";
import { resetModuleResolutionCaches } from "../../oxlint-plugin-react-doctor/src/plugin/utils/resolve-relative-import-path.js";
import { createSidecarLintCache } from "../src/runners/oxlint/sidecar-lint-cache.js";
import { createSidecarProbeAnswerResolver } from "../src/runners/oxlint/resolve-sidecar-probe-answer.js";

let directory: string;
const source =
  'import { makeBucket } from "./collector"; export const create = () => makeBucket();';
const helper = "export const makeBucket = () => ({ keep(callback) {}, flush() {} });";
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-observer-cache-"));
  resetCrossFileExportCaches();
  resetModuleResolutionCaches();
  fs.writeFileSync(path.join(directory, "view.tsx"), source);
});
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));
const store = () => {
  const trace = collectCrossFileDependencyProbes({
    absoluteFilePath: path.join(directory, "view.tsx"),
    sourceText: source,
    ruleIds: ["effect-observer-needs-disconnect"],
  });
  expect(trace).not.toBeNull();
  const resolver = createSidecarProbeAnswerResolver({
    rootDirectory: directory,
    contentHashByRelativePath: new Map(),
  });
  const cache = createSidecarLintCache(path.join(directory, "cache"), "observer-collector");
  const probeIds: number[] = [];
  const kinds: ReadonlyArray<"content" | "exists"> = ["content", "exists"];
  for (const kind of kinds) {
    const paths = kind === "content" ? trace?.contentPaths : trace?.existencePaths;
    for (const absolutePath of paths ?? []) {
      const relativePath = resolver.toRelativePath(absolutePath);
      probeIds.push(cache.internProbe(kind, relativePath, resolver.answerFor(kind, relativePath)));
    }
  }
  cache.store("view unchanged", { probeIds, diagnostics: [] });
  cache.persist();
};
const replayable = () => {
  const cache = createSidecarLintCache(path.join(directory, "cache"), "observer-collector");
  const entry = cache.lookup("view unchanged");
  expect(entry).not.toBeNull();
  if (!entry) return false;
  return cache.isReplayable(
    entry,
    createSidecarProbeAnswerResolver({
      rootDirectory: directory,
      contentHashByRelativePath: new Map(),
    }).answerFor,
  );
};
describe("observer collector sidecar dependency replay", () => {
  it("replays unchanged helper bytes but invalidates a helper edit", () => {
    fs.writeFileSync(path.join(directory, "collector.ts"), helper);
    store();
    expect(replayable()).toBe(true);
    fs.writeFileSync(
      path.join(directory, "collector.ts"),
      helper.replace("flush() {}", "flush() { return; }"),
    );
    expect(replayable()).toBe(false);
  });
  it("invalidates a reached implementation behind a readonly barrel", () => {
    fs.writeFileSync(
      path.join(directory, "collector.ts"),
      'export { makeBucket } from "./implementation";',
    );
    fs.writeFileSync(path.join(directory, "implementation.ts"), helper);
    store();
    expect(replayable()).toBe(true);
    fs.writeFileSync(
      path.join(directory, "implementation.ts"),
      helper.replace("flush() {}", "flush() { return; }"),
    );
    expect(replayable()).toBe(false);
  });
  it("invalidates when an absent helper appears", () => {
    store();
    expect(replayable()).toBe(true);
    fs.writeFileSync(path.join(directory, "collector.ts"), helper);
    expect(replayable()).toBe(false);
  });
  it("invalidates when a higher-priority extension shadows the resolved helper", () => {
    fs.writeFileSync(path.join(directory, "collector.tsx"), helper);
    store();
    expect(replayable()).toBe(true);
    fs.writeFileSync(path.join(directory, "collector.ts"), helper);
    expect(replayable()).toBe(false);
  });
});
