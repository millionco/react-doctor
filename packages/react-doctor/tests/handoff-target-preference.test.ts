import { tmpdir } from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  readHandoffTarget,
  rememberHandoffTarget,
} from "../src/cli/utils/handoff-target-preference.js";
import { getCliStatePath } from "../src/cli/utils/cli-state-store.js";

describe("handoff target preference", () => {
  let configRoot: string;
  let cleanup: () => void;

  beforeEach(() => {
    const root = fs.mkdtempSync(path.join(tmpdir(), "react-doctor-handoff-pref-"));
    configRoot = root;
    cleanup = () => fs.rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    cleanup();
  });

  it("reads null before the user has ever picked", () => {
    expect(readHandoffTarget({ cwd: configRoot })).toBe(null);
  });

  it("remembers the last pick and reads it back", () => {
    expect(rememberHandoffTarget("claude", { cwd: configRoot })).toBe(true);
    expect(readHandoffTarget({ cwd: configRoot })).toBe("claude");
  });

  it("overwrites the remembered pick on each new choice (last wins)", () => {
    rememberHandoffTarget("claude", { cwd: configRoot });
    rememberHandoffTarget("skip", { cwd: configRoot });
    expect(readHandoffTarget({ cwd: configRoot })).toBe("skip");
  });

  it("stores the pick as a global handoff-target preference in the shared config file", () => {
    rememberHandoffTarget("cursor", { cwd: configRoot });
    const stored = JSON.parse(fs.readFileSync(getCliStatePath({ cwd: configRoot }), "utf8"));
    expect(stored.global.preferences["handoff-target"]).toBe("cursor");
  });
});
