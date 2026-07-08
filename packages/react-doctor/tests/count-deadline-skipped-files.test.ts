import { describe, expect, it } from "vite-plus/test";
import { countDeadlineSkippedFiles } from "../src/cli/utils/count-deadline-skipped-files.js";

const DROPPED_FILES_MESSAGE =
  "3 file(s) failed to lint and were skipped (a.ts, b.ts, c.ts) — first failure: oxlint batch exceeded the 60s budget";

describe("countDeadlineSkippedFiles", () => {
  it("returns 0 for an empty partial-failure list", () => {
    expect(countDeadlineSkippedFiles([])).toBe(0);
  });

  it("sums the leading file count from a realistic deadline-skip message", () => {
    const deadlineMessage =
      "12 file(s) skipped — max scan duration reached before they were linted (a.tsx, b.tsx, +10 more)";
    expect(countDeadlineSkippedFiles([deadlineMessage])).toBe(12);
  });

  it("ignores dropped-files and other non-matching partial-failure strings", () => {
    expect(countDeadlineSkippedFiles([DROPPED_FILES_MESSAGE])).toBe(0);
  });

  it("counts only deadline-skip messages when mixed with other failures", () => {
    const partialFailures = [
      DROPPED_FILES_MESSAGE,
      "4 file(s) skipped — max scan duration reached before they were linted (one.tsx, +3 more)",
    ];
    expect(countDeadlineSkippedFiles(partialFailures)).toBe(4);
  });
});
