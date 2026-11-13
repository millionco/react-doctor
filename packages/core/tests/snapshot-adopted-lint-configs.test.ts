import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { snapshotAdoptedLintConfigs } from "../src/utils/snapshot-adopted-lint-configs.js";

let temporaryDirectory: string;
let rootDirectory: string;
let snapshotDirectory: string;
let configPath: string;

beforeEach(() => {
  temporaryDirectory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "rd-config-snapshot-")),
  );
  rootDirectory = path.join(temporaryDirectory, "project");
  snapshotDirectory = path.join(temporaryDirectory, "snapshots");
  fs.mkdirSync(rootDirectory);
  fs.mkdirSync(snapshotDirectory);
  configPath = path.join(rootDirectory, ".oxlintrc.json");
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

const snapshot = (): string[] =>
  snapshotAdoptedLintConfigs({ configPaths: [configPath], rootDirectory, snapshotDirectory });

describe("snapshotAdoptedLintConfigs", () => {
  it("keeps a data-only snapshot after the scanned config is replaced", () => {
    fs.writeFileSync(configPath, '{"rules":{"no-debugger":"error"}}');
    const [snapshotPath] = snapshot();
    fs.writeFileSync(configPath, '{"jsPlugins":["./payload.mjs"]}');
    expect(snapshotPath).toBeDefined();
    expect(JSON.parse(fs.readFileSync(snapshotPath, "utf-8"))).toEqual({
      rules: { "no-debugger": "error" },
    });
  });

  it.each([
    { jsPlugins: ["./payload.mjs"] },
    { overrides: [{ files: ["*.tsx"], jsPlugins: ["./payload.mjs"] }] },
  ])("rejects executable config %j", (config) => {
    fs.writeFileSync(configPath, JSON.stringify(config));
    expect(snapshot()).toEqual([]);
  });

  it("rejects an executable config reached through extends", () => {
    fs.writeFileSync(configPath, '{"extends":["./shared.json"]}');
    fs.writeFileSync(path.join(rootDirectory, "shared.json"), '{"jsPlugins":["./payload.mjs"]}');
    expect(snapshot()).toEqual([]);
  });

  it("rewrites repeated local extends to one private snapshot", () => {
    fs.writeFileSync(configPath, '{"extends":["./shared.json","./shared.json"]}');
    fs.writeFileSync(path.join(rootDirectory, "shared.json"), '{"rules":{"no-debugger":"error"}}');
    const [snapshotPath] = snapshot();
    const config = JSON.parse(fs.readFileSync(snapshotPath, "utf-8"));
    expect(config.extends[0]).toBe(config.extends[1]);
    expect(path.dirname(config.extends[0])).toBe(snapshotDirectory);
    expect(JSON.parse(fs.readFileSync(config.extends[0], "utf-8"))).toEqual({
      rules: { "no-debugger": "error" },
    });
  });

  it("supports a symlinked scan root without accepting symlinks inside it", () => {
    fs.writeFileSync(configPath, '{"rules":{"no-debugger":"error"}}');
    const linkedRootDirectory = path.join(temporaryDirectory, "linked-project");
    fs.symlinkSync(rootDirectory, linkedRootDirectory, "dir");
    const snapshots = snapshotAdoptedLintConfigs({
      configPaths: [path.join(linkedRootDirectory, ".oxlintrc.json")],
      rootDirectory: linkedRootDirectory,
      snapshotDirectory,
    });
    expect(snapshots).toHaveLength(1);
  });

  it("bounds repeated config expansion", () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({ extends: Array.from({ length: 100 }, () => "./shared.json") }),
    );
    fs.writeFileSync(path.join(rootDirectory, "shared.json"), '{"rules":{"no-debugger":"error"}}');
    expect(snapshot()).toEqual([]);
  });

  it("rejects cyclic extends", () => {
    fs.writeFileSync(configPath, '{"extends":["./.oxlintrc.json"]}');
    expect(snapshot()).toEqual([]);
  });

  it.each(["../outside.json", "./linked.json"])(
    "rejects out-of-tree extends %s",
    (extendedPath) => {
      const outsidePath = path.join(temporaryDirectory, "outside.json");
      fs.writeFileSync(outsidePath, '{"rules":{"no-debugger":"error"}}');
      fs.symlinkSync(outsidePath, path.join(rootDirectory, "linked.json"));
      fs.writeFileSync(configPath, JSON.stringify({ extends: [extendedPath] }));
      expect(snapshot()).toEqual([]);
    },
  );

  it("rejects a config symlink to a special file", () => {
    fs.symlinkSync("/dev/zero", configPath);
    expect(snapshot()).toEqual([]);
  });
});
