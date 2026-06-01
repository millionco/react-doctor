import os from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { buildRunContext } from "../src/cli/utils/build-run-context.js";

describe("buildRunContext", () => {
  let savedUserAgent: string | undefined;
  let savedArgv: string[];

  beforeEach(() => {
    savedUserAgent = process.env.npm_config_user_agent;
    savedArgv = process.argv;
  });

  afterEach(() => {
    if (savedUserAgent === undefined) {
      delete process.env.npm_config_user_agent;
    } else {
      process.env.npm_config_user_agent = savedUserAgent;
    }
    process.argv = savedArgv;
  });

  it("derives invokedVia from the leading npm_config_user_agent token", () => {
    process.env.npm_config_user_agent = "pnpm/9.1.0 npm/? node/v22.0.0 darwin arm64";
    expect(buildRunContext().invokedVia).toBe("pnpm");

    process.env.npm_config_user_agent = "npm/10.2.3 node/v20.11.0 darwin arm64 workspaces/false";
    expect(buildRunContext().invokedVia).toBe("npm");
  });

  it("falls back to 'unknown' when no package-manager user agent is present", () => {
    delete process.env.npm_config_user_agent;
    expect(buildRunContext().invokedVia).toBe("unknown");
  });

  it("reports the running Node major version", () => {
    const expectedMajor = Number.parseInt(process.versions.node.split(".", 1)[0] ?? "", 10);
    expect(buildRunContext().nodeMajor).toBe(expectedMajor);
  });

  it("scrubs the OS username out of cwd (home directory replaced with ~)", () => {
    const { cwd } = buildRunContext();
    expect(cwd).not.toContain(os.homedir());
  });

  it("scrubs home-directory paths out of argv", () => {
    process.argv = ["node", "react-doctor", `${os.homedir()}/secret-project`, "--json"];
    const { argv } = buildRunContext();
    expect(argv).not.toContain(os.homedir());
    expect(argv).toContain("~/secret-project");
    expect(argv).toContain("--json");
  });
});
