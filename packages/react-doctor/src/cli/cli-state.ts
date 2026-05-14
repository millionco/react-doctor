import type { JsonReportMode } from "../types.js";

interface CliState {
  isJsonModeActive: boolean;
  isCompactJsonOutput: boolean;
  resolvedDirectoryForCancel: string | null;
  cancelStartTime: number;
  currentReportMode: JsonReportMode;
}

export const cliState: CliState = {
  isJsonModeActive: false,
  isCompactJsonOutput: false,
  resolvedDirectoryForCancel: null,
  cancelStartTime: 0,
  currentReportMode: "full",
};
