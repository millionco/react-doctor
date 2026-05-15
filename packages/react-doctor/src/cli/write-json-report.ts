import type { JsonReport } from "@react-doctor/types";
import { cliState } from "./cli-state.js";

export const writeJsonReport = (report: JsonReport): void => {
  const serialized = cliState.isCompactJsonOutput
    ? JSON.stringify(report)
    : JSON.stringify(report, null, 2);
  process.stdout.write(`${serialized}\n`);
};
