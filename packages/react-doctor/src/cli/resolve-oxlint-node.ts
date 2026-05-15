import { OXLINT_NODE_REQUIREMENT, OXLINT_RECOMMENDED_NODE_MAJOR } from "../constants.js";
import { logger } from "../core/logger.js";
import { prompts } from "./prompts.js";
import {
  installNodeViaNvm,
  isNvmInstalled,
  resolveNodeForOxlint,
} from "../core/resolve-compatible-node.js";

export const resolveOxlintNode = async (
  isLintEnabled: boolean,
  isQuiet: boolean,
): Promise<string | null> => {
  if (!isLintEnabled) return null;

  const nodeResolution = resolveNodeForOxlint();

  if (nodeResolution) {
    if (!nodeResolution.isCurrentNode && !isQuiet) {
      logger.warn(
        `Node ${process.version} is unsupported by oxlint. Using Node ${nodeResolution.version} from nvm.`,
      );
      logger.break();
    }
    return nodeResolution.binaryPath;
  }

  if (isQuiet) return null;

  logger.warn(
    `Node ${process.version} is not compatible with oxlint (requires ${OXLINT_NODE_REQUIREMENT}). Lint checks will be skipped.`,
  );

  if (isNvmInstalled() && process.stdin.isTTY) {
    const { shouldInstallNode } = await prompts({
      type: "confirm",
      name: "shouldInstallNode",
      message: `Install Node ${OXLINT_RECOMMENDED_NODE_MAJOR} via nvm to enable lint checks?`,
      initial: true,
    });

    if (shouldInstallNode) {
      logger.break();
      const freshResolution = installNodeViaNvm() ? resolveNodeForOxlint() : null;
      if (freshResolution) {
        logger.break();
        logger.success(`Node ${freshResolution.version} installed. Using it for lint checks.`);
        logger.break();
        return freshResolution.binaryPath;
      }
      logger.break();
      logger.warn("Failed to install Node via nvm. Skipping lint checks.");
      logger.break();
      return null;
    }
  } else if (isNvmInstalled()) {
    logger.dim(`  Run: nvm install ${OXLINT_RECOMMENDED_NODE_MAJOR}`);
  } else {
    logger.dim(
      `  Install nvm (https://github.com/nvm-sh/nvm) and run: nvm install ${OXLINT_RECOMMENDED_NODE_MAJOR}`,
    );
  }

  logger.break();
  return null;
};
