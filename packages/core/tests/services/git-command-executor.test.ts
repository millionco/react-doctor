import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as NodeChildProcessSpawner from "@effect/platform-node-shared/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import * as NodePath from "@effect/platform-node-shared/NodePath";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import { afterAll, describe, expect, it } from "vite-plus/test";
import {
  type GitCommandInput,
  makeGitCommandExecutor,
} from "../../src/services/git-command-executor.js";

const temporaryDirectory = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-git-command-")),
);
const fileAsDirectory = path.join(temporaryDirectory, "not-a-directory");
fs.writeFileSync(fileAsDirectory, "file");

afterAll(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

const childProcessLayer = NodeChildProcessSpawner.layer.pipe(
  Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
);

const executeCommand = (input: GitCommandInput) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner;
    return yield* makeGitCommandExecutor(spawner)(input);
  });

const runCommand = (input: GitCommandInput) =>
  Effect.runPromise(executeCommand(input).pipe(Effect.provide(childProcessLayer)));

describe("makeGitCommandExecutor", () => {
  it("preserves argv order, cwd, environment inheritance, stderr, and exit status", async () => {
    const result = await runCommand({
      command: process.execPath,
      args: [
        "-e",
        [
          "process.stdout.write(JSON.stringify({",
          "argv: process.argv.slice(1),",
          "cwd: process.cwd(),",
          "explicitEnv: process.env.REACT_DOCTOR_GIT_BOUNDARY,",
          "hasInheritedPath: typeof process.env.PATH === 'string'",
          "}));",
          "process.stderr.write('stderr-value');",
          "process.exitCode = 7;",
        ].join(""),
        "first argument",
        "--second",
      ],
      directory: temporaryDirectory,
      env: { REACT_DOCTOR_GIT_BOUNDARY: "exact" },
    });

    expect(result).toEqual({
      status: 7,
      stdout: JSON.stringify({
        argv: ["first argument", "--second"],
        cwd: temporaryDirectory,
        explicitEnv: "exact",
        hasInheritedPath: true,
      }),
      stderr: "stderr-value",
    });
  });

  it("enforces maxStdoutBytes against raw UTF-8 bytes", async () => {
    const error = await Effect.runPromise(
      executeCommand({
        command: process.execPath,
        args: ["-e", "process.stdout.write('éé')"],
        directory: temporaryDirectory,
        maxStdoutBytes: 3,
      }).pipe(Effect.provide(childProcessLayer), Effect.flip),
    );

    expect(error.reason._tag).toBe("GitInvocationFailed");
    if (error.reason._tag !== "GitInvocationFailed") {
      throw new Error(`Expected GitInvocationFailed, received ${error.reason._tag}`);
    }
    expect(error.reason.args).toEqual(["-e", "process.stdout.write('éé')"]);
    expect(error.reason.directory).toBe(temporaryDirectory);
    expect(error.message).toContain("git stdout exceeded 3 bytes");
  });

  it("maps a non-Git preflight failure to status 127", async () => {
    const result = await runCommand({
      command: "gh",
      args: ["api", "graphql"],
      directory: fileAsDirectory,
    });

    expect(result.status).toBe(127);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("spawn ENOTDIR");
    expect(result.stderr).toContain(fileAsDirectory);
  });

  it("maps a Git preflight failure to GitInvocationFailed", async () => {
    const error = await Effect.runPromise(
      executeCommand({
        command: "git",
        args: ["rev-parse", "HEAD"],
        directory: fileAsDirectory,
      }).pipe(Effect.provide(childProcessLayer), Effect.flip),
    );

    expect(error.reason._tag).toBe("GitInvocationFailed");
    if (error.reason._tag !== "GitInvocationFailed") {
      throw new Error(`Expected GitInvocationFailed, received ${error.reason._tag}`);
    }
    expect(error.reason.args).toEqual(["rev-parse", "HEAD"]);
    expect(error.reason.directory).toBe(fileAsDirectory);
    expect(error.message).toContain("spawn ENOTDIR");
  });
});
