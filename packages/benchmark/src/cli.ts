import * as fs from "node:fs";
import * as path from "node:path";
import { runSlopVerifier } from "./run-slop-verifier.js";
import type { SlopReport } from "./types/index.js";
import { parseCliArgs } from "./utils/parse-cli-args.js";

const USAGE = `slop-verify — score the React/TypeScript slop in a graded diff

Usage:
  slop-verify --root <dir> --base <ref> [options]

Options:
  --root <dir>            Project the agent edited (default: cwd)
  --base <ref>            Git ref the agent started from (default: HEAD)
  --doctor-bin <path>     React Doctor CLI to invoke (default: react-doctor on PATH)
  --profile <path>        Scoring-profile JSON (default: built-in profile)
  --functional-pass <b>   Functional gate outcome: true|false (default: unknown)
  --out <path>            Write the full JSON SlopReport here
  --json                  Print the JSON SlopReport to stdout (instead of a summary)
  --fail-under <score>    Exit non-zero if slopScore < <score> (default: never)
  --quiet                 Suppress the human-readable summary`;

const asBoolean = (value: string | boolean | undefined): boolean | null => {
  if (value === undefined) return null;
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  return null;
};

const asString = (value: string | boolean | undefined): string | undefined =>
  typeof value === "string" ? value : undefined;

const renderSummary = (report: SlopReport): string => {
  const lines = [
    `SlopBench score: ${report.slopScore.toFixed(1)} / 100 (scoring ${report.scoringVersion})`,
    `Changed files: ${report.diffStats.changedFileCount}  Added lines: ${report.diffStats.addedLineCount}  Violations: ${report.violations.length}`,
    "Dimensions:",
    ...report.dimensions.map(
      (dimension) =>
        `  ${dimension.dimension.padEnd(20)} ${dimension.score.toFixed(1).padStart(6)}  (${dimension.violationCount} findings)`,
    ),
  ];
  if (report.functionalPass !== null) {
    lines.push(`Functional gate: ${report.functionalPass ? "PASS" : "FAIL"}  Reward: ${report.reward?.toFixed(3)}`);
  }
  for (const error of report.scannerErrors) lines.push(`! scanner issue: ${error}`);
  return lines.join("\n");
};

// CLI entry. Runs the verifier and reports; only exits non-zero when an
// explicit `--fail-under` gate is set and missed, so a normal grading run
// always succeeds and lets `test.sh` own the reward.
export const runCli = (argv: string[]): void => {
  const args = parseCliArgs(argv);
  if (args.help || args.h) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  const report = runSlopVerifier({
    rootDirectory: path.resolve(asString(args.root) ?? process.cwd()),
    baseRef: asString(args.base) ?? "HEAD",
    reactDoctorBin: asString(args["doctor-bin"]),
    profilePath: asString(args.profile),
    functionalPass: asBoolean(args["functional-pass"]),
  });

  const outPath = asString(args.out);
  if (outPath) {
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } else if (!args.quiet) {
    process.stdout.write(`${renderSummary(report)}\n`);
  }

  const failUnder = asString(args["fail-under"]);
  if (failUnder !== undefined && report.slopScore < Number.parseFloat(failUnder)) {
    process.exitCode = 1;
  }
};
