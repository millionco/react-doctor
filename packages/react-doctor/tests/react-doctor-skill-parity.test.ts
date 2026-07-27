import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  CANONICAL_REACT_DOCTOR_SKILL_DIRECTORY,
  findReactDoctorSkillTreeMismatches,
} from "../../../scripts/sync-react-doctor-skill.mjs";
import { resolveScope } from "../src/cli/utils/resolve-scope.js";
import { stripUnknownCliFlags } from "../src/cli/utils/strip-unknown-cli-flags.js";

const readCanonicalSkillDocuments = (): string =>
  [
    path.join(CANONICAL_REACT_DOCTOR_SKILL_DIRECTORY, "SKILL.md"),
    path.join(CANONICAL_REACT_DOCTOR_SKILL_DIRECTORY, "references", "explain.md"),
  ]
    .map((filePath) => fs.readFileSync(filePath, "utf8"))
    .join("\n");

describe("React Doctor skill source parity", () => {
  it("keeps the repository adapter identical to the canonical distributed skill", () => {
    expect(findReactDoctorSkillTreeMismatches()).toEqual([]);
  });

  it("reports changed generated files", () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-skill-parity-"));
    const canonicalDirectory = path.join(temporaryDirectory, "canonical");
    const adapterDirectory = path.join(temporaryDirectory, "adapter");
    try {
      fs.mkdirSync(canonicalDirectory);
      fs.mkdirSync(adapterDirectory);
      fs.writeFileSync(path.join(canonicalDirectory, "SKILL.md"), "canonical\n");
      fs.writeFileSync(path.join(adapterDirectory, "SKILL.md"), "stale\n");

      expect(findReactDoctorSkillTreeMismatches(canonicalDirectory, adapterDirectory)).toEqual([
        "changed adapter entry: SKILL.md",
      ]);
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("documents the supported changed-scope workflow", () => {
    const skillDocuments = readCanonicalSkillDocuments();
    expect(skillDocuments).toContain("--scope changed");
    expect(skillDocuments).not.toMatch(/npx react-doctor@latest[^\n]*--diff/);

    expect(
      stripUnknownCliFlags(["node", "react-doctor", ".", "--scope", "changed"]).slice(2),
    ).toEqual([".", "--scope", "changed"]);
    expect(resolveScope({ scope: "changed" }, null)).toEqual({
      scope: "changed",
      base: undefined,
      usedDeprecatedDiff: false,
    });
  });
});
