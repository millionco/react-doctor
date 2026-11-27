import { createHash } from "node:crypto";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  createCrossFileClosureSnapshot,
  isCurrentCrossFileClosureSnapshot,
} from "../src/cli/utils/cross-file-closure-snapshot.js";

vi.mock("oxlint-plugin-react-doctor/core", async () => {
  const { hasPotentialSplitGenerationReactSource } =
    await import("../../oxlint-plugin-react-doctor/src/plugin/utils/has-potential-split-generation-react-proof.js");
  const { hasPotentialCallerEventListSource } =
    await import("../../oxlint-plugin-react-doctor/src/plugin/utils/has-potential-caller-event-list-proof.js");
  return {
    hasPotentialCallerEventListSource,
    hasPotentialSplitGenerationReactSource,
    resetManifestCaches: vi.fn(),
    collectCrossFileDependencyProbes: vi.fn(() => ({
      contentPaths: [],
      existencePaths: [],
      directoryPaths: [],
      realpathPaths: [],
    })),
  };
});
vi.mock("@react-doctor/core", () => ({ readRealpathIdentity: vi.fn(() => null) }));
vi.mock("@react-doctor/core/scan-preamble", () => ({ resolveGitCommand: vi.fn() }));

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});
const setup = (source: string) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loading-closure-cache-"));
  directories.push(root);
  const file = path.join(root, "Panel.tsx");
  fs.writeFileSync(file, source);
  return { root, file };
};
const published = `import {useRef} from 'react'; export function useTask() {
  const generation=useRef(0);
  return async () => { const token=generation.current+1; generation.current=token;
    await task(); if(generation.current===token) finish(); };
}`;
const ordinary = `import {useState} from 'react'; export function Panel(){ const [value]=useState(0); return <div>{value}</div>; }`;

describe("whole-scan loading provider boundary", () => {
  it("does not persist a split-generation provider verdict", () => {
    const { root } = setup(published);
    expect(createCrossFileClosureSnapshot(root, ["Panel.tsx"])).toBeNull();
  });
  it("rejects an older snapshot with identical source and no provider probes", () => {
    const { root, file } = setup(published);
    const hash = (value: string) => createHash("sha256").update(value).digest("hex");
    const snapshot = {
      contentPaths: [file],
      existencePaths: [],
      directoryPaths: [],
      realpathPaths: [],
      fingerprint: hash(JSON.stringify([[[file, hash(published)]], [], [], []])),
    };
    expect(isCurrentCrossFileClosureSnapshot(snapshot)).toBe(false);
    fs.writeFileSync(
      path.join(root, "vite.config.ts"),
      "export default {resolve:{alias:{react:'./alternate'}}};",
    );
    expect(isCurrentCrossFileClosureSnapshot(snapshot)).toBe(false);
  });
  it("preserves ordinary source snapshot eligibility", () => {
    const { root } = setup(ordinary);
    const snapshot = createCrossFileClosureSnapshot(root, ["Panel.tsx"]);
    expect(snapshot).not.toBeNull();
    expect(isCurrentCrossFileClosureSnapshot(snapshot!)).toBe(true);
  });
});
