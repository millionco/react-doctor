import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { installReactDoctorAgentHooks } from "../src/cli/utils/install-agent-hooks.js";
import * as fs from "node:fs";

interface AgentHooksFixture {
  readonly projectRoot: string;
  readonly cleanup: () => void;
}

interface AgentHookJsonOutput {
  readonly additional_context: string;
}

interface ClaudeAgentHookJsonOutput {
  readonly hookSpecificOutput: {
    readonly hookEventName: string;
    readonly additionalContext: string;
  };
}

interface FakeBinaryOptions {
  readonly exitCode: number;
  readonly output?: string;
  readonly invocationFileName?: string;
}

const setupFixture = (): AgentHooksFixture => {
  const root = fs.mkdtempSync(path.join(tmpdir(), "react-doctor-agent-hooks-"));
  return {
    projectRoot: root,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
};

const readJson = <Value>(filePath: string): Value => JSON.parse(fs.readFileSync(filePath, "utf8"));

const writeFakeReactDoctorBinary = (projectRoot: string, options: FakeBinaryOptions): void => {
  const localBinaryPath = path.join(projectRoot, "node_modules/.bin/react-doctor");
  fs.mkdirSync(path.dirname(localBinaryPath), { recursive: true });
  const output = options.output ?? "fake scan output";
  const invocationFileName = options.invocationFileName ?? "agent-hook-args.txt";
  fs.writeFileSync(
    localBinaryPath,
    [
      "#!/bin/sh",
      "printf '%s\\n' \"$PWD\" > .react-doctor/agent-hook-cwd.txt",
      `printf '%s\\n' "$@" > .react-doctor/${invocationFileName}`,
      `printf '%s\\n' '${output}'`,
      `exit ${options.exitCode}`,
      "",
    ].join("\n"),
  );
  fs.chmodSync(localBinaryPath, fs.constants.S_IRWXU);
};

const writeFakePathReactDoctorBinary = (
  binDirectory: string,
  projectRoot: string,
  options: FakeBinaryOptions,
): void => {
  fs.mkdirSync(binDirectory, { recursive: true });
  const output = options.output ?? "fake scan output";
  const invocationFileName = options.invocationFileName ?? "path-agent-hook-args.txt";
  const binaryPath = path.join(binDirectory, "react-doctor");
  fs.writeFileSync(
    binaryPath,
    [
      "#!/bin/sh",
      `printf '%s\\n' "$PWD" > "${projectRoot}/.react-doctor/path-agent-hook-cwd.txt"`,
      `printf '%s\\n' "$@" > "${projectRoot}/.react-doctor/${invocationFileName}"`,
      `printf '%s\\n' '${output}'`,
      `exit ${options.exitCode}`,
      "",
    ].join("\n"),
  );
  fs.chmodSync(binaryPath, fs.constants.S_IRWXU);
};

describe.skipIf(process.platform === "win32")("installReactDoctorAgentHooks", () => {
  let fixture: AgentHooksFixture;

  beforeEach(() => {
    fixture = setupFixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it("installs a Claude Code PostToolBatch hook without duplicating existing hooks", () => {
    const settingsPath = path.join(fixture.projectRoot, ".claude/settings.json");
    const hookPath = path.join(fixture.projectRoot, ".claude/hooks/react-doctor.sh");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        permissions: { allow: ["Bash(git status)"] },
        hooks: {
          PostToolBatch: [
            {
              hooks: [{ type: "command", command: "echo existing" }],
            },
          ],
        },
      }),
    );

    const result = installReactDoctorAgentHooks({
      projectRoot: fixture.projectRoot,
      agents: ["claude-code"],
    });
    installReactDoctorAgentHooks({
      projectRoot: fixture.projectRoot,
      agents: ["claude-code"],
    });

    const settings = readJson<{
      permissions: { allow: string[] };
      hooks: { PostToolBatch: Array<{ hooks: Array<{ command: string }> }> };
    }>(settingsPath);
    const hookCommands = settings.hooks.PostToolBatch.flatMap((group) =>
      group.hooks.map((hook) => hook.command),
    );
    const hookContent = fs.readFileSync(hookPath, "utf8");

    expect(result.installedAgents).toEqual(["claude-code"]);
    expect(result.files).toContain(settingsPath);
    expect(settings.permissions.allow).toEqual(["Bash(git status)"]);
    expect(hookCommands.filter((command) => command.includes("react-doctor.sh"))).toHaveLength(1);
    expect(hookContent).toContain("project_root=${CLAUDE_PROJECT_DIR:-}");
    expect(hookContent).toContain("react-doctor --verbose --diff");
    expect(Boolean(fs.statSync(hookPath).mode & fs.constants.S_IXUSR)).toBe(true);
  });

  it("installs a Cursor postToolUse hook and preserves existing hook config", () => {
    const configPath = path.join(fixture.projectRoot, ".cursor/hooks.json");
    const hookPath = path.join(fixture.projectRoot, ".cursor/hooks/react-doctor.sh");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        version: 1,
        hooks: {
          sessionStart: [{ command: ".cursor/hooks/bootstrap.sh" }],
        },
      }),
    );

    const result = installReactDoctorAgentHooks({
      projectRoot: fixture.projectRoot,
      agents: ["cursor"],
    });
    installReactDoctorAgentHooks({
      projectRoot: fixture.projectRoot,
      agents: ["cursor"],
    });

    const config = readJson<{
      version: number;
      hooks: {
        sessionStart: Array<{ command: string }>;
        postToolUse: Array<{ command: string; matcher: string; timeout: number }>;
      };
    }>(configPath);

    expect(result.installedAgents).toEqual(["cursor"]);
    const hookContent = fs.readFileSync(hookPath, "utf8");
    expect(config.version).toBe(1);
    expect(config.hooks.sessionStart).toEqual([{ command: ".cursor/hooks/bootstrap.sh" }]);
    expect(config.hooks.postToolUse).toHaveLength(1);
    expect(config.hooks.postToolUse[0]).toEqual({
      command: ".cursor/hooks/react-doctor.sh",
      matcher: "Write|Edit|MultiEdit|ApplyPatch",
      timeout: 120,
    });
    expect(fs.existsSync(hookPath)).toBe(true);
    expect(hookContent).toContain('project_root=$(CDPATH= cd "$script_dir/../.." && pwd)');
    expect(hookContent).toContain("additional_context");
    expect(Boolean(fs.statSync(hookPath).mode & fs.constants.S_IXUSR)).toBe(true);
  });

  it("runs generated agent hooks from the project root and returns scan context", () => {
    const hookPath = path.join(fixture.projectRoot, ".cursor/hooks/react-doctor.sh");
    const nestedDirectory = path.join(fixture.projectRoot, "packages/app/src");
    fs.mkdirSync(nestedDirectory, { recursive: true });
    fs.mkdirSync(path.join(fixture.projectRoot, ".react-doctor"), { recursive: true });
    installReactDoctorAgentHooks({
      projectRoot: fixture.projectRoot,
      agents: ["cursor"],
    });
    writeFakeReactDoctorBinary(fixture.projectRoot, { exitCode: 1 });

    const output = execFileSync("sh", [hookPath], {
      cwd: nestedDirectory,
      input: JSON.stringify({
        tool_name: "Write",
      }),
      encoding: "utf8",
    });
    const parsedOutput: AgentHookJsonOutput = JSON.parse(output);

    expect(
      fs.realpathSync(
        fs.readFileSync(
          path.join(fixture.projectRoot, ".react-doctor/agent-hook-cwd.txt"),
          "utf8",
        ).trim(),
      ),
    ).toBe(fs.realpathSync(fixture.projectRoot));
    expect(
      fs.readFileSync(path.join(fixture.projectRoot, ".react-doctor/agent-hook-args.txt"), "utf8"),
    ).toBe("--verbose\n--diff\n--fail-on\nwarning\n--no-score\n");
    expect(parsedOutput.additional_context).toContain("fake scan output");
    expect(parsedOutput.additional_context).toContain("create GitHub issues");
  });

  it("uses CLAUDE_PROJECT_DIR when a generated Claude hook runs outside the repo", () => {
    const hookPath = path.join(fixture.projectRoot, ".claude/hooks/react-doctor.sh");
    const outsideDirectory = path.join(fixture.projectRoot, "..", "outside-cwd");
    fs.mkdirSync(outsideDirectory, { recursive: true });
    fs.mkdirSync(path.join(fixture.projectRoot, ".react-doctor"), { recursive: true });
    installReactDoctorAgentHooks({
      projectRoot: fixture.projectRoot,
      agents: ["claude-code"],
    });
    writeFakeReactDoctorBinary(fixture.projectRoot, { exitCode: 1 });

    const output = execFileSync("sh", [hookPath], {
      cwd: outsideDirectory,
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: fixture.projectRoot,
      },
      input: JSON.stringify({
        hook_event_name: "PostToolBatch",
        tool_calls: [{ tool_name: "Write" }],
      }),
      encoding: "utf8",
    });
    const parsedOutput: ClaudeAgentHookJsonOutput = JSON.parse(output);

    expect(
      fs.realpathSync(
        fs.readFileSync(
          path.join(fixture.projectRoot, ".react-doctor/agent-hook-cwd.txt"),
          "utf8",
        ).trim(),
      ),
    ).toBe(fs.realpathSync(fixture.projectRoot));
    expect(parsedOutput.hookSpecificOutput).toEqual({
      hookEventName: "PostToolBatch",
      additionalContext: expect.stringContaining("fake scan output"),
    });
    expect(parsedOutput.hookSpecificOutput.additionalContext).toContain("create GitHub issues");
  });

  it("uses a PATH react-doctor binary when the local binary is missing", () => {
    const hookPath = path.join(fixture.projectRoot, ".cursor/hooks/react-doctor.sh");
    const binDirectory = path.join(fixture.projectRoot, "fake-bin");
    fs.mkdirSync(path.join(fixture.projectRoot, ".react-doctor"), { recursive: true });
    installReactDoctorAgentHooks({
      projectRoot: fixture.projectRoot,
      agents: ["cursor"],
    });
    writeFakePathReactDoctorBinary(binDirectory, fixture.projectRoot, {
      exitCode: 1,
      output: "path scan output",
    });

    const output = execFileSync("sh", [hookPath], {
      cwd: fixture.projectRoot,
      env: {
        ...process.env,
        PATH: [
          binDirectory,
          path.dirname(process.execPath),
          "/usr/bin",
          "/bin",
          process.env.PATH ?? "",
        ].join(path.delimiter),
      },
      input: JSON.stringify({
        tool_name: "Write",
      }),
      encoding: "utf8",
    });
    const parsedOutput: AgentHookJsonOutput = JSON.parse(output);

    expect(
      fs.readFileSync(
        path.join(fixture.projectRoot, ".react-doctor/path-agent-hook-args.txt"),
        "utf8",
      ),
    ).toBe("--verbose\n--diff\n--fail-on\nwarning\n--no-score\n");
    expect(parsedOutput.additional_context).toContain("path scan output");
  });

  it("exits quietly when no react-doctor runner is available", () => {
    const hookPath = path.join(fixture.projectRoot, ".cursor/hooks/react-doctor.sh");
    const invocationPath = path.join(fixture.projectRoot, ".react-doctor/agent-hook-args.txt");
    fs.mkdirSync(path.join(fixture.projectRoot, ".react-doctor"), { recursive: true });
    installReactDoctorAgentHooks({
      projectRoot: fixture.projectRoot,
      agents: ["cursor"],
    });

    const output = execFileSync("sh", [hookPath], {
      cwd: fixture.projectRoot,
      env: {
        ...process.env,
        PATH: "/usr/bin:/bin",
      },
      input: JSON.stringify({
        tool_name: "Write",
      }),
      encoding: "utf8",
    });

    expect(output).toBe("");
    expect(fs.existsSync(invocationPath)).toBe(false);
  });

  it("skips generated agent hooks for non-edit tool batches", () => {
    const hookPath = path.join(fixture.projectRoot, ".claude/hooks/react-doctor.sh");
    const invocationPath = path.join(fixture.projectRoot, ".react-doctor/agent-hook-args.txt");
    fs.mkdirSync(path.join(fixture.projectRoot, ".react-doctor"), { recursive: true });
    installReactDoctorAgentHooks({
      projectRoot: fixture.projectRoot,
      agents: ["claude-code"],
    });
    writeFakeReactDoctorBinary(fixture.projectRoot, { exitCode: 1 });

    const output = execFileSync("sh", [hookPath], {
      cwd: path.join(fixture.projectRoot, ".claude/hooks"),
      input: JSON.stringify({
        hook_event_name: "PostToolBatch",
        tool_calls: [{ tool_name: "Read" }],
      }),
      encoding: "utf8",
    });

    expect(output).toBe("");
    expect(fs.existsSync(invocationPath)).toBe(false);
  });

  it("returns no context when a generated agent hook scan succeeds", () => {
    const hookPath = path.join(fixture.projectRoot, ".cursor/hooks/react-doctor.sh");
    fs.mkdirSync(path.join(fixture.projectRoot, ".react-doctor"), { recursive: true });
    installReactDoctorAgentHooks({
      projectRoot: fixture.projectRoot,
      agents: ["cursor"],
    });
    writeFakeReactDoctorBinary(fixture.projectRoot, { exitCode: 0, output: "clean scan" });

    const output = execFileSync("sh", [hookPath], {
      cwd: fixture.projectRoot,
      input: JSON.stringify({
        tool_name: "Write",
      }),
      encoding: "utf8",
    });

    expect(output).toBe("");
    expect(
      fs.readFileSync(path.join(fixture.projectRoot, ".react-doctor/agent-hook-args.txt"), "utf8"),
    ).toBe("--verbose\n--diff\n--fail-on\nwarning\n--no-score\n");
  });

  it("skips generated agent hooks for non-edit single tool events", () => {
    const hookPath = path.join(fixture.projectRoot, ".cursor/hooks/react-doctor.sh");
    const invocationPath = path.join(fixture.projectRoot, ".react-doctor/agent-hook-args.txt");
    fs.mkdirSync(path.join(fixture.projectRoot, ".react-doctor"), { recursive: true });
    installReactDoctorAgentHooks({
      projectRoot: fixture.projectRoot,
      agents: ["cursor"],
    });
    writeFakeReactDoctorBinary(fixture.projectRoot, { exitCode: 1 });

    const output = execFileSync("sh", [hookPath], {
      cwd: fixture.projectRoot,
      input: JSON.stringify({
        tool_name: "Read",
      }),
      encoding: "utf8",
    });

    expect(output).toBe("");
    expect(fs.existsSync(invocationPath)).toBe(false);
  });

  it("scans when hook input is malformed instead of failing closed", () => {
    const hookPath = path.join(fixture.projectRoot, ".cursor/hooks/react-doctor.sh");
    fs.mkdirSync(path.join(fixture.projectRoot, ".react-doctor"), { recursive: true });
    installReactDoctorAgentHooks({
      projectRoot: fixture.projectRoot,
      agents: ["cursor"],
    });
    writeFakeReactDoctorBinary(fixture.projectRoot, { exitCode: 1 });

    const output = execFileSync("sh", [hookPath], {
      cwd: fixture.projectRoot,
      input: "{not-json",
      encoding: "utf8",
    });
    const parsedOutput: AgentHookJsonOutput = JSON.parse(output);

    expect(parsedOutput.additional_context).toContain("fake scan output");
  });

  it("ignores agents without native hook support", () => {
    const result = installReactDoctorAgentHooks({
      projectRoot: fixture.projectRoot,
      agents: ["codex", "opencode"],
    });

    expect(result.installedAgents).toEqual([]);
    expect(result.files).toEqual([]);
    expect(fs.existsSync(path.join(fixture.projectRoot, ".cursor/hooks.json"))).toBe(false);
    expect(fs.existsSync(path.join(fixture.projectRoot, ".claude/settings.json"))).toBe(false);
  });
});
