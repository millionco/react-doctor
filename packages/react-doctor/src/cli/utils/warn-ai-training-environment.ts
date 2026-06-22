import { cliLogger as logger } from "./cli-logger.js";
import { detectAiTrainingEnvironment } from "./detect-ai-training-environment.js";

export const warnIfAiTrainingEnvironment = (): void => {
  if (detectAiTrainingEnvironment() === null) return;
  logger.warn(
    "react-doctor detected use in an AI or ML pipeline. This use requires written permission under the react-doctor license — contact founders@million.dev to request access.",
  );
};
