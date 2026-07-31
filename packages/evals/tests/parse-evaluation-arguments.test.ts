import { describe, expect, it } from "vite-plus/test";

import { parseEvaluationArguments } from "../src/parse-evaluation-arguments.js";

describe("parseEvaluationArguments", () => {
  it("defaults to the 2,000-repository bounded Daytona profile", () => {
    expect(parseEvaluationArguments([])).toEqual({
      repositoriesSources: ["./repositories.json"],
      repositoryLimit: 2_000,
      concurrency: 200,
      repositoriesPerSandbox: 10,
      projectRootsPerRepository: 1,
      maxDurationMinutes: 45,
      reactDoctorRepository: "https://github.com/millionco/react-doctor.git",
      reactDoctorRef: "main",
      ruleKeys: [],
    });
  });

  it("accepts a local corpus and custom concurrency", () => {
    expect(
      parseEvaluationArguments([
        "--repositories",
        "repositories.json",
        "--repositories",
        "repositories.txt",
        "--concurrency",
        "25",
        "--repository-limit",
        "500",
        "--repositories-per-sandbox",
        "5",
        "--project-roots-per-repository",
        "3",
        "--max-duration-minutes",
        "20",
        "--react-doctor-ref",
        "feature/eval",
        "--rule",
        "react-doctor/no-derived-useState",
        "--rule",
        "react-doctor/no-derived-useState",
        "--rule",
        "react-doctor/prefer-useReducer",
      ]),
    ).toMatchObject({
      repositoriesSources: ["repositories.json", "repositories.txt"],
      repositoryLimit: 500,
      concurrency: 25,
      repositoriesPerSandbox: 5,
      projectRootsPerRepository: 3,
      maxDurationMinutes: 20,
      reactDoctorRef: "feature/eval",
      ruleKeys: ["react-doctor/no-derived-useState", "react-doctor/prefer-useReducer"],
    });
  });

  it("rejects invalid concurrency", () => {
    expect(() => parseEvaluationArguments(["--concurrency", "0"])).toThrow("positive integer");
  });

  it("rejects malformed rule keys", () => {
    expect(() => parseEvaluationArguments(["--rule", "react-doctor/no-example;false"])).toThrow(
      "canonical plugin/rule key",
    );
  });

  it("accepts an isolated paired baseline with independent rules and execution policy", () => {
    expect(
      parseEvaluationArguments([
        "--react-doctor-repository",
        "https://github.com/example/treatment.git",
        "--react-doctor-ref",
        "c".repeat(40),
        "--rule",
        "react-doctor/treatment-rule",
        "--paired-baseline-output",
        "/tmp/baseline.ndjson",
        "--paired-base-react-doctor-repository",
        "https://github.com/example/base.git",
        "--paired-base-react-doctor-ref",
        "b".repeat(40),
        "--paired-base-rule",
        "react-doctor/base-rule",
        "--paired-base-rule",
        "react-doctor/base-rule",
        "--paired-execution",
        "sequential",
      ]),
    ).toMatchObject({
      concurrency: 50,
      reactDoctorRepository: "https://github.com/example/treatment.git",
      reactDoctorRef: "c".repeat(40),
      ruleKeys: ["react-doctor/treatment-rule"],
      paired: {
        baselineOutputPath: "/tmp/baseline.ndjson",
        baseReactDoctorRepository: "https://github.com/example/base.git",
        baseReactDoctorRef: "b".repeat(40),
        baseRuleKeys: ["react-doctor/base-rule"],
        execution: "sequential",
      },
    });
  });

  it("requires paired output and base ref together", () => {
    expect(() =>
      parseEvaluationArguments(["--paired-base-react-doctor-ref", "b".repeat(40)]),
    ).toThrow("requires --paired-baseline-output and --paired-base-react-doctor-ref");
    expect(() =>
      parseEvaluationArguments(["--paired-baseline-output", "/tmp/baseline.ndjson"]),
    ).toThrow("requires --paired-baseline-output and --paired-base-react-doctor-ref");
  });

  it("rejects unsafe paired output, execution, and rule arguments", () => {
    expect(() =>
      parseEvaluationArguments([
        "--paired-baseline-output",
        "baseline.ndjson",
        "--paired-base-react-doctor-ref",
        "b".repeat(40),
      ]),
    ).toThrow("absolute path");
    expect(() =>
      parseEvaluationArguments([
        "--paired-baseline-output",
        "/tmp/baseline.ndjson",
        "--paired-base-react-doctor-ref",
        "b".repeat(40),
        "--paired-execution",
        "sometimes",
      ]),
    ).toThrow("auto, parallel, or sequential");
    expect(() =>
      parseEvaluationArguments([
        "--paired-baseline-output",
        "/tmp/baseline.ndjson",
        "--paired-base-react-doctor-ref",
        "b".repeat(40),
        "--paired-base-rule",
        "react-doctor/rule;false",
      ]),
    ).toThrow("canonical plugin/rule key");
  });

  it("rejects invalid scale and duration controls", () => {
    expect(() => parseEvaluationArguments(["--repository-limit", "0"])).toThrow("positive integer");
    expect(() => parseEvaluationArguments(["--repositories-per-sandbox", "0"])).toThrow(
      "positive integer",
    );
    expect(() => parseEvaluationArguments(["--project-roots-per-repository", "0"])).toThrow(
      "positive integer",
    );
    expect(() => parseEvaluationArguments(["--max-duration-minutes", "17"])).toThrow(
      "cleanup and retry reserve",
    );
  });
});
