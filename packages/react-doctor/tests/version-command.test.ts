import { describe, expect, it } from "vite-plus/test";
import { buildVersionString } from "../src/cli/commands/version.js";
import { VERSION } from "../src/cli/utils/version.js";

describe("buildVersionString", () => {
  it("includes the CLI version, platform/arch, and Node version for debugging", () => {
    const versionString = buildVersionString();
    expect(versionString).toContain(`react-doctor/${VERSION}`);
    expect(versionString).toContain(`${process.platform}-${process.arch}`);
    expect(versionString).toContain(`node-${process.version}`);
  });

  it("is a single line", () => {
    expect(buildVersionString()).not.toContain("\n");
  });
});
