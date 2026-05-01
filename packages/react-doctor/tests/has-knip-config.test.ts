import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { KNIP_CONFIG_LOCATIONS } from "../src/constants.js";
import { hasKnipConfig } from "../src/utils/has-knip-config.js";

describe("hasKnipConfig", () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "knip-config-"));
  });

  afterEach(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it("returns false when no knip config is present", () => {
    expect(hasKnipConfig(temporaryDirectory)).toBe(false);
  });

  it("returns false for a nonexistent directory", () => {
    expect(hasKnipConfig("/nonexistent/path")).toBe(false);
  });

  it.each(KNIP_CONFIG_LOCATIONS)("returns true when %s is present", (configFilename) => {
    fs.writeFileSync(path.join(temporaryDirectory, configFilename), "");
    expect(hasKnipConfig(temporaryDirectory)).toBe(true);
  });
});
