import { describe, expect, it } from "vite-plus/test";

import { EVALUATION_CONFIG_CONTRACT } from "../src/constants.js";
import { parseReactDoctorEvaluationProvenance } from "../src/utils/parse-react-doctor-evaluation-provenance.js";

const buildProvenance = () => ({
  reactDoctorRepository: "https://github.com/millionco/react-doctor.git",
  reactDoctorCommit: "a".repeat(40),
  configContract: EVALUATION_CONFIG_CONTRACT,
  ruleSetHash: "b".repeat(64),
  ruleKeys: ["react-doctor/no-derived-useState"],
});

describe("parseReactDoctorEvaluationProvenance", () => {
  it("accepts an exact pinned producer record", () => {
    const provenance = buildProvenance();

    expect(parseReactDoctorEvaluationProvenance(JSON.stringify(provenance))).toEqual(provenance);
  });

  it("rejects unpinned commits and unknown config contracts", () => {
    expect(() =>
      parseReactDoctorEvaluationProvenance(
        JSON.stringify({ ...buildProvenance(), reactDoctorCommit: "main" }),
      ),
    ).toThrow("Invalid React Doctor evaluation provenance");
    expect(() =>
      parseReactDoctorEvaluationProvenance(
        JSON.stringify({ ...buildProvenance(), configContract: "unknown" }),
      ),
    ).toThrow("Invalid React Doctor evaluation provenance");
  });
});
