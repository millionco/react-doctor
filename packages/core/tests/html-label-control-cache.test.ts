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

describe("imported native button label dependency cache", () => {
  it.each(["content change", "earlier file creation"])(
    "invalidates unchanged consumers after %s",
    (change) => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-label-cache-"));
      temporaryDirectories.push(directory);
      const filename = path.join(directory, "view.tsx");
      const buttonPath = path.join(directory, "button.tsx");
      const earlierPath = path.join(directory, "button.ts");
      const code =
        'import { Button } from "./button"; export const Example = () => <label><input /><Button /></label>;';
      fs.writeFileSync(filename, code);
      fs.writeFileSync(buttonPath, "export const Button = () => <button />;");
      const trace = collectCrossFileDependencyProbes({
        absoluteFilePath: filename,
        sourceText: code,
        ruleIds: ["html-label-has-single-control"],
      });
      expect(trace).not.toBeNull();
      if (!trace) throw new Error("Missing label dependency trace");
      expect(trace.contentPaths.has(buttonPath)).toBe(true);
      expect(trace.existencePaths.has(earlierPath)).toBe(true);
      expect(trace.existencePaths.has(path.join(directory, "button"))).toBe(true);
      const cacheDirectory = path.join(directory, ".cache");
      const writer = createSidecarLintCache(cacheDirectory, "label-controls");
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
      const before = createSidecarLintCache(cacheDirectory, "label-controls");
      const beforeEntry = before.lookup(code);
      expect(beforeEntry).not.toBeNull();
      if (!beforeEntry) throw new Error("Missing stored entry");
      expect(before.isReplayable(beforeEntry, answers.answerFor)).toBe(true);
      if (change === "content change")
        fs.writeFileSync(buttonPath, "export const Button = () => <span />;");
      else fs.writeFileSync(earlierPath, "export const Button = () => null;");
      const reader = createSidecarLintCache(cacheDirectory, "label-controls");
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
