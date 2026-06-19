import os from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { buildRunContext } from "../src/cli/utils/build-run-context.js";

const CI_ENV_VARS = ["GITHUB_EVENT_NAME", "REACT_DOCTOR_GITHUB_ACTION"] as const;

describe("buildRunContext", () => {
  let savedUserAgent: string | undefined;
  let savedLintBatchOrdering: string | undefined;
  let savedArgv: string[];
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedUserAgent = process.env.npm_config_user_agent;
    savedLintBatchOrdering = process.env.REACT_DOCTOR_LINT_BATCH_ORDERING;
    delete process.env.REACT_DOCTOR_LINT_BATCH_ORDERING;
    savedArgv = process.argv;
    savedEnv = {};
    for (const name of CI_ENV_VARS) {
      savedEnv[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    if (savedUserAgent === undefined) {
      delete process.env.npm_config_user_agent;
    } else {
      process.env.npm_config_user_agent = savedUserAgent;
    }
    if (savedLintBatchOrdering === undefined) {
      delete process.env.REACT_DOCTOR_LINT_BATCH_ORDERING;
    } else {
      process.env.REACT_DOCTOR_LINT_BATCH_ORDERING = savedLintBatchOrdering;
    }
    process.argv = savedArgv;
    for (const name of CI_ENV_VARS) {
      const previous = savedEnv[name];
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    }
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

  it("records a terminalKind label for where the run is hosted", () => {
    expect(typeof buildRunContext().terminalKind).toBe("string");
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

  it("memoizes a stable runId across calls", () => {
    const { runId } = buildRunContext();
    expect(runId).toMatch(/[0-9a-f-]{36}/i);
    expect(buildRunContext().runId).toBe(runId);
  });

  it("reports the GitHub event name and official-action marker when present", () => {
    process.env.GITHUB_EVENT_NAME = "pull_request";
    process.env.REACT_DOCTOR_GITHUB_ACTION = "v1";
    const context = buildRunContext();
    expect(context.eventName).toBe("pull_request");
    expect(context.viaAction).toBe(true);
  });

  it("leaves eventName null and viaAction false outside the GitHub Action", () => {
    const context = buildRunContext();
    expect(context.eventName).toBeNull();
    expect(context.viaAction).toBe(false);
  });

  it("defaults lintBatchOrdering to 'arrival' and honors the cost override", () => {
    expect(buildRunContext().lintBatchOrdering).toBe("arrival");

    process.env.REACT_DOCTOR_LINT_BATCH_ORDERING = "cost";
    expect(buildRunContext().lintBatchOrdering).toBe("cost");
  });
});
