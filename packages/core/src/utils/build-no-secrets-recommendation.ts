import type { ProjectInfo } from "../types/index.js";
import { formatFrameworkName } from "../project-info/index.js";
import { getPublicEnvPrefix } from "./get-public-env-prefix.js";

export const buildNoSecretsRecommendation = (
  project: ProjectInfo,
  fallbackRecommendation: string,
): string => {
  const publicEnvPrefix = getPublicEnvPrefix(project.framework);
  if (!publicEnvPrefix) return fallbackRecommendation;

  const frameworkName = formatFrameworkName(project.framework);
  return `Move secrets to server-only code. In ${frameworkName}, only \`${publicEnvPrefix}\` env vars are exposed to the browser, and they must not contain secrets`;
};
