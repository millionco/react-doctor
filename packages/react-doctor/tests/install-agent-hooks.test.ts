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

// The agent-hooks suite is POSIX-only (describe.skipIf win32), so the fake
// binary is a plain `#!/bin/sh` wrapper that execs a node script recording its
// cwd + argv and emitting the configured output/exit code.
const writeFakeReactDoctorBinaryAt = (
  binDirectory: string,
  projectRoot: string,
  options: FakeBinaryOptions,
  cwdFileName: string,
  defaultInvocationFileName: string,
): void => {
  fs.mkdirSync(binDirectory, { recursive: true });
  const output = options.output ?? "fake scan output";
  const invocationFileName = options.invocationFileName ?? defaultInvocationFileName;

  const scriptPath = path.join(binDirectory, "react-doctor.mjs");
  const scriptContent = [
    "import { writeFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    "",
    `const projectRoot = ${JSON.stringify(projectRoot)};`,
    `const output = ${JSON.stringify(output)};`,
    `const exitCode = ${options.exitCode};`,
    `const invocationFileName = ${JSON.stringify(invocationFileName)};`,
    `const cwdFileName = ${JSON.stringify(cwdFileName)};`,
    "",
    "try {",
    "  writeFileSync(join(projectRoot, '.react-doctor', cwdFileName), process.cwd() + '\\n');",
    "  writeFileSync(",
    "    join(projectRoot, '.react-doctor', invocationFileName),",
    "    process.argv.slice(2).join('\\n') + '\\n'",
    "  );",
    "  console.log(output);",
    "} catch (error) {}",
    "process.exit(exitCode);",
  ].join("\n");
  fs.writeFileSync(scriptPath, scriptContent);

  const wrapperPath = path.join(binDirectory, "react-doctor");
  fs.writeFileSync(wrapperPath, `#!/bin/sh\nexec node "${scriptPath}" "$@"`);
  fs.chmodSync(wrapperPath, fs.constants.S_IRWXU);
};

const writeFakeReactDoctorBinary = (projectRoot: string, options: FakeBinaryOptions): void =>
  writeFakeReactDoctorBinaryAt(
    path.join(projectRoot, "node_modules/.bin"),
    projectRoot,
    options,
    "agent-hook-cwd.txt",
    "agent-hook-args.txt",
  );

const writeFakePathReactDoctorBinary = (
  binDirectory: string,
  projectRoot: string,
  options: FakeBinaryOptions,
): void =>
  writeFakeReactDoctorBinaryAt(
    binDirectory,
    projectRoot,
    options,
    "path-agent-hook-cwd.txt",
    "path-agent-hook-args.txt",
  );

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
    const hookPath = path.join(fixture.projectRoot, ".claude/hooks/react-doctor.mjs");
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
    expect(hookCommands.filter((command) => command.includes("react-doctor.mjs"))).toHaveLength(1);
    expect(hookContent).toContain("CLAUDE_PROJECT_DIR");
    expect(hookContent).toContain("react-doctor --verbose --scope changed --blocking warning");
  });

  it("installs a Cursor postToolUse hook and preserves existing hook config", () => {
    const configPath = path.join(fixture.projectRoot, ".cursor/hooks.json");
    const hookPath = path.join(fixture.projectRoot, ".cursor/hooks/react-doctor.mjs");
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
      command: "node .cursor/hooks/react-doctor.mjs",
      matcher: "Write|Edit|MultiEdit|ApplyPatch",
      timeout: 120,
    });
    expect(fs.existsSync(hookPath)).toBe(true);
    expect(hookContent).toContain("__dirname");
    expect(hookContent).toContain("additional_context");
  });

  it("runs generated agent hooks from the project root and returns scan context", () => {
    const hookPath = path.join(fixture.projectRoot, ".cursor/hooks/react-doctor.mjs");
    const nestedDirectory = path.join(fixture.projectRoot, "packages/app/src");
    fs.mkdirSync(nestedDirectory, { recursive: true });
    fs.mkdirSync(path.join(fixture.projectRoot, ".react-doctor"), { recursive: true });
    installReactDoctorAgentHooks({
      projectRoot: fixture.projectRoot,
      agents: ["cursor"],
    });
    writeFakeReactDoctorBinary(fixture.projectRoot, { exitCode: 1 });

    const output = execFileSync(process.execPath, [hookPath], {
      cwd: nestedDirectory,
      input: JSON.stringify({
        tool_name: "Write",
      }),
      encoding: "utf8",
    });
    const parsedOutput: AgentHookJsonOutput = JSON.parse(output);

    expect(
      fs.realpathSync(
        fs
          .readFileSync(path.join(fixture.projectRoot, ".react-doctor/agent-hook-cwd.txt"), "utf8")
          .trim(),
      ),
    ).toBe(fs.realpathSync(fixture.projectRoot));
    expect(
      fs.readFileSync(path.join(fixture.projectRoot, ".react-doctor/agent-hook-args.txt"), "utf8"),
    ).toContain("--verbose");
    expect(parsedOutput.additional_context).toContain("fake scan output");
    expect(parsedOutput.additional_context).toContain("create GitHub issues");
  });

  it("uses CLAUDE_PROJECT_DIR when a generated Claude hook runs outside the repo", () => {
    const hookPath = path.join(fixture.projectRoot, ".claude/hooks/react-doctor.mjs");
    const outsideDirectory = path.join(fixture.projectRoot, "..", "outside-cwd");
    fs.mkdirSync(outsideDirectory, { recursive: true });
    fs.mkdirSync(path.join(fixture.projectRoot, ".react-doctor"), { recursive: true });
    installReactDoctorAgentHooks({
      projectRoot: fixture.projectRoot,
      agents: ["claude-code"],
    });
    writeFakeReactDoctorBinary(fixture.projectRoot, { exitCode: 1 });

    const output = execFileSync(process.execPath, [hookPath], {
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
        fs
          .readFileSync(path.join(fixture.projectRoot, ".react-doctor/agent-hook-cwd.txt"), "utf8")
          .trim(),
      ),
    ).toBe(fs.realpathSync(fixture.projectRoot));
    expect(parsedOutput.hookSpecificOutput).toEqual({
      hookEventName: "PostToolBatch",
      additionalContext: expect.stringContaining("fake scan output"),
    });
    expect(parsedOutput.hookSpecificOutput.additionalContext).toContain("create GitHub issues");
  });

  it("uses a PATH react-doctor binary when the local binary is missing", () => {
    const hookPath = path.join(fixture.projectRoot, ".cursor/hooks/react-doctor.mjs");
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

    const output = execFileSync(process.execPath, [hookPath], {
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
    ).toContain("--verbose");
    expect(parsedOutput.additional_context).toContain("path scan output");
  });

  it("exits quietly when no react-doctor runner is available", () => {
    const hookPath = path.join(fixture.projectRoot, ".cursor/hooks/react-doctor.mjs");
    const invocationPath = path.join(fixture.projectRoot, ".react-doctor/agent-hook-args.txt");
    fs.mkdirSync(path.join(fixture.projectRoot, ".react-doctor"), { recursive: true });
    installReactDoctorAgentHooks({
      projectRoot: fixture.projectRoot,
      agents: ["cursor"],
    });

    const output = execFileSync(process.execPath, [hookPath], {
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
    const hookPath = path.join(fixture.projectRoot, ".claude/hooks/react-doctor.mjs");
    const invocationPath = path.join(fixture.projectRoot, ".react-doctor/agent-hook-args.txt");
    fs.mkdirSync(path.join(fixture.projectRoot, ".react-doctor"), { recursive: true });
    installReactDoctorAgentHooks({
      projectRoot: fixture.projectRoot,
      agents: ["claude-code"],
    });
    writeFakeReactDoctorBinary(fixture.projectRoot, { exitCode: 1 });

    const output = execFileSync(process.execPath, [hookPath], {
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
    const hookPath = path.join(fixture.projectRoot, ".cursor/hooks/react-doctor.mjs");
    fs.mkdirSync(path.join(fixture.projectRoot, ".react-doctor"), { recursive: true });
    installReactDoctorAgentHooks({
      projectRoot: fixture.projectRoot,
      agents: ["cursor"],
    });
    writeFakeReactDoctorBinary(fixture.projectRoot, { exitCode: 0, output: "clean scan" });

    const output = execFileSync(process.execPath, [hookPath], {
      cwd: fixture.projectRoot,
      input: JSON.stringify({
        tool_name: "Write",
      }),
      encoding: "utf8",
    });

    expect(output).toBe("");
    expect(
      fs.readFileSync(path.join(fixture.projectRoot, ".react-doctor/agent-hook-args.txt"), "utf8"),
    ).toContain("--verbose");
  });

  it("skips generated agent hooks for non-edit single tool events", () => {
    const hookPath = path.join(fixture.projectRoot, ".cursor/hooks/react-doctor.mjs");
    const invocationPath = path.join(fixture.projectRoot, ".react-doctor/agent-hook-args.txt");
    fs.mkdirSync(path.join(fixture.projectRoot, ".react-doctor"), { recursive: true });
    installReactDoctorAgentHooks({
      projectRoot: fixture.projectRoot,
      agents: ["cursor"],
    });
    writeFakeReactDoctorBinary(fixture.projectRoot, { exitCode: 1 });

    const output = execFileSync(process.execPath, [hookPath], {
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
    const hookPath = path.join(fixture.projectRoot, ".cursor/hooks/react-doctor.mjs");
    fs.mkdirSync(path.join(fixture.projectRoot, ".react-doctor"), { recursive: true });
    installReactDoctorAgentHooks({
      projectRoot: fixture.projectRoot,
      agents: ["cursor"],
    });
    writeFakeReactDoctorBinary(fixture.projectRoot, { exitCode: 1 });

    const output = execFileSync(process.execPath, [hookPath], {
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

  it("throws CliInputError when settings file contains malformed JSON", () => {
    const settingsPath = path.join(fixture.projectRoot, ".claude/settings.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, '{ "permissions": { "allow": ["Bash(git status)"] }');

    expect(() => {
      installReactDoctorAgentHooks({
        projectRoot: fixture.projectRoot,
        agents: ["claude-code"],
      });
    }).toThrow(/Could not parse.*invalid JSON/);
  });

  it("throws CliInputError when config file contains malformed JSON", () => {
    const configPath = path.join(fixture.projectRoot, ".cursor/hooks.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, '{ "version": 1, "hooks": {');

    expect(() => {
      installReactDoctorAgentHooks({
        projectRoot: fixture.projectRoot,
        agents: ["cursor"],
      });
    }).toThrow(/Could not parse.*invalid JSON/);
  });

  it("throws CliInputError when .claude directory exists as a file", () => {
    const claudePath = path.join(fixture.projectRoot, ".claude");
    fs.writeFileSync(claudePath, "i am a file not a directory");

    expect(() => {
      installReactDoctorAgentHooks({
        projectRoot: fixture.projectRoot,
        agents: ["claude-code"],
      });
    }).toThrow(/Could not create directory.*file exists at this path/);
  });

  it("throws CliInputError when .cursor/hooks exists as a file", () => {
    const hooksPath = path.join(fixture.projectRoot, ".cursor/hooks");
    fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
    fs.writeFileSync(hooksPath, "i am a file not a directory");

    expect(() => {
      installReactDoctorAgentHooks({
        projectRoot: fixture.projectRoot,
        agents: ["cursor"],
      });
    }).toThrow(/Could not create directory.*file exists at this path/);
  });

  it("throws CliInputError when target directory is not writable", () => {
    if (process.getuid?.() === 0) {
      return;
    }

    const readOnlyRoot = path.join(fixture.projectRoot, "readonly");
    fs.mkdirSync(readOnlyRoot, { mode: 0o555 });

    expect(() => {
      installReactDoctorAgentHooks({
        projectRoot: readOnlyRoot,
        agents: ["cursor"],
      });
    }).toThrow(/Could not create directory.*permission denied/);

    fs.chmodSync(readOnlyRoot, 0o755);
  });
});
