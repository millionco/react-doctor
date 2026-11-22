import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { expect, it, vi } from "vite-plus/test";
import type { OxlintWorkerProbeResult } from "../src/start-oxlint-worker.js";
import type { Diagnostic } from "../src/types/index.js";
import { internWorkerSidecarProbeIds } from "../src/runners/oxlint/intern-worker-sidecar-probe-ids.js";
import { createSidecarProbeAnswerResolver } from "../src/runners/oxlint/resolve-sidecar-probe-answer.js";
import { createSidecarLintCache } from "../src/runners/oxlint/sidecar-lint-cache.js";

it("replays a pooled sidecar hit until a shared content/existence path changes bytes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-pooled-sidecar-"));
  try {
    const dependency = "dependency.ts";
    const source = "src/app.tsx";
    const sourceKey = source + " same-source-hash";
    const dependencyPath = path.join(root, dependency);
    const cacheDirectory = path.join(root, "cache");
    fs.mkdirSync(cacheDirectory);
    const trace = { file: source, content: [0], existence: [0] };
    const result: OxlintWorkerProbeResult = {
      paths: [dependency],
      existenceAnswers: ["file"],
      traces: [trace],
    };

    const lint = vi.fn((): Diagnostic[] => [
      {
        filePath: source,
        plugin: "react-doctor",
        rule: "no-barrel-import",
        severity: "warning",
        message: fs.readFileSync(dependencyPath, "utf8").trim(),
        help: "Import directly",
        line: 1,
        column: 1,
        category: "Bundle Size",
      },
    ]);

    const scan = () => {
      const cache = createSidecarLintCache(cacheDirectory, "pooled-test");
      const answers = createSidecarProbeAnswerResolver({
        rootDirectory: root,
        contentHashByRelativePath: new Map(),
      });
      const existing = cache.lookup(sourceKey);
      if (existing && cache.isReplayable(existing, answers.answerFor)) {
        return existing.diagnostics;
      }

      const diagnostics = lint();
      const probeIds = internWorkerSidecarProbeIds(result, trace, (kind, relative, known) =>
        cache.internProbe(kind, relative, known ?? answers.answerFor(kind, relative)),
      );
      cache.store(sourceKey, { diagnostics, probeIds });
      cache.persist();
      return diagnostics;
    };

    fs.writeFileSync(dependencyPath, "export const label = 'old';\n");
    expect(scan()[0]?.message).toBe("export const label = 'old';");
    expect(lint).toHaveBeenCalledTimes(1);

    const cache = createSidecarLintCache(cacheDirectory, "pooled-test");
    const existing = cache.lookup(sourceKey);
    const resolver = createSidecarProbeAnswerResolver({
      rootDirectory: root,
      contentHashByRelativePath: new Map(),
    });
    expect(existing?.probeIds.map((id) => cache.probeAt(id))).toEqual([
      { kind: "content", path: dependency, answer: resolver.answerFor("content", dependency) },
      { kind: "exists", path: dependency, answer: "file" },
    ]);
    expect(scan()[0]?.message).toBe("export const label = 'old';");
    expect(lint).toHaveBeenCalledTimes(1);

    fs.writeFileSync(dependencyPath, "export const label = 'new';\n");
    expect(fs.statSync(dependencyPath).isFile()).toBe(true);
    expect(scan()[0]?.message).toBe("export const label = 'new';");
    expect(lint).toHaveBeenCalledTimes(2);
    expect(scan()[0]?.message).toBe("export const label = 'new';");
    expect(lint).toHaveBeenCalledTimes(2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
