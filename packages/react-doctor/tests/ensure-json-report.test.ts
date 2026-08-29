import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ENSURE_REPORT_SCRIPT_PATH = path.join(REPOSITORY_ROOT, "scripts/ensure-json-report.mjs");
const tempDirectories: string[] = [];

const runEnsureJsonReport = (contents?: string) => {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-report-"));
  const reportPath = path.join(tempDirectory, "report.json");
  tempDirectories.push(tempDirectory);

  if (contents !== undefined) {
    fs.writeFileSync(reportPath, contents);
  }

  const result = spawnSync(process.execPath, [ENSURE_REPORT_SCRIPT_PATH, reportPath, "7"], {
    encoding: "utf8",
  });

  return {
    report: JSON.parse(fs.readFileSync(reportPath, "utf8")),
    status: result.status,
  };
};

describe("ensure-json-report", () => {
  afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([1, 2, 3])("accepts schema version %s reports", (schemaVersion) => {
    const contents = JSON.stringify({ schemaVersion, ok: true });
    const { report, status } = runEnsureJsonReport(contents);

    expect(status).toBe(0);
    expect(report).toEqual({ schemaVersion, ok: true });
  });

  it.each([
    {
      contents: "",
      message: "react-doctor exited with status 7 but produced an empty report.",
    },
    {
      contents: "{",
      message: "react-doctor produced output that is not valid JSON.",
    },
    {
      contents: "null",
      message: "react-doctor produced JSON that is not a report object.",
    },
    {
      contents: "{}",
      message:
        "react-doctor produced a JSON report without a schemaVersion. The installed CLI may be incompatible with this GitHub Action version.",
    },
    {
      contents: '{"schemaVersion":999,"ok":true}',
      message:
        "react-doctor produced schema version 999, but this GitHub Action supports 1, 2, 3. Update millionco/react-doctor@v2 or pin the CLI version to match the Action release.",
    },
    {
      contents: '{"schemaVersion":3}',
      message: "react-doctor produced a schema version 3 report without the required ok field.",
    },
  ])("writes a valid fallback report for malformed output", ({ contents, message }) => {
    const { report, status } = runEnsureJsonReport(contents);

    expect(status).toBe(1);
    expect(report).toMatchObject({
      schemaVersion: 3,
      ok: false,
      error: {
        name: "ReactDoctorActionError",
        message,
      },
    });
  });

  it("reports when the CLI did not create a readable report", () => {
    const { report, status } = runEnsureJsonReport();

    expect(status).toBe(1);
    expect(report.error.message).toBe(
      "react-doctor exited with status 7 without producing a readable JSON report.",
    );
  });
});
