import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  MATRIX_REPORT_DIRECTORY,
  MATRIX_TARGET_REPOSITORY_DIRECTORY,
  MATRIX_TARGET_WORKTREE_DIRECTORY,
  SETUP_MATRIX_TARGET_REPOSITORY_COMMAND,
} from "../src/constants.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const temporaryDirectory of temporaryDirectories.splice(0)) {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

describe("SETUP_MATRIX_TARGET_REPOSITORY_COMMAND", () => {
  it("fetches one bare target and creates isolated worktrees for every active lane", () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-matrix-"));
    temporaryDirectories.push(temporaryDirectory);
    const sourceDirectory = path.join(temporaryDirectory, "source");
    const targetRepositoryDirectory = path.join(temporaryDirectory, "target-repository.git");
    const targetWorktreeDirectory = path.join(temporaryDirectory, "target-lanes");
    const reportDirectory = path.join(temporaryDirectory, "reports");
    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.writeFileSync(path.join(sourceDirectory, "package.json"), "{}\n");
    execFileSync("git", ["-C", sourceDirectory, "init", "-q"]);
    execFileSync("git", ["-C", sourceDirectory, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", sourceDirectory, "config", "user.name", "Test"]);
    execFileSync("git", ["-C", sourceDirectory, "add", "."]);
    execFileSync("git", ["-C", sourceDirectory, "commit", "-q", "-m", "fixture"]);
    const targetRef = execFileSync("git", ["-C", sourceDirectory, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    const command = SETUP_MATRIX_TARGET_REPOSITORY_COMMAND.replaceAll(
      MATRIX_TARGET_REPOSITORY_DIRECTORY,
      targetRepositoryDirectory,
    )
      .replaceAll(MATRIX_TARGET_WORKTREE_DIRECTORY, targetWorktreeDirectory)
      .replaceAll(MATRIX_REPORT_DIRECTORY, reportDirectory);
    const laneIds = ["matrix-base", "pr-1", "pr-2"];

    execFileSync("sh", ["-c", command], {
      env: {
        ...process.env,
        TARGET_REPOSITORY: sourceDirectory,
        TARGET_REF: targetRef,
        MATRIX_ACTIVE_LANE_IDS: JSON.stringify(laneIds),
      },
    });

    for (const laneId of laneIds) {
      const laneDirectory = path.join(targetWorktreeDirectory, laneId);
      expect(
        execFileSync("git", ["-C", laneDirectory, "rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim(),
      ).toBe(targetRef);
      fs.writeFileSync(path.join(laneDirectory, "doctor.config.ts"), `${laneId}\n`);
    }
    const commonDirectorySentinelName = "shared-common-directory-sentinel";
    const commonDirectorySentinelContents = "shared\n";
    fs.writeFileSync(
      path.join(targetRepositoryDirectory, commonDirectorySentinelName),
      commonDirectorySentinelContents,
    );
    for (const laneId of laneIds) {
      const laneDirectory = path.join(targetWorktreeDirectory, laneId);
      const commonDirectory = execFileSync(
        "git",
        ["-C", laneDirectory, "rev-parse", "--git-common-dir"],
        { encoding: "utf8" },
      ).trim();
      const resolvedCommonDirectory = path.resolve(laneDirectory, commonDirectory);
      expect(
        fs.readFileSync(path.join(resolvedCommonDirectory, commonDirectorySentinelName), "utf8"),
      ).toBe(commonDirectorySentinelContents);
      expect(
        execFileSync(
          "git",
          ["--git-dir", resolvedCommonDirectory, "rev-parse", "--is-bare-repository"],
          { encoding: "utf8" },
        ).trim(),
      ).toBe("true");
    }
    for (const laneId of laneIds) {
      expect(
        fs.readFileSync(path.join(targetWorktreeDirectory, laneId, "doctor.config.ts"), "utf8"),
      ).toBe(`${laneId}\n`);
    }
  });
});
