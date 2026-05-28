import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  CI_ENVIRONMENT_VARIABLES,
  CODING_AGENT_ENVIRONMENT_VALUE_VARIABLES,
  CODING_AGENT_ENVIRONMENT_VARIABLES,
  isCiEnvironment,
  isCiOrCodingAgentEnvironment,
  isCodingAgentEnvironment,
} from "../src/cli/utils/is-ci-environment.js";

const ENVIRONMENT_VARIABLES = [
  "CI",
  ...CI_ENVIRONMENT_VARIABLES,
  ...CODING_AGENT_ENVIRONMENT_VARIABLES,
  ...CODING_AGENT_ENVIRONMENT_VALUE_VARIABLES,
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "OPENCODE_CONFIG",
  "AIDER_MODEL",
] as const;

describe("isCiEnvironment", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const envVariable of ENVIRONMENT_VARIABLES) {
      savedEnv[envVariable] = process.env[envVariable];
      delete process.env[envVariable];
    }
  });

  afterEach(() => {
    for (const envVariable of ENVIRONMENT_VARIABLES) {
      const previousValue = savedEnv[envVariable];
      if (previousValue === undefined) {
        delete process.env[envVariable];
      } else {
        process.env[envVariable] = previousValue;
      }
    }
  });

  it("returns false without CI or coding agent signals", () => {
    expect(isCiEnvironment()).toBe(false);
    expect(isCiOrCodingAgentEnvironment()).toBe(false);
    expect(isCodingAgentEnvironment()).toBe(false);
  });

  it("returns true for canonical CI signals", () => {
    process.env.CI = "true";
    expect(isCiEnvironment()).toBe(true);
    expect(isCiOrCodingAgentEnvironment()).toBe(true);
    expect(isCodingAgentEnvironment()).toBe(false);
  });

  it("returns true for GitHub Actions", () => {
    process.env.GITHUB_ACTIONS = "1";
    expect(isCiEnvironment()).toBe(true);
    expect(isCiOrCodingAgentEnvironment()).toBe(true);
    expect(isCodingAgentEnvironment()).toBe(false);
  });

  it("returns true for Cursor Agent", () => {
    process.env.CURSOR_AGENT = "1";
    expect(isCiEnvironment()).toBe(false);
    expect(isCiOrCodingAgentEnvironment()).toBe(true);
    expect(isCodingAgentEnvironment()).toBe(true);
  });

  it("returns true for Claude Code subprocesses", () => {
    process.env.CLAUDECODE = "1";
    expect(isCiEnvironment()).toBe(false);
    expect(isCiOrCodingAgentEnvironment()).toBe(true);
    expect(isCodingAgentEnvironment()).toBe(true);
  });

  it("returns true for the legacy Claude Code signal", () => {
    process.env.CLAUDE_CODE = "1";
    expect(isCiEnvironment()).toBe(false);
    expect(isCiOrCodingAgentEnvironment()).toBe(true);
    expect(isCodingAgentEnvironment()).toBe(true);
  });

  it("returns true for Codex CI", () => {
    process.env.CODEX_CI = "1";
    expect(isCiEnvironment()).toBe(false);
    expect(isCiOrCodingAgentEnvironment()).toBe(true);
    expect(isCodingAgentEnvironment()).toBe(true);
  });

  it("returns true for Codex sandboxed subprocesses", () => {
    process.env.CODEX_SANDBOX = "seatbelt";
    expect(isCiEnvironment()).toBe(false);
    expect(isCiOrCodingAgentEnvironment()).toBe(true);
    expect(isCodingAgentEnvironment()).toBe(true);
  });

  it("returns true for Codex sandboxed subprocesses with network disabled", () => {
    process.env.CODEX_SANDBOX_NETWORK_DISABLED = "1";
    expect(isCiEnvironment()).toBe(false);
    expect(isCiOrCodingAgentEnvironment()).toBe(true);
    expect(isCodingAgentEnvironment()).toBe(true);
  });

  it("returns true for Amp tool execution via AGENT value", () => {
    process.env.AGENT = "amp";
    expect(isCiEnvironment()).toBe(false);
    expect(isCiOrCodingAgentEnvironment()).toBe(true);
    expect(isCodingAgentEnvironment()).toBe(true);
  });

  it("returns true for Amp tool execution via AMP_THREAD_ID", () => {
    process.env.AMP_THREAD_ID = "thread-123";
    expect(isCiEnvironment()).toBe(false);
    expect(isCiOrCodingAgentEnvironment()).toBe(true);
    expect(isCodingAgentEnvironment()).toBe(true);
  });

  it("returns true for Amp tool execution via AGENT_THREAD_ID", () => {
    process.env.AGENT_THREAD_ID = "thread-456";
    expect(isCiEnvironment()).toBe(false);
    expect(isCiOrCodingAgentEnvironment()).toBe(true);
    expect(isCodingAgentEnvironment()).toBe(true);
  });

  it("returns true for Amp tool execution via AGENT_SESSION_ID", () => {
    process.env.AGENT_SESSION_ID = "session-789";
    expect(isCiEnvironment()).toBe(false);
    expect(isCiOrCodingAgentEnvironment()).toBe(true);
    expect(isCodingAgentEnvironment()).toBe(true);
  });

  it("returns true for Goose shell execution via GOOSE_TERMINAL", () => {
    process.env.GOOSE_TERMINAL = "1";
    expect(isCiEnvironment()).toBe(false);
    expect(isCiOrCodingAgentEnvironment()).toBe(true);
    expect(isCodingAgentEnvironment()).toBe(true);
  });

  it("returns true for Goose shell execution via AGENT value", () => {
    process.env.AGENT = "goose";
    expect(isCiEnvironment()).toBe(false);
    expect(isCiOrCodingAgentEnvironment()).toBe(true);
    expect(isCodingAgentEnvironment()).toBe(true);
  });

  it("returns true for OpenCode agent execution", () => {
    process.env.OPENCODE = "1";
    expect(isCiEnvironment()).toBe(false);
    expect(isCiOrCodingAgentEnvironment()).toBe(true);
    expect(isCodingAgentEnvironment()).toBe(true);
  });

  it("matches AGENT values case-insensitively", () => {
    process.env.AGENT = "AMP";
    expect(isCodingAgentEnvironment()).toBe(true);

    process.env.AGENT = "Goose";
    expect(isCodingAgentEnvironment()).toBe(true);
  });

  it("returns false for unrelated AGENT values", () => {
    process.env.AGENT = "not-a-coding-agent";
    expect(isCiEnvironment()).toBe(false);
    expect(isCiOrCodingAgentEnvironment()).toBe(false);
    expect(isCodingAgentEnvironment()).toBe(false);
  });

  it("returns false for coding tool configuration variables alone", () => {
    process.env.OPENAI_API_KEY = "token";
    process.env.GEMINI_API_KEY = "token";
    process.env.OPENCODE_CONFIG = "/tmp/opencode.json";
    process.env.AIDER_MODEL = "sonnet";
    expect(isCiEnvironment()).toBe(false);
    expect(isCiOrCodingAgentEnvironment()).toBe(false);
    expect(isCodingAgentEnvironment()).toBe(false);
  });
});
