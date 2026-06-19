import { describe, expect, it } from "vite-plus/test";
import { countDroppedLintFiles } from "../src/cli/utils/count-dropped-lint-files.js";

const REACT_HOOKS_DROP_NOTE =
  "React Compiler rules (react-hooks-js/*) skipped — incompatible oxlint version detected";

describe("countDroppedLintFiles", () => {
  it("returns 0 for an empty partial-failure list", () => {
    expect(countDroppedLintFiles([])).toBe(0);
  });

  it("sums the leading file count from a realistic dropped-files message", () => {
    const droppedMessage =
      "3 file(s) failed to lint and were skipped (a.ts, b.ts, c.ts) — first failure: oxlint batch exceeded the 60s budget";
    expect(countDroppedLintFiles([droppedMessage])).toBe(3);
  });

  it("ignores a non-matching partial-failure string", () => {
    expect(countDroppedLintFiles([REACT_HOOKS_DROP_NOTE])).toBe(0);
  });

  it("sums file counts across multiple matching messages", () => {
    const droppedMessages = [
      "2 file(s) failed to lint and were skipped (x.ts, y.ts)",
      "5 file(s) failed to lint and were skipped (...)",
    ];
    expect(countDroppedLintFiles(droppedMessages)).toBe(7);
  });

  it("counts only matching messages when matching and non-matching are mixed", () => {
    const partialFailures = [
      "4 file(s) failed to lint and were skipped (one.ts, two.ts, +2 more)",
      REACT_HOOKS_DROP_NOTE,
      "1 file(s) failed to lint and were skipped (solo.ts)",
    ];
    expect(countDroppedLintFiles(partialFailures)).toBe(5);
  });
});
