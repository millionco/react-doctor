import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createSidecarProbeAnswerResolver } from "../src/runners/oxlint/resolve-sidecar-probe-answer.js";
import { createSidecarLintCache } from "../src/runners/oxlint/sidecar-lint-cache.js";

const roots: string[] = [];
const project = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-directory-probes-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "ignored"));
  return root;
};
const answers = (rootDirectory: string) =>
  createSidecarProbeAnswerResolver({
    rootDirectory,
    contentHashByRelativePath: new Map(),
  });
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("directory membership dependency probes", () => {
  it("invalidates persisted quiet output when an ignored caller is added and removed", () => {
    const root = project();
    fs.writeFileSync(path.join(root, ".gitignore"), "ignored/\n");
    const cacheDirectory = path.join(root, "cache");
    const writer = createSidecarLintCache(cacheDirectory, "service-hooks");
    const initial = answers(root).answerFor("directory", "ignored");
    writer.store("service unchanged", {
      probeIds: [writer.internProbe("directory", "ignored", initial)],
      diagnostics: [],
    });
    writer.persist();
    const reader = createSidecarLintCache(cacheDirectory, "service-hooks");
    const entry = reader.lookup("service unchanged");
    expect(entry).not.toBeNull();
    if (!entry) throw new Error("missing stored fixture");
    expect(reader.isReplayable(entry, answers(root).answerFor)).toBe(true);
    fs.writeFileSync(path.join(root, "ignored", "caller.tsx"), "service.useSlots();");
    const added = createSidecarLintCache(cacheDirectory, "service-hooks");
    expect(added.isReplayable(entry, answers(root).answerFor)).toBe(false);
    const addedAnswer = answers(root).answerFor("directory", "ignored");
    added.store("service unchanged", {
      probeIds: [added.internProbe("directory", "ignored", addedAnswer)],
      diagnostics: [],
    });
    added.persist();
    fs.unlinkSync(path.join(root, "ignored", "caller.tsx"));
    const removed = createSidecarLintCache(cacheDirectory, "service-hooks");
    const afterRemoval = removed.lookup("service unchanged");
    expect(afterRemoval).not.toBeNull();
    if (!afterRemoval) throw new Error("missing added fixture");
    expect(removed.isReplayable(afterRemoval, answers(root).answerFor)).toBe(false);
  });

  it("hashes membership independently of creation order", () => {
    const root = project();
    const directory = path.join(root, "ignored");
    fs.writeFileSync(path.join(directory, "b.ts"), "b");
    fs.writeFileSync(path.join(directory, "a.ts"), "a");
    const before = answers(root).answerFor("directory", "ignored");
    fs.unlinkSync(path.join(directory, "a.ts"));
    fs.unlinkSync(path.join(directory, "b.ts"));
    fs.writeFileSync(path.join(directory, "a.ts"), "a");
    fs.writeFileSync(path.join(directory, "b.ts"), "b");
    expect(answers(root).answerFor("directory", "ignored")).toBe(before);
  });

  it("distinguishes file, directory and symbolic-link entries", () => {
    const root = project();
    const member = path.join(root, "ignored", "caller");
    fs.writeFileSync(member, "x");
    const file = answers(root).answerFor("directory", "ignored");
    fs.unlinkSync(member);
    fs.mkdirSync(member);
    const directory = answers(root).answerFor("directory", "ignored");
    expect(directory).not.toBe(file);
    fs.rmdirSync(member);
    fs.writeFileSync(path.join(root, "target.ts"), "x");
    fs.symlinkSync(path.join(root, "target.ts"), member);
    const symlink = answers(root).answerFor("directory", "ignored");
    expect(symlink).not.toBe(file);
    expect(symlink).not.toBe(directory);
  });

  it("never gives a missing enumeration a reusable answer across scans", () => {
    const root = project();
    expect(answers(root).answerFor("directory", "missing")).not.toBe(
      answers(root).answerFor("directory", "missing"),
    );
  });
});
