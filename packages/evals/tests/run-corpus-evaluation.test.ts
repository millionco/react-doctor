import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { runCorpusEvaluation } from "../src/run-corpus-evaluation.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const temporaryDirectory of temporaryDirectories.splice(0)) {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

describe("runCorpusEvaluation", () => {
  it("refuses to overwrite an existing paired baseline before creating Daytona resources", async () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-pair-"));
    temporaryDirectories.push(temporaryDirectory);
    const baselineOutputPath = path.join(temporaryDirectory, "baseline.ndjson");
    fs.writeFileSync(baselineOutputPath, "immutable\n");

    await expect(
      runCorpusEvaluation({
        repositoriesSources: [path.join(temporaryDirectory, "missing-corpus.json")],
        repositoryLimit: 1,
        concurrency: 1,
        repositoriesPerSandbox: 1,
        projectRootsPerRepository: 1,
        maxDurationMinutes: 20,
        reactDoctorRepository: "https://github.com/millionco/react-doctor.git",
        reactDoctorRef: "c".repeat(40),
        ruleKeys: [],
        paired: {
          baselineOutputPath,
          baseReactDoctorRepository: "https://github.com/millionco/react-doctor.git",
          baseReactDoctorRef: "b".repeat(40),
          baseRuleKeys: [],
          execution: "auto",
        },
      }),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(fs.readFileSync(baselineOutputPath, "utf8")).toBe("immutable\n");
  });
});
