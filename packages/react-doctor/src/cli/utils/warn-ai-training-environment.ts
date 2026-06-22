import { cliLogger as logger } from "./cli-logger.js";
import { METRIC } from "./constants.js";
import { detectAiTrainingEnvironment } from "./detect-ai-training-environment.js";
import { recordCount } from "./record-metric.js";

export const warnIfAiTrainingEnvironment = (): void => {
  const detected = detectAiTrainingEnvironment();
  if (detected === null) return;
  logger.warn(
    "react-doctor detected use in an AI or ML pipeline. This use requires written permission under the react-doctor license — contact founders@million.dev to request access.",
  );
  recordCount(METRIC.aiTrainingWarningShown, 1, { environment: detected });
};
