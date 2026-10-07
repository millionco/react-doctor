import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { analyzeOxlintTimings } from "../../../scripts/performance/analyze-oxlint-timings.ts";
import { parseOxlintTimingOutput } from "../../../scripts/performance/parse-oxlint-timing-output.ts";
import { parseRulePerformanceTimings } from "../../../scripts/performance/parse-rule-performance-timings.ts";

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-rule-timings-test-"));
  temporaryDirectories.push(directory);
  return directory;
};

const buildTimingOutput = (firstTime: number, secondTime: number): string => `
Finished in 42ms on 1 file with 2 rules using 1 thread.

Rule timings:
Rule                                      Time (ms)  Relative  Calls  Source
---------------------------------------  ----------  --------  -----  ------
react-doctor/no-effect-chain                  ${firstTime.toFixed(3)}     60.0%     30  js
react-doctor/effect-needs-cleanup              ${secondTime.toFixed(3)}     40.0%     20  js
`;

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("Oxlint timing analysis", () => {
  it("parses native rule timing tables", () => {
    expect(parseOxlintTimingOutput(buildTimingOutput(6, 4))).toEqual([
      {
        rule: "react-doctor/no-effect-chain",
        timeMilliseconds: 6,
        relativePercent: 60,
        calls: 30,
        source: "js",
      },
      {
        rule: "react-doctor/effect-needs-cleanup",
        timeMilliseconds: 4,
        relativePercent: 40,
        calls: 20,
        source: "js",
      },
    ]);
  });

  it("parses JavaScript rule visitor timings", () => {
    expect(
      parseRulePerformanceTimings(
        JSON.stringify([
          {
            rule: "no-large-context-value",
            selector: "JSXElement",
            timeNanoseconds: "2500000",
            calls: 5,
          },
        ]),
      ),
    ).toEqual([
      {
        rule: "react-doctor/no-large-context-value:JSXElement",
        timeMilliseconds: 2.5,
        relativePercent: 0,
        calls: 5,
        source: "javascript",
      },
    ]);
  });

  it("aggregates timings across Oxlint processes", () => {
    const directory = createTemporaryDirectory();
    fs.writeFileSync(path.join(directory, "oxlint-1.timings.txt"), buildTimingOutput(6, 4));
    fs.writeFileSync(path.join(directory, "oxlint-2.timings.txt"), buildTimingOutput(3, 2));

    const analysis = analyzeOxlintTimings(directory);

    expect(analysis.processes).toHaveLength(2);
    expect(analysis.totalTimeMilliseconds).toBe(15);
    expect(analysis.aggregateRules[0]).toMatchObject({
      rule: "react-doctor/no-effect-chain",
      timeMilliseconds: 9,
      relativePercent: 60,
      calls: 60,
      source: "js",
    });
  });
});
