import { describe, expect, it } from "vite-plus/test";
import { formatReactDoctorError, isReactDoctorError } from "@react-doctor/core";
import { parseOxlintOutput } from "../src/runners/oxlint/parse-output.js";
import { buildProject, TEST_ROOT_DIRECTORY } from "./helpers/oxlint-parse-harness.js";

const TOKEN = `ghp_${"a".repeat(36)}`;

const parseFailureMessage = (stdout: string): string => {
  try {
    parseOxlintOutput(stdout, buildProject(), TEST_ROOT_DIRECTORY);
  } catch (error) {
    if (isReactDoctorError(error)) return formatReactDoctorError(error);
    throw error;
  }
  throw new Error("Expected parseOxlintOutput to fail");
};

describe("parseOxlintOutput redaction", () => {
  it("redacts sensitive text from unparseable-output previews", () => {
    const message = parseFailureMessage(`not json /Users/jane/project ${TOKEN}`);

    expect(message).toContain("~/project");
    expect(message).not.toContain("/Users/jane");
    expect(message).not.toContain(TOKEN);
  });

  it("redacts related-location labels", () => {
    const stdout = JSON.stringify({
      diagnostics: [
        {
          message: "Primary message",
          code: "react(no-danger)",
          severity: "error",
          causes: [],
          url: "",
          help: "",
          filename: "src/components/widget.tsx",
          labels: [
            { label: "", span: { offset: 0, length: 1, line: 12, column: 3 } },
            {
              label: `related /Users/jane/project ${TOKEN}`,
              span: { offset: 2, length: 3, line: 13, column: 5 },
            },
          ],
          related: [],
        },
      ],
      number_of_files: 1,
      number_of_rules: 1,
    });

    const [diagnostic] = parseOxlintOutput(stdout, buildProject(), TEST_ROOT_DIRECTORY);

    expect(diagnostic.relatedLocations?.[0]?.message).toContain("~/project");
    expect(diagnostic.relatedLocations?.[0]?.message).not.toContain("/Users/jane");
    expect(diagnostic.relatedLocations?.[0]?.message).not.toContain(TOKEN);
  });
});
