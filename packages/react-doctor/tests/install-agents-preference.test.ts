import { tmpdir } from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  readInstallAgents,
  rememberInstallAgents,
} from "../src/cli/utils/install-agents-preference.js";
import { getCliStatePath } from "../src/cli/utils/cli-state-store.js";

describe("install agents preference", () => {
  let configRoot: string;
  let cleanup: () => void;

  beforeEach(() => {
    const root = fs.mkdtempSync(path.join(tmpdir(), "react-doctor-install-agents-pref-"));
    configRoot = root;
    cleanup = () => fs.rmSync(root, { recursive: true, force: true });
  });

  afterEach(() => {
    cleanup();
  });

  it("reads an empty list before the user has ever picked", () => {
    expect(readInstallAgents({ cwd: configRoot })).toEqual([]);
  });

  it("remembers the last selection and reads it back in order", () => {
    expect(rememberInstallAgents(["claude-code", "cursor"], { cwd: configRoot })).toBe(true);
    expect(readInstallAgents({ cwd: configRoot })).toEqual(["claude-code", "cursor"]);
  });

  it("overwrites the remembered selection on each new pick (last wins)", () => {
    rememberInstallAgents(["claude-code", "cursor"], { cwd: configRoot });
    rememberInstallAgents(["goose"], { cwd: configRoot });
    expect(readInstallAgents({ cwd: configRoot })).toEqual(["goose"]);
  });

  it("drops stored ids that agent-install no longer recognizes", () => {
    // Start from a valid persisted state (so the schema-version migration leaves
    // it untouched), then corrupt the encoded value with one valid + one bogus id.
    rememberInstallAgents(["claude-code"], { cwd: configRoot });
    const statePath = getCliStatePath({ cwd: configRoot });
    const stored = JSON.parse(fs.readFileSync(statePath, "utf8"));
    stored.global.preferences["install-agents"] = "claude-code,not-an-agent";
    fs.writeFileSync(statePath, JSON.stringify(stored));
    expect(readInstallAgents({ cwd: configRoot })).toEqual(["claude-code"]);
  });

  it("stores the pick as a comma-encoded global install-agents preference", () => {
    rememberInstallAgents(["claude-code", "codex"], { cwd: configRoot });
    const stored = JSON.parse(fs.readFileSync(getCliStatePath({ cwd: configRoot }), "utf8"));
    expect(stored.global.preferences["install-agents"]).toBe("claude-code,codex");
  });
});
