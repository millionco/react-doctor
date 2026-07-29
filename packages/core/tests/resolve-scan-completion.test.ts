import { describe, expect, it } from "vite-plus/test";
import { resolveScanCompletion } from "../src/utils/resolve-scan-completion.js";

const successfulDeadCode = {
  didFail: false,
  reason: null,
};

describe("resolveScanCompletion", () => {
  it("preserves the legacy property order and successful progress text", () => {
    const completion = resolveScanCompletion({
      lintDidFail: false,
      deadCodeFailure: successfulDeadCode,
      suppressScanSummary: false,
      scannedFilesLabel: "2 files",
      scanElapsedMilliseconds: 1_250,
      workerCountSuffix: " [~4 workers]",
    });

    expect(JSON.stringify(completion)).toBe(
      '{"deadCodeFailure":{"didFail":false,"reason":null},"shouldComputeScore":true,"progress":{"action":"succeed","text":"Scanned 2 files in 1.3s [~4 workers]"}}',
    );
    expect(completion.deadCodeFailure).toBe(successfulDeadCode);
  });

  it("preserves singular labels, zero duration, and an empty worker suffix", () => {
    expect(
      resolveScanCompletion({
        lintDidFail: false,
        deadCodeFailure: successfulDeadCode,
        suppressScanSummary: false,
        scannedFilesLabel: "1 file",
        scanElapsedMilliseconds: 0,
        workerCountSuffix: "",
      }).progress,
    ).toEqual({
      action: "succeed",
      text: "Scanned 1 file in 0.0s",
    });
  });

  it("stops successful scans whose caller owns the summary", () => {
    expect(
      resolveScanCompletion({
        lintDidFail: false,
        deadCodeFailure: successfulDeadCode,
        suppressScanSummary: true,
        scannedFilesLabel: "0 files",
        scanElapsedMilliseconds: 999,
        workerCountSuffix: "",
      }),
    ).toEqual({
      deadCodeFailure: successfulDeadCode,
      shouldComputeScore: true,
      progress: { action: "stop", text: null },
    });
  });

  it("retains a deadline-derived dead-code failure and fails progress without scoring", () => {
    const deadlineFailure = {
      didFail: true,
      reason: "Dead-code analysis skipped — max scan duration reached.",
    };

    const completion = resolveScanCompletion({
      lintDidFail: false,
      deadCodeFailure: deadlineFailure,
      suppressScanSummary: true,
      scannedFilesLabel: "3 files",
      scanElapsedMilliseconds: 5_000,
      workerCountSuffix: " [~2 workers]",
    });

    expect(completion).toEqual({
      deadCodeFailure: deadlineFailure,
      shouldComputeScore: false,
      progress: {
        action: "fail",
        text: "Scanning failed (dead-code analysis, non-fatal).",
      },
    });
    expect(completion.deadCodeFailure).toBe(deadlineFailure);
  });

  it("lets lint failure override dead-code failure and leaves progress unchanged", () => {
    expect(
      resolveScanCompletion({
        lintDidFail: true,
        deadCodeFailure: {
          didFail: true,
          reason: "Dead-code worker crashed.",
        },
        suppressScanSummary: false,
        scannedFilesLabel: "9 files",
        scanElapsedMilliseconds: 750,
        workerCountSuffix: "",
      }),
    ).toEqual({
      deadCodeFailure: {
        didFail: false,
        reason: null,
      },
      shouldComputeScore: false,
      progress: {
        action: "unchanged",
        text: null,
      },
    });
  });

  it("does not normalize a non-failing dead-code state when lint succeeds", () => {
    const recordedState = {
      didFail: false,
      reason: "preserved nullable field value",
    };

    const completion = resolveScanCompletion({
      lintDidFail: false,
      deadCodeFailure: recordedState,
      suppressScanSummary: true,
      scannedFilesLabel: "4 files",
      scanElapsedMilliseconds: 1_000,
      workerCountSuffix: "",
    });

    expect(completion.deadCodeFailure).toBe(recordedState);
    expect(completion.deadCodeFailure.reason).toBe("preserved nullable field value");
  });
});
