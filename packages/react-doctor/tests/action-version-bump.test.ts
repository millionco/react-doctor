import { describe, expect, it } from "vite-plus/test";
import {
  ACTION_RELEASE_FILES,
  classifyBumpLevel,
} from "../../../scripts/recommend-action-version-bump.mjs";

describe("action version bump helpers", () => {
  it("tracks every script invoked by the composite action", () => {
    expect(ACTION_RELEASE_FILES).toEqual([
      "action.yml",
      "scripts/ensure-json-report.mjs",
      "scripts/normalize-changed-files.mjs",
      "scripts/render-github-action-comment.mjs",
      "scripts/resolve-package-spec.mjs",
    ]);
  });

  it("classifies conventional commits into action bump levels", () => {
    expect(classifyBumpLevel("fix(action): normalize changed files")).toBe("patch");
    expect(classifyBumpLevel("feat(action): add review comments")).toBe("minor");
    expect(classifyBumpLevel("feat(action)!: change output contract")).toBe("major");
    expect(classifyBumpLevel("refactor(action): change shell\n\nBREAKING CHANGE: new input")).toBe(
      "major",
    );
  });
});
