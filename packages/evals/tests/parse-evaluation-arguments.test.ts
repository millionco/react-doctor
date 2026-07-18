import { describe, expect, it } from "vite-plus/test";

import { parseEvaluationArguments } from "../src/parse-evaluation-arguments.js";

describe("parseEvaluationArguments", () => {
  it("defaults to the full corpus at 500 concurrent repositories", () => {
    expect(parseEvaluationArguments([])).toEqual({
      repositoriesSource: "../../../react-doctor-evals/repos.json",
      concurrency: 500,
      reactDoctorRepository: "https://github.com/millionco/react-doctor.git",
      reactDoctorRef: "main",
    });
  });

  it("accepts a local corpus and custom concurrency", () => {
    expect(
      parseEvaluationArguments([
        "--repositories",
        "repositories.json",
        "--concurrency",
        "25",
        "--react-doctor-ref",
        "feature/eval",
      ]),
    ).toMatchObject({
      repositoriesSource: "repositories.json",
      concurrency: 25,
      reactDoctorRef: "feature/eval",
    });
  });

  it("rejects invalid concurrency", () => {
    expect(() => parseEvaluationArguments(["--concurrency", "0"])).toThrow("positive integer");
  });
});
