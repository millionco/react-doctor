import { detectAiTrainingEnvironment, highlighter } from "@react-doctor/core";
import { METRIC } from "./constants.js";
import { recordCount } from "./record-metric.js";

let didWarnAiTraining = false;

export const warnIfAiTrainingEnvironment = (): void => {
  if (didWarnAiTraining) return;
  const detected = detectAiTrainingEnvironment();
  if (detected === null) return;
  didWarnAiTraining = true;
  // Written straight to stderr (not via `cliLogger`/`Console`) so the license
  // notice survives `--json` mode, which no-ops the global console, and never
  // lands on stdout where it would corrupt the JSON report.
  process.stderr.write(
    `${highlighter.warn(
      "react-doctor detected use in an AI or ML pipeline. This use requires written permission under the react-doctor license — contact founders@million.dev to request access.",
    )}\n`,
  );
  recordCount(METRIC.aiTrainingWarningShown, 1, { environment: detected });
};
