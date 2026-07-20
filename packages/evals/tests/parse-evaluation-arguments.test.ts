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
      maxDurationMinutes: 30,
      reactDoctorRepository: "https://github.com/millionco/react-doctor.git",
      reactDoctorRef: "main",
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
        "15",
        "--react-doctor-ref",
        "feature/eval",
      ]),
    ).toMatchObject({
      repositoriesSources: ["repositories.json", "repositories.txt"],
      repositoryLimit: 500,
      concurrency: 25,
      repositoriesPerSandbox: 5,
      projectRootsPerRepository: 3,
      maxDurationMinutes: 15,
      reactDoctorRef: "feature/eval",
    });
  });

  it("rejects invalid concurrency", () => {
    expect(() => parseEvaluationArguments(["--concurrency", "0"])).toThrow("positive integer");
  });

  it("rejects invalid scale and duration controls", () => {
    expect(() => parseEvaluationArguments(["--repository-limit", "0"])).toThrow("positive integer");
    expect(() => parseEvaluationArguments(["--repositories-per-sandbox", "0"])).toThrow(
      "positive integer",
    );
    expect(() => parseEvaluationArguments(["--project-roots-per-repository", "0"])).toThrow(
      "positive integer",
    );
    expect(() => parseEvaluationArguments(["--max-duration-minutes", "12"])).toThrow(
      "cleanup and retry reserve",
    );
  });
});
