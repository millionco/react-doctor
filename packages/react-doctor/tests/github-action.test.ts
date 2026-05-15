import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ACTION_YAML_PATH = path.join(REPOSITORY_ROOT, "action.yml");

const readActionYaml = (): string => fs.readFileSync(ACTION_YAML_PATH, "utf8");

describe("GitHub Action contract", () => {
  it("issue #190: score collection cannot fail the job on Needs work scores", () => {
    const actionYaml = readActionYaml();

    expect(actionYaml).toContain('SCORE_ARGS=("$INPUT_DIRECTORY" "--score" "--fail-on" "none")');
    expect(actionYaml).toContain('SCORE=$(npx -y react-doctor@latest "${SCORE_ARGS[@]}"');
    expect(actionYaml).toContain(") || true");
  });

  it("issue #188 + #61: action exposes CI inputs used by the scan step", () => {
    const actionYaml = readActionYaml();

    expect(actionYaml).toContain("github-token:");
    expect(actionYaml).toContain("fail-on:");
    expect(actionYaml).toContain("diff:");
    expect(actionYaml).toContain('FLAGS=("--fail-on" "$INPUT_FAIL_ON")');
    expect(actionYaml).toContain(
      'if [ -n "$INPUT_DIFF" ]; then FLAGS+=("--diff" "$INPUT_DIFF"); fi',
    );
    expect(actionYaml).toContain('if [ -n "$INPUT_GITHUB_TOKEN" ]; then');
  });

  it("guards diff fetch refs against shell-option injection", () => {
    const actionYaml = readActionYaml();

    expect(actionYaml).toContain('case "$DIFF_BASE" in -* )');
    expect(actionYaml).toContain('case "$HEAD_REF" in -* )');
    expect(actionYaml).toContain('git fetch origin "$DIFF_BASE"');
  });
});
