import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { collectCrossFileDependencyProbes } from "oxlint-plugin-react-doctor";
import { createSidecarLintCache } from "../src/runners/oxlint/sidecar-lint-cache.js";
import { createSidecarProbeAnswerResolver } from "../src/runners/oxlint/resolve-sidecar-probe-answer.js";

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

describe("Node file URL loader manifest dependency cache", () => {
  it.each(["content change", "nearer manifest creation"])(
    "invalidates unchanged consumers after %s",
    (change) => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-node-loader-cache-"));
      temporaryDirectories.push(directory);
      const filename = path.join(directory, "src/loader.tsx");
      fs.mkdirSync(path.join(directory, "src"));
      const manifestPath = path.join(directory, "package.json");
      const nearerManifestPath = path.join(directory, "src/package.json");
      const code =
        'import { pathToFileURL } from "url"; export const load = (file) => import(pathToFileURL(file).href);';
      fs.writeFileSync(filename, code);
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({ main: "index.js", engines: { node: ">=20" } }),
      );
      const trace = collectCrossFileDependencyProbes({
        absoluteFilePath: filename,
        sourceText: code,
        ruleIds: ["no-dynamic-import-path"],
      });
      expect(trace).not.toBeNull();
      if (!trace) throw new Error("Missing Node loader manifest dependency trace");
      expect(trace.contentPaths.has(manifestPath)).toBe(true);
      expect(trace.existencePaths.has(nearerManifestPath)).toBe(true);
      const cacheDirectory = path.join(directory, ".cache");
      const writer = createSidecarLintCache(cacheDirectory, "node-file-url-loaders");
      const answers = createSidecarProbeAnswerResolver({
        rootDirectory: directory,
        contentHashByRelativePath: new Map(),
      });
      const probeIds = [
        ...[...trace.contentPaths].map((absolute) => {
          const relative = answers.toRelativePath(absolute);
          return writer.internProbe("content", relative, answers.answerFor("content", relative));
        }),
        ...[...trace.existencePaths].map((absolute) => {
          const relative = answers.toRelativePath(absolute);
          return writer.internProbe("exists", relative, answers.answerFor("exists", relative));
        }),
      ];
      writer.store(code, { probeIds, diagnostics: [] });
      writer.persist();
      const before = createSidecarLintCache(cacheDirectory, "node-file-url-loaders");
      const beforeEntry = before.lookup(code);
      expect(beforeEntry).not.toBeNull();
      if (!beforeEntry) throw new Error("Missing stored entry");
      expect(before.isReplayable(beforeEntry, answers.answerFor)).toBe(true);
      if (change === "content change")
        fs.writeFileSync(
          manifestPath,
          JSON.stringify({ main: "index.js", engines: { node: ">=20" }, browser: "browser.js" }),
        );
      else fs.writeFileSync(nearerManifestPath, JSON.stringify({ name: "browser-tool" }));
      const reader = createSidecarLintCache(cacheDirectory, "node-file-url-loaders");
      const cached = reader.lookup(code);
      expect(cached).not.toBeNull();
      if (!cached) throw new Error("Missing replay candidate");
      const currentAnswers = createSidecarProbeAnswerResolver({
        rootDirectory: directory,
        contentHashByRelativePath: new Map(),
      });
      expect(reader.isReplayable(cached, currentAnswers.answerFor)).toBe(false);
      expect(fs.readFileSync(filename, "utf8")).toBe(code);
    },
  );
});
