import * as Effect from "effect/Effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ScoreResult } from "@react-doctor/core";
import { silenceConsoleForTest } from "./helpers/silence-console.js";

vi.mock("../src/cli/utils/is-spinner-interactive.js", () => ({
  isSpinnerInteractive: () => true,
}));

import { printScoreHeader } from "../src/cli/utils/render-score-header.js";
import { setSpinnerSilent } from "../src/cli/utils/spinner.js";

const scoreResult: ScoreResult = {
  score: 88,
  label: "Great",
};

describe("printScoreHeader", () => {
  let restoreConsole: () => void;
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    restoreConsole = silenceConsoleForTest();
    setSpinnerSilent(false);
    stdoutWriteSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
    setSpinnerSilent(false);
    restoreConsole();
  });

  it("does not write raw animation frames while spinner output is silent", async () => {
    setSpinnerSilent(true);

    await Effect.runPromise(printScoreHeader(scoreResult));

    expect(stdoutWriteSpy).not.toHaveBeenCalled();
  });
});
