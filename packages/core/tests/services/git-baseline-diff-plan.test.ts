import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Effect from "effect/Effect";
import { Git } from "@react-doctor/core";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

const runGit = (directory: string, args: ReadonlyArray<string>): string =>
  execFileSync("git", args, { cwd: directory, encoding: "utf-8" }).trim();

const writeFile = (directory: string, filePath: string, content: string): void => {
  const absolutePath = path.join(directory, filePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
};

const commitAll = (directory: string, message: string): string => {
  runGit(directory, ["add", "-A"]);
  runGit(directory, ["commit", "-m", message]);
  return runGit(directory, ["rev-parse", "HEAD"]);
};

const readPlan = (directory: string, ref: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const git = yield* Git;
      return yield* git.baselineDiffPlan({ directory, ref });
    }).pipe(Effect.provide(Git.layerNode)),
  );

describe("Git.baselineDiffPlan", () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-baseline-plan-"));
    runGit(directory, ["init", "--quiet"]);
    runGit(directory, ["config", "user.email", "react-doctor@example.com"]);
    runGit(directory, ["config", "user.name", "React Doctor"]);
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("represents a rename as a base deletion and head addition", async () => {
    writeFile(directory, "src/old-name.tsx", "export const value = 1;\n");
    const baseRef = commitAll(directory, "base");
    fs.renameSync(
      path.join(directory, "src/old-name.tsx"),
      path.join(directory, "src/new-name.tsx"),
    );
    runGit(directory, ["add", "-A"]);

    await expect(readPlan(directory, baseRef)).resolves.toEqual({
      baseFiles: ["src/old-name.tsx"],
      headFiles: ["src/new-name.tsx"],
      untrackedFiles: [],
    });
  });

  it("keeps an unstaged rename destination on the head side", async () => {
    writeFile(directory, "src/old-name.tsx", "export const value = 1;\n");
    const baseRef = commitAll(directory, "base");
    fs.renameSync(
      path.join(directory, "src/old-name.tsx"),
      path.join(directory, "src/new-name.tsx"),
    );

    await expect(readPlan(directory, baseRef)).resolves.toEqual({
      baseFiles: ["src/old-name.tsx"],
      headFiles: [],
      untrackedFiles: ["src/new-name.tsx"],
    });
  });

  it("keeps a copied file head-only", async () => {
    writeFile(directory, "src/original.tsx", "export const value = 1;\n");
    const baseRef = commitAll(directory, "base");
    fs.copyFileSync(
      path.join(directory, "src/original.tsx"),
      path.join(directory, "src/copied.tsx"),
    );
    runGit(directory, ["add", "-A"]);

    await expect(readPlan(directory, baseRef)).resolves.toEqual({
      baseFiles: [],
      headFiles: ["src/copied.tsx"],
      untrackedFiles: [],
    });
  });

  it("keeps deleted files on the base side", async () => {
    writeFile(directory, "src/deleted.tsx", "export const value = 1;\n");
    const baseRef = commitAll(directory, "base");
    fs.rmSync(path.join(directory, "src/deleted.tsx"));
    runGit(directory, ["add", "-A"]);

    await expect(readPlan(directory, baseRef)).resolves.toEqual({
      baseFiles: ["src/deleted.tsx"],
      headFiles: [],
      untrackedFiles: [],
    });
  });

  it.skipIf(process.platform === "win32")(
    "preserves newline-containing paths through null-delimited parsing",
    async () => {
      const filePath = "src/line\nbreak.ts";
      writeFile(directory, filePath, "export const value = 1;\n");
      const baseRef = commitAll(directory, "base");
      writeFile(directory, filePath, "export const value = 2;\n");

      await expect(readPlan(directory, baseRef)).resolves.toEqual({
        baseFiles: [filePath],
        headFiles: [filePath],
        untrackedFiles: [],
      });
    },
  );

  it("degrades when the index contains an unresolved merge", async () => {
    writeFile(directory, "src/conflict.ts", "export const value = 'base';\n");
    const baseRef = commitAll(directory, "base");
    const mainBranch = runGit(directory, ["branch", "--show-current"]);
    runGit(directory, ["branch", "other"]);
    writeFile(directory, "src/conflict.ts", "export const value = 'main';\n");
    commitAll(directory, "main change");
    runGit(directory, ["switch", "other"]);
    writeFile(directory, "src/conflict.ts", "export const value = 'other';\n");
    commitAll(directory, "other change");
    runGit(directory, ["switch", mainBranch]);
    expect(() => runGit(directory, ["merge", "other"])).toThrow();

    await expect(readPlan(directory, baseRef)).resolves.toBeNull();
  });

  it("degrades when the baseline ref is unavailable", async () => {
    await expect(readPlan(directory, "missing-ref")).resolves.toBeNull();
  });
});
