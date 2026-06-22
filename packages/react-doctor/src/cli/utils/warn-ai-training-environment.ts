import { detectAiTrainingEnvironment } from "@react-doctor/core";
import { cliLogger as logger } from "./cli-logger.js";
import { METRIC } from "./constants.js";
import { recordCount } from "./record-metric.js";

let didWarnAiTraining = false;

export const warnIfAiTrainingEnvironment = (): void => {
  if (didWarnAiTraining) return;
  const detected = detectAiTrainingEnvironment();
  if (detected === null) return;
  didWarnAiTraining = true;
  logger.warn(
    "react-doctor detected use in an AI or ML pipeline. This use requires written permission under the react-doctor license — contact founders@million.dev to request access.",
  );
  recordCount(METRIC.aiTrainingWarningShown, 1, { environment: detected });
};
