import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  BASE_TARGET_WORK_DIRECTORY,
  SETUP_PAIRED_TARGET_REPOSITORY_COMMAND,
  TARGET_REPOSITORY_DIRECTORY,
  TREATMENT_TARGET_WORK_DIRECTORY,
} from "../src/constants.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const temporaryDirectory of temporaryDirectories.splice(0)) {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

describe("SETUP_PAIRED_TARGET_REPOSITORY_COMMAND", () => {
  it("shares fetched objects while isolating base and treatment worktrees", () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-pair-"));
    temporaryDirectories.push(temporaryDirectory);
    const sourceDirectory = path.join(temporaryDirectory, "source");
    const targetRepositoryDirectory = path.join(temporaryDirectory, "target-repository.git");
    const baseWorkDirectory = path.join(temporaryDirectory, "target-base");
    const treatmentWorkDirectory = path.join(temporaryDirectory, "target-treatment");
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
    const command = SETUP_PAIRED_TARGET_REPOSITORY_COMMAND.replaceAll(
      TARGET_REPOSITORY_DIRECTORY,
      targetRepositoryDirectory,
    )
      .replaceAll(BASE_TARGET_WORK_DIRECTORY, baseWorkDirectory)
      .replaceAll(TREATMENT_TARGET_WORK_DIRECTORY, treatmentWorkDirectory);

    execFileSync("sh", ["-c", command], {
      env: {
        ...process.env,
        TARGET_REPOSITORY: sourceDirectory,
        TARGET_REF: targetRef,
      },
    });

    expect(
      execFileSync("git", ["-C", baseWorkDirectory, "rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
    ).toBe(targetRef);
    expect(
      execFileSync("git", ["-C", treatmentWorkDirectory, "rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
    ).toBe(targetRef);
    const baseCommonDirectory = execFileSync(
      "git",
      ["-C", baseWorkDirectory, "rev-parse", "--git-common-dir"],
      { encoding: "utf8" },
    ).trim();
    const treatmentCommonDirectory = execFileSync(
      "git",
      ["-C", treatmentWorkDirectory, "rev-parse", "--git-common-dir"],
      { encoding: "utf8" },
    ).trim();
    const resolvedBaseCommonDirectory = path.resolve(baseWorkDirectory, baseCommonDirectory);
    const resolvedTreatmentCommonDirectory = path.resolve(
      treatmentWorkDirectory,
      treatmentCommonDirectory,
    );
    const commonDirectorySentinelName = "shared-common-directory-sentinel";
    const commonDirectorySentinelContents = "shared\n";
    fs.writeFileSync(
      path.join(targetRepositoryDirectory, commonDirectorySentinelName),
      commonDirectorySentinelContents,
    );
    expect(
      fs.readFileSync(path.join(resolvedBaseCommonDirectory, commonDirectorySentinelName), "utf8"),
    ).toBe(commonDirectorySentinelContents);
    expect(
      fs.readFileSync(
        path.join(resolvedTreatmentCommonDirectory, commonDirectorySentinelName),
        "utf8",
      ),
    ).toBe(commonDirectorySentinelContents);
    expect(
      execFileSync(
        "git",
        ["--git-dir", resolvedBaseCommonDirectory, "rev-parse", "--is-bare-repository"],
        { encoding: "utf8" },
      ).trim(),
    ).toBe("true");

    fs.writeFileSync(path.join(baseWorkDirectory, "doctor.config.ts"), "base\n");
    fs.writeFileSync(path.join(treatmentWorkDirectory, "doctor.config.ts"), "treatment\n");
    expect(fs.readFileSync(path.join(baseWorkDirectory, "doctor.config.ts"), "utf8")).toBe(
      "base\n",
    );
    expect(fs.readFileSync(path.join(treatmentWorkDirectory, "doctor.config.ts"), "utf8")).toBe(
      "treatment\n",
    );
  });
});
