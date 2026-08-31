import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const collectScoreEvidenceMock = vi.hoisted(() => vi.fn(() => []));

vi.mock("../src/cli/utils/collect-score-evidence.js", () => ({
  collectScoreEvidence: collectScoreEvidenceMock,
}));

vi.mock("../src/cli/utils/with-run-span.js", () => ({
  recordSentryProjectContext: vi.fn(),
  resetSentryRunState: vi.fn(),
  withRunSpan: <Result>(run: (rootSpan: object) => Promise<Result>): Promise<Result> => run({}),
}));

vi.mock("../src/cli/utils/apply-observability.js", () => ({
  applyObservability: <Program>(program: Program): Program => program,
}));

vi.mock("../src/cli/utils/build-run-event.js", () => ({
  recordRunEvent: vi.fn(),
}));

import { inspect } from "../src/inspect.js";

const BASIC_REACT_DIRECTORY = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "core",
  "tests",
  "fixtures",
  "basic-react",
);

describe("score evidence opt-out", () => {
  beforeEach(() => {
    collectScoreEvidenceMock.mockClear();
  });

  it("does not collect evidence when scoring is disabled and telemetry has a root span", async () => {
    await inspect(BASIC_REACT_DIRECTORY, {
      deadCode: false,
      lint: false,
      noScore: true,
      silent: true,
    });

    expect(collectScoreEvidenceMock).not.toHaveBeenCalled();
  });
});
