import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { collectCrossFileDependencyProbes } from "../../oxlint-plugin-react-doctor/src/plugin/cross-file-dependencies.js";
import { resetModuleResolutionCaches } from "../../oxlint-plugin-react-doctor/src/plugin/utils/resolve-relative-import-path.js";
import { createSidecarLintCache } from "../src/runners/oxlint/sidecar-lint-cache.js";
import { createSidecarProbeAnswerResolver } from "../src/runners/oxlint/resolve-sidecar-probe-answer.js";

describe("frozen imported reduce source cache", () => {
  it.each(["provider edit", "missing provider creation", "resolution shadowing"])(
    "rejects sidecar replay after %s without changing the consumer",
    (change) => {
      const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-frozen-cache-"));
      try {
        const providerPath = path.join(rootDirectory, "provider.ts");
        if (change !== "missing provider creation") {
          fs.writeFileSync(providerPath, 'export const labels = Object.freeze(["bronze"]);');
        }
        resetModuleResolutionCaches();
        const trace = collectCrossFileDependencyProbes({
          absoluteFilePath: path.join(rootDirectory, "consumer.ts"),
          sourceText:
            'import { labels } from "./provider"; labels.reduce((result, label) => [...result, label], []);',
          ruleIds: ["no-spread-accumulator-in-reduce"],
        });
        if (!trace) return expect.fail("Expected a bounded dependency collector");
        const cacheDirectory = path.join(rootDirectory, "cache");
        const writer = createSidecarLintCache(cacheDirectory, "frozen-imports");
        const answers = createSidecarProbeAnswerResolver({
          rootDirectory,
          contentHashByRelativePath: new Map(),
        });
        const probeIds = [
          ...[...trace.contentPaths].map((absolutePath) => {
            const relativePath = answers.toRelativePath(absolutePath);
            return writer.internProbe(
              "content",
              relativePath,
              answers.answerFor("content", relativePath),
            );
          }),
          ...[...trace.existencePaths].map((absolutePath) => {
            const relativePath = answers.toRelativePath(absolutePath);
            return writer.internProbe(
              "exists",
              relativePath,
              answers.answerFor("exists", relativePath),
            );
          }),
        ];
        writer.store("consumer unchanged", { probeIds, diagnostics: [] });
        writer.persist();
        const unchangedReader = createSidecarLintCache(cacheDirectory, "frozen-imports");
        const unchangedEntry = unchangedReader.lookup("consumer unchanged");
        if (!unchangedEntry) return expect.fail("Expected a stored sidecar entry");
        expect(unchangedReader.isReplayable(unchangedEntry, answers.answerFor)).toBe(true);

        if (change === "resolution shadowing") {
          fs.writeFileSync(
            path.join(rootDirectory, "provider"),
            "export let labels = loadLabels();",
          );
        } else {
          fs.writeFileSync(providerPath, "export let labels = loadLabelsFromNetwork();");
        }
        const changedReader = createSidecarLintCache(cacheDirectory, "frozen-imports");
        const changedEntry = changedReader.lookup("consumer unchanged");
        if (!changedEntry) return expect.fail("Expected a stored sidecar entry");
        const changedAnswers = createSidecarProbeAnswerResolver({
          rootDirectory,
          contentHashByRelativePath: new Map(),
        });
        expect(changedReader.isReplayable(changedEntry, changedAnswers.answerFor)).toBe(false);
      } finally {
        fs.rmSync(rootDirectory, { recursive: true, force: true });
      }
    },
  );
});
